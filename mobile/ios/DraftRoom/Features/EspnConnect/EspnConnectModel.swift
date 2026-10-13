import Foundation
import Observation

/// Connecting an ESPN league (APE-377, docs/ios.md §5): agree to the disclosure, sign in to ESPN in
/// a web view the app controls, pick the league, connect. The ESPN cookies live only in this model,
/// in memory, until the connect request carries them; they're dropped as soon as it's done.
@MainActor
@Observable
final class EspnConnectModel {
    enum Step: Equatable {
        case loading
        case consent(EspnDisclosure)
        /// ESPN's sign-in page is showing.
        case signingIn(EspnDisclosure)
        case pick([EspnLeagueChoice])
        /// The fan API listed nothing (or couldn't be read): ask for the league link or id.
        case enterLeague
        case connecting
        case connected(EspnConnected, name: String)
        case failed(String)
    }

    private(set) var step: Step = .loading
    var errorMessage: String?
    var leagueEntry = ""

    private let api: APIClient
    private var disclosure: EspnDisclosure?
    private var login: EspnLogin?

    init(api: APIClient) {
        self.api = api
    }

    func start() async {
        do {
            let disclosure: EspnDisclosure = try await api.get("api/v1/espn/disclosure")
            self.disclosure = disclosure
            step = .consent(disclosure)
        } catch {
            step = .failed(error.message)
        }
    }

    func agree() {
        guard let disclosure else { return }
        errorMessage = nil
        step = .signingIn(disclosure)
    }

    func cancelSignIn() {
        if let disclosure { step = .consent(disclosure) }
    }

    /// ESPN's sign-in finished and both cookies are here.
    func signedIn(_ login: EspnLogin) async {
        self.login = login
        step = .loading
        do {
            let list: EspnLeagueList = try await api.post("api/v1/espn/leagues", body: login)
            // This season's leagues; older seasons can't be connected for in-season help.
            let newest = list.leagues.map(\.season).max()
            let current = list.leagues.filter { $0.season == newest }
            step = current.isEmpty ? .enterLeague : .pick(current)
        } catch .server(status: 400, let message) {
            self.login = nil
            errorMessage = message
            if let disclosure { step = .consent(disclosure) }
        } catch {
            // The list is a convenience: without it, the league link still works.
            step = .enterLeague
        }
    }

    func choose(_ league: EspnLeagueChoice) async {
        await connect(espnLeagueId: league.espnLeagueId, season: league.season, name: league.name)
    }

    /// The league from what the user typed: an ESPN league link or a bare league id.
    func connectEntered(season: Int = Calendar(identifier: .gregorian).component(.year, from: .now)) async {
        guard let id = Self.leagueId(from: leagueEntry) else {
            errorMessage = "Paste your ESPN league's link, or type its league id."
            return
        }
        await connect(espnLeagueId: id, season: Self.season(from: leagueEntry) ?? season, name: "Your league")
    }

    private func connect(espnLeagueId: String, season: Int, name: String) async {
        guard let login, let disclosure else { return }
        struct Body: Encodable {
            let espnS2: String
            let swid: String
            let espnLeagueId: String
            let season: Int
            let consentVersion: Int
        }
        let previous = step
        step = .connecting
        errorMessage = nil
        do {
            let connected: EspnConnected = try await api.post(
                "api/v1/espn/connect",
                body: Body(espnS2: login.espnS2, swid: login.swid, espnLeagueId: espnLeagueId, season: season, consentVersion: disclosure.version)
            )
            self.login = nil
            step = .connected(connected, name: name)
        } catch {
            errorMessage = error.message
            step = previous
        }
    }

    /// `704343562`, or a link like `https://fantasy.espn.com/football/league?leagueId=704343562&seasonId=2026`.
    nonisolated static func leagueId(from text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.wholeMatch(of: /\d{1,12}/) != nil { return trimmed }
        guard let parts = URLComponents(string: trimmed), let host = parts.host, host.hasSuffix("espn.com") else { return nil }
        return parts.queryItems?.first { $0.name.lowercased() == "leagueid" }?.value.flatMap { $0.wholeMatch(of: /\d{1,12}/) != nil ? $0 : nil }
    }

    nonisolated static func season(from text: String) -> Int? {
        URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines))?.queryItems?.first { $0.name.lowercased() == "seasonid" }?.value.flatMap(Int.init)
    }
}
