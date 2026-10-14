import Foundation
import Observation

/// One league's recap archive (APE-384), from GET /api/v1/leagues/:id/recaps, and each week read in
/// full as it's opened. The last answers are kept on the device, so the archive still reads with no
/// signal. Game day shows it whenever no game is on, as the web's GameDayPanel shows RecapArchive.
@MainActor
@Observable
final class RecapsStore {
    enum Load: Equatable {
        case loading
        case ready
        /// Nothing to show: offline with nothing kept, or the server failed.
        case failed(String)
    }

    enum WeekLoad: Equatable {
        case loading
        case ready(RecapResponse)
        case failed(String)
    }

    let leagueId: String
    private(set) var archive: RecapsResponse?
    private(set) var load: Load = .loading
    /// Set while the archive shown is the one kept on the device because the server couldn't be reached.
    private(set) var offline = false
    private(set) var weeks: [RecapKey: WeekLoad] = [:]

    private let api: APIClient
    private let cache: RecapCache
    private var refreshing = false

    init(api: APIClient, leagueId: String, cache: RecapCache = .shared) {
        self.api = api
        self.leagueId = leagueId
        self.cache = cache
    }

    /// The share link for a week: the sharer's season page with the week picked, which opens in the
    /// app for anyone who has it and this league (a Universal Link), and on the web otherwise.
    func link(for key: RecapKey) -> URL {
        SeasonLink(leagueId: leagueId, recap: key).url(base: api.baseURL)
    }

    /// Shows the kept archive at once, then reads the server.
    func start() async {
        if archive == nil, let kept = cache.archive(leagueId) {
            archive = kept
            load = .ready
        }
        await refresh()
    }

    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            let fresh: RecapsResponse = try await api.get("api/v1/leagues/\(leagueId)/recaps")
            archive = fresh
            offline = false
            load = .ready
            cache.write(fresh, for: leagueId)
            // A week read before may have settled since; read it again when it's next opened.
            for summary in fresh.weeks {
                if case let .ready(kept) = weeks[summary.key], kept.date != summary.date { weeks[summary.key] = nil }
            }
        } catch .signedOut {
            // The session handles this: the app is already back at sign-in.
        } catch {
            if archive != nil {
                offline = error == .offline
                load = .ready
            } else {
                load = .failed(error.message)
            }
        }
    }

    /// Reads one week in full, showing the kept copy first. Reading it again only refreshes it.
    func open(_ key: RecapKey) async {
        if case .ready = weeks[key] {} else {
            weeks[key] = cache.week(leagueId, key).map { .ready($0) } ?? .loading
        }
        do {
            let path = "api/v1/leagues/\(leagueId)/recaps/\(key.week)?season=\(key.season)"
            let fresh: RecapResponse = try await api.get(path)
            weeks[key] = .ready(fresh)
            cache.write(fresh, for: leagueId)
        } catch .signedOut {
        } catch {
            if case .ready = weeks[key] { return }
            weeks[key] = .failed(error.message)
        }
    }
}

/// The last archive and weeks read per league, kept in the app's caches folder. The system may clear
/// it; that only costs the offline view until the next read.
@MainActor
struct RecapCache {
    static let shared = RecapCache(folder: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "recaps", directoryHint: .isDirectory))

    let folder: URL

    private func file(_ leagueId: String, _ name: String) -> URL {
        folder.appending(path: leagueId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "league", directoryHint: .isDirectory)
            .appending(path: "\(name).json")
    }

    func archive(_ leagueId: String) -> RecapsResponse? { read(file(leagueId, "archive")) }

    func week(_ leagueId: String, _ key: RecapKey) -> RecapResponse? { read(file(leagueId, "\(key.season)-\(key.week)")) }

    func write(_ archive: RecapsResponse, for leagueId: String) { write(archive, to: file(leagueId, "archive")) }

    func write(_ recap: RecapResponse, for leagueId: String) { write(recap, to: file(leagueId, "\(recap.season)-\(recap.week)")) }

    func clear() {
        try? FileManager.default.removeItem(at: folder)
    }

    private func read<T: Decodable>(_ url: URL) -> T? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? APIClient.decoder.decode(T.self, from: data)
    }

    private func write(_ value: some Encodable, to url: URL) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(value) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }
}

extension MomentStore {
    static func recapKey(leagueId: String, _ key: RecapKey) -> String { "moment:\(leagueId):\(key.season):\(key.week):recap" }

    /// Whether opening this week's recap gets its moment: only the first time on this phone. Marked
    /// as it starts, so leaving mid-moment doesn't play it again.
    func claimRecap(leagueId: String, _ key: RecapKey) -> Bool {
        let name = Self.recapKey(leagueId: leagueId, key)
        guard !defaults.bool(forKey: name) else { return false }
        defaults.set(true, forKey: name)
        return true
    }
}
