import Foundation
import Observation

/// The Waivers tab's free-agent search (APE-411), after the web's FreeAgentSearch: every available
/// player in the league, searched by name and narrowed to a position, most-rostered first, a page at
/// a time from team/players. Each is valued like a pickup, and added or claimed through WaiversModel.
@MainActor
@Observable
final class FreeAgentsModel {
    enum Load: Equatable {
        case loading
        case ready
        /// ESPN couldn't be read, or the server couldn't be reached: the words to show.
        case failed(String)
    }

    /// The positions to narrow to, in the web's order; nil is all of them.
    static let positions = ["QB", "RB", "WR", "TE", "K", "DST"]

    private(set) var query = ""
    private(set) var position: String?
    private(set) var players: [Pickup] = []
    /// Another page follows the ones shown.
    private(set) var more = false
    private(set) var load: Load = .loading
    /// Reading the next page; the list stays up.
    private(set) var paging = false

    private let api: APIClient
    private let leagueId: String
    /// How long typing pauses before the search goes to the server.
    private let debounce: Duration
    private var started = false
    private var reading: Task<Void, Never>?
    /// Counts searches, so a slow answer to an old one is dropped.
    private var generation = 0
    /// Every search answered since the last reload, so going back to one shows it at once.
    private var answers: [String: (players: [Pickup], more: Bool)] = [:]

    /// The search the list is for: the name ESPN would match, and the position.
    private var key: String {
        "\(searching ? query.trimmingCharacters(in: .whitespaces).lowercased() : "")|\(position ?? "")"
    }

    init(api: APIClient, leagueId: String, debounce: Duration = .milliseconds(300)) {
        self.api = api
        self.leagueId = leagueId
        self.debounce = debounce
    }

    /// A name under two letters browses, as on the web.
    var searching: Bool { query.trimmingCharacters(in: .whitespaces).count >= 2 }

    /// Reads the first page the first time the tab opens.
    func start() async {
        guard !started else { return }
        started = true
        await reload()
    }

    /// The name typed: searched after a pause, so each letter doesn't go to ESPN.
    func search(_ text: String) {
        let before = searching ? query.trimmingCharacters(in: .whitespaces).lowercased() : ""
        query = text
        let after = searching ? query.trimmingCharacters(in: .whitespaces).lowercased() : ""
        guard after != before else { return }
        schedule(after: debounce)
    }

    /// One position, or all of them with nil: read at once.
    func choose(position next: String?) {
        guard next != position else { return }
        position = next
        schedule(after: .zero)
    }

    /// Reads the first page again: after a failure, or once an add has changed the pool.
    func reload() async {
        reading?.cancel()
        answers = [:]
        await read()
    }

    /// The next page, kept under the ones shown.
    func loadMore() async {
        guard more, !paging, load == .ready else { return }
        paging = true
        defer { paging = false }
        let mark = generation
        do {
            let page: PlayersResponse = try await api.get(path(offset: players.count))
            guard mark == generation else { return }
            let shown = Set(players.map(\.id))
            players += page.players.filter { !shown.contains($0.id) }
            more = page.more
            answers[key] = (players, more)
        } catch {
            // The list shown is still right; Show more stays to try again.
        }
    }

    private func schedule(after delay: Duration) {
        reading?.cancel()
        if let answer = answers[key] {
            generation += 1
            players = answer.players
            more = answer.more
            load = .ready
            return
        }
        reading = Task { [weak self] in
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled else { return }
            await self?.read()
        }
    }

    private func read() async {
        generation += 1
        let mark = generation
        load = .loading
        do {
            let page: PlayersResponse = try await api.get(path(offset: 0))
            guard mark == generation else { return }
            players = page.players
            more = page.more
            load = .ready
            answers[key] = (page.players, page.more)
        } catch .signedOut {
            // The session handles this: the app is already back at sign-in.
        } catch {
            guard mark == generation else { return }
            players = []
            more = false
            load = .failed(error.message)
        }
    }

    private func path(offset: Int) -> String {
        var items: [URLQueryItem] = []
        if searching { items.append(URLQueryItem(name: "q", value: query.trimmingCharacters(in: .whitespaces))) }
        if let position { items.append(URLQueryItem(name: "pos", value: position)) }
        if offset > 0 { items.append(URLQueryItem(name: "offset", value: String(offset))) }
        var parts = URLComponents()
        parts.queryItems = items
        let query = parts.percentEncodedQuery ?? ""
        return "api/v1/leagues/\(leagueId)/team/players" + (query.isEmpty ? "" : "?\(query)")
    }
}
