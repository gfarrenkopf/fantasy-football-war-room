import Foundation
import Observation

/// One league's season, as GET /api/v1/leagues/:id/season has it (APE-379). Game day and Lineup
/// both read it, as both web tabs read one server page. The last good answer is kept on the device,
/// so a phone with no signal in the stands still shows the week, marked with when it was read.
@MainActor
@Observable
final class SeasonStore {
    enum Load: Equatable {
        case loading
        case ready
        /// ESPN couldn't be read for this league (409): the server's words, and whether reconnecting ESPN is the fix.
        case problem(String, reconnect: Bool)
        /// Nothing to show: offline with nothing kept, or the server failed.
        case failed(String)
    }

    /// How often Game day reads the season again while a game is on: the web's LIVE_POLL_MS.
    static let liveInterval: Duration = .seconds(60)

    let leagueId: String
    private(set) var season: SeasonResponse?
    private(set) var load: Load = .loading
    /// Set while the season shown is the one kept on the device because the server couldn't be reached.
    private(set) var offline = false
    private(set) var refreshing = false

    /// The tab to open, once per store: from the first season read. Never changes after.
    private(set) var openingTab: SeasonTab?

    private let api: APIClient
    private let cache: SeasonCache

    init(api: APIClient, leagueId: String, cache: SeasonCache = .shared) {
        self.api = api
        self.leagueId = leagueId
        self.cache = cache
    }

    /// Whether the user's matchup has a game on, which is when Game day keeps itself fresh.
    var isLive: Bool { season?.live?.live == true }

    /// When the season shown was read from ESPN.
    var readAt: Date? { season?.fetchedAt }

    /// Shows the kept season at once, then reads the server.
    func start() async {
        if season == nil, let kept = cache.read(leagueId) {
            season = kept
            load = .ready
        }
        await refresh()
    }

    /// Reads the season; `force` skips the server's cache, for pull-to-refresh.
    func refresh(force: Bool = false) async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            let path = "api/v1/leagues/\(leagueId)/season" + (force ? "?refresh=1" : "")
            let fresh: SeasonResponse = try await api.get(path)
            season = fresh
            offline = false
            load = .ready
            cache.write(fresh, for: leagueId)
            if openingTab == nil { openingTab = SeasonTab(rawValue: fresh.defaultTab) ?? .gameDay }
        } catch .signedOut {
            // The session handles this: the app is already back at sign-in.
        } catch let .problem(problem, message) {
            // Connecting ESPN again fixes a lost login or link; anything else is ESPN's to fix.
            load = .problem(message, reconnect: ["not-linked", "no-login", "disconnected"].contains(problem))
        } catch {
            if season != nil {
                offline = error == .offline
                load = .ready
                if openingTab == nil, let kept = season { openingTab = SeasonTab(rawValue: kept.defaultTab) ?? .gameDay }
            } else {
                load = .failed(error.message)
            }
        }
    }

    /// Reads the season every `interval` for as long as the calling task runs and a game is on.
    /// Game day runs it only while it's on screen and the app is in the foreground.
    func poll(every interval: Duration = SeasonStore.liveInterval) async {
        while !Task.isCancelled {
            do { try await Task.sleep(for: interval) } catch { return }
            guard isLive else { continue }
            await refresh()
        }
    }
}

/// The last season read per league, kept in the app's caches folder. The system may clear it;
/// that only costs the offline view until the next read.
@MainActor
struct SeasonCache {
    static let shared = SeasonCache(folder: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "season", directoryHint: .isDirectory))

    let folder: URL

    private func file(_ leagueId: String) -> URL {
        folder.appending(path: "\(leagueId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "league").json")
    }

    func read(_ leagueId: String) -> SeasonResponse? {
        guard let data = try? Data(contentsOf: file(leagueId)) else { return nil }
        return try? APIClient.decoder.decode(SeasonResponse.self, from: data)
    }

    func write(_ season: SeasonResponse, for leagueId: String) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(season) else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? data.write(to: file(leagueId), options: .atomic)
    }

    func clear() {
        try? FileManager.default.removeItem(at: folder)
    }
}
