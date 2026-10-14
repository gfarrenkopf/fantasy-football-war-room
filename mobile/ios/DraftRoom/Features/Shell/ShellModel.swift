import Foundation
import Observation

/// The signed-in frame's state: the user's in-season leagues and which one is open.
@MainActor
@Observable
final class ShellModel {
    enum Load: Equatable {
        case loading
        case ready
        case offline(String)
    }

    private(set) var load: Load = .loading
    private(set) var leagues: [League] = []
    var selectedId: String?

    private let api: APIClient
    private let defaults: UserDefaults
    /// Each league's season, kept while the app runs so switching back shows it at once.
    @ObservationIgnored private var seasons: [String: SeasonStore] = [:]
    private static let lastLeagueKey = "lastLeagueId"

    init(api: APIClient, defaults: UserDefaults = .standard) {
        self.api = api
        self.defaults = defaults
    }

    var selected: League? {
        leagues.first { $0.id == selectedId } ?? leagues.first
    }

    func refresh(select id: String? = nil) async {
        do {
            let list: LeagueList = try await api.get("api/v1/leagues")
            leagues = list.leagues
            let wanted = id ?? selectedId ?? defaults.string(forKey: Self.lastLeagueKey)
            select(leagues.contains { $0.id == wanted } ? wanted : leagues.first?.id)
            load = .ready
        } catch .signedOut {
            // The session handles this: the app is already back at sign-in.
        } catch {
            if leagues.isEmpty { load = .offline(error.message) }
        }
    }

    /// The league's season store, made on first use.
    func season(for league: League) -> SeasonStore {
        if let store = seasons[league.id] { return store }
        let store = SeasonStore(api: api, leagueId: league.id)
        seasons[league.id] = store
        return store
    }

    func select(_ id: String?) {
        selectedId = id
        if let id { defaults.set(id, forKey: Self.lastLeagueKey) }
    }
}
