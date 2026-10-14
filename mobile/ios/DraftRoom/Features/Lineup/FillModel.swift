import Foundation
import Observation

/// Filling a hole in this week's lineup (APE-404), after the web's hole card: "Fill it" reads the
/// ranked ways to fill it (team/fills), the user picks one, the consent the first time, then the
/// server's steps (the hole's player to IR, the add with its drop, the start) to confirm, and each
/// step's result. The server runs the steps; every word comes from it.
@MainActor
@Observable
final class FillModel {
    enum Load: Equatable {
        case loading
        /// The hole's ways to fill it; nil when the server no longer sees the hole.
        case ready(HoleFills?)
        /// ESPN couldn't be read for this league (409): the server's words.
        case problem(String)
        case failed(String)
    }

    enum Phase: Equatable {
        /// Picking a fill.
        case picking
        /// The first write: the consent, with the server's text, before anything goes.
        case consent(version: Int, lines: [String])
        /// Asking the server for the fill's steps.
        case checking
        /// The confirm: each step in the server's words, and why it can't go.
        case review(FillDryRun)
        case sending
        /// What ESPN shows for each step.
        case done(FillApplied)
        /// Nothing was sent, or what was sent couldn't be checked: the server's words and its reasons.
        case failed(String, details: [String])
    }

    let store: SeasonStore
    /// The hole being filled; the sheet is up while it's set.
    private(set) var hole: Hole?
    private(set) var load: Load = .loading
    /// The fill picked.
    private(set) var chosen: HoleFill?
    private(set) var phase: Phase = .picking

    private let api: APIClient
    private var agreed: Bool?

    init(api: APIClient, store: SeasonStore) {
        self.api = api
        self.store = store
    }

    /// The hole's ways to fill it, once read.
    var options: HoleFills? {
        if case let .ready(options) = load { return options }
        return nil
    }

    /// A rostered player's name.
    func name(_ id: Int?) -> String? { id.flatMap { store.season?.view.player($0)?.name } }

    /// How the fill makes room, as the web's hole card says it.
    func room(_ fill: HoleFill) -> String {
        if let ir = fill.ir { return "\(name(ir) ?? "Your player") goes to IR" }
        if let drop = fill.drop { return "Drops \(name(drop) ?? "a player")" }
        return "Room on your roster"
    }

    // MARK: Picking

    /// Opens the sheet on `hole` and reads its ways to fill it.
    func open(_ hole: Hole) async {
        self.hole = hole
        chosen = nil
        phase = .picking
        await read(refresh: false)
    }

    /// Reads the ways to fill the hole again, asking ESPN afresh.
    func reload() async { await read(refresh: true) }

    private func read(refresh: Bool) async {
        guard let hole else { return }
        load = .loading
        do {
            let response: FillsResponse = try await api.get("api/v1/leagues/\(store.leagueId)/team/fills" + (refresh ? "?refresh=1" : ""))
            load = .ready(response.fills.first { $0.hole.key == hole.key && $0.hole.playerId == hole.playerId })
        } catch .signedOut {
            self.hole = nil
        } catch let .problem(_, message) {
            load = .problem(message)
        } catch {
            load = .failed(error.message)
        }
    }

    /// Picks a fill: the consent the first time, then the server's steps.
    func choose(_ fill: HoleFill) async {
        chosen = fill
        if !(agreed ?? store.season?.consent.agreed ?? false), let consent = store.season?.consent {
            phase = .consent(version: consent.version, lines: consent.lines)
            return
        }
        await check()
    }

    /// Back to the list, to pick another.
    func back() {
        guard phase != .sending else { return }
        chosen = nil
        phase = .picking
    }

    // MARK: Filling

    /// Records the consent, then carries on to the confirm.
    func agree(version: Int) async {
        phase = .checking
        do {
            let _: ConsentGrant = try await api.post("api/v1/espn/write-consent", body: ConsentRequest(version: version))
            agreed = true
            await check()
        } catch {
            fail(error)
        }
    }

    /// Sends the fill. Never queued: offline, nothing goes.
    func send() async {
        guard case let .review(dry) = phase, dry.problems.isEmpty, let request else { return }
        phase = .sending
        do {
            let applied: FillApplied = try await api.post("api/v1/leagues/\(store.leagueId)/team/fill", body: request)
            phase = .done(applied)
            // The roster and the lineup both changed: read them again, skipping the server's caches.
            await store.refresh(force: true)
        } catch {
            fail(error)
        }
    }

    /// Asks the server again after a failure.
    func retry() async {
        if chosen == nil { await reload() } else { await check() }
    }

    /// Closes the sheet.
    func dismiss() {
        if case .sending = phase { return }
        hole = nil
        chosen = nil
        phase = .picking
    }

    private var request: FillRequest? {
        guard let hole, let chosen, let view = store.season?.view else { return nil }
        let roster = view.team(view.myTeamId)?.roster ?? []
        return FillRequest(
            week: view.currentWeek,
            season: view.season,
            snapshot: roster.map { .init(playerId: $0.playerId, slot: $0.slot) },
            hole: .init(key: hole.key, playerId: hole.playerId),
            add: chosen.player.playerId)
    }

    private func check() async {
        guard let request else { return }
        phase = .checking
        do {
            phase = .review(try await api.post("api/v1/leagues/\(store.leagueId)/team/fill?dryRun=1", body: request))
        } catch {
            fail(error)
        }
    }

    private func fail(_ error: APIError) {
        switch error {
        case let .consentNeeded(version, lines):
            agreed = false
            phase = .consent(version: version, lines: lines)
        case let .declined(message, details):
            phase = .failed(message, details: details)
        case .offline:
            phase = .failed("You're offline, so nothing was sent to ESPN. Try again once you're connected.", details: [])
        case .signedOut:
            hole = nil
            phase = .picking
        default:
            phase = .failed(error.message, details: [])
        }
    }
}
