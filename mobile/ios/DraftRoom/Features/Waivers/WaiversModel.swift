import Foundation
import Observation

/// The Waivers tab for one league (APE-388), after the web's WaiverPanel and AcquireReview: the
/// waiver wire read when the tab opens, and adding a free agent with a drop. The ranking, the drop
/// candidates and every word of the confirm and the result come from the server.
@MainActor
@Observable
final class WaiversModel {
    enum Load: Equatable {
        case loading
        case ready(WaiversResponse)
        /// ESPN couldn't be read for this league (409): the server's words, and whether reconnecting ESPN is the fix.
        case problem(String, reconnect: Bool)
        case failed(String)
    }

    enum Phase: Equatable {
        case idle
        /// The first write: the consent, with the server's text, before anything goes.
        case consent(version: Int, lines: [String])
        /// Asking the server what the add does, or asking again after a new drop.
        case checking
        /// The confirm: "Add X and drop Y." in the server's words, and why it can't go.
        case review(TeamDryRun)
        case sending
        /// Nothing was sent, or what was sent couldn't be checked: the server's words and its reasons.
        case failed(String, details: [String])
    }

    /// What the last add did, in the server's words, until the next one starts.
    struct Notice: Equatable {
        let text: String
        let landed: Bool
    }

    let store: SeasonStore
    private(set) var load: Load = .loading
    /// The pickup being added; the sheet is up while it's set.
    private(set) var acting: Pickup?
    /// Who goes to make room: the suggested drop to start with.
    private(set) var drop: Int?
    private(set) var phase: Phase = .idle
    /// The last confirm the server sent, kept on screen while a new drop is checked.
    private(set) var dry: TeamDryRun?
    private(set) var notice: Notice?

    private let api: APIClient
    private var agreed: Bool?
    private var reading = false

    init(api: APIClient, store: SeasonStore) {
        self.api = api
        self.store = store
    }

    var wire: WaiversResponse? {
        if case let .ready(wire) = load { return wire }
        return nil
    }

    /// The user's roster, from the season read.
    var roster: [ViewPlayer] {
        guard let view = store.season?.view else { return [] }
        return view.team(view.myTeamId)?.roster ?? []
    }

    /// A rostered player's name, for "Drop …" and next week's holes.
    func name(_ id: Int) -> String? { store.season?.view.player(id)?.name }

    /// Who the user could drop, weakest first, as the server ranks them.
    var dropChoices: [ViewPlayer] {
        wire?.drops.candidates.compactMap { id in roster.first { $0.playerId == id } } ?? []
    }

    /// The roster has room, so the add can go without a drop.
    var hasRoom: Bool { wire?.drops.needed == false }

    // MARK: Reading the wire

    /// Reads the wire the first time the tab opens.
    func start() async {
        guard wire == nil else { return }
        await refresh()
    }

    /// Reads the wire; `force` makes the server read ESPN again, for pull-to-refresh.
    func refresh(force: Bool = false) async {
        guard !reading else { return }
        reading = true
        defer { reading = false }
        if wire == nil { load = .loading }
        do {
            load = .ready(try await api.get("api/v1/leagues/\(store.leagueId)/team/waivers" + (force ? "?refresh=1" : "")))
        } catch .signedOut {
            // The session handles this: the app is already back at sign-in.
        } catch let .problem(problem, message) {
            load = .problem(message, reconnect: ["not-linked", "no-login", "disconnected"].contains(problem))
        } catch {
            // Keep the wire shown when a refresh fails: it's still the last good read.
            if wire == nil { load = .failed(error.message) }
        }
    }

    // MARK: Adding

    /// Opens the add: the suggested drop, or the weakest player when the roster is full and nobody
    /// was suggested. Then the consent the first time, then the server's confirm.
    func add(_ pickup: Pickup) async {
        acting = pickup
        drop = pickup.drop ?? (hasRoom ? nil : dropChoices.first?.playerId)
        dry = nil
        notice = nil
        if !(agreed ?? store.season?.consent.agreed ?? false), let consent = store.season?.consent {
            phase = .consent(version: consent.version, lines: consent.lines)
            return
        }
        await check()
    }

    /// The add, for one of next week's fills (the web's NextWeek): no gain, the fill's drop.
    func add(_ fill: Ahead.Fill) async {
        await add(Pickup(player: fill.player, delta: 0, perWeek: 0, drop: fill.drop))
    }

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

    /// Changes who goes, then asks the server again for its words.
    func choose(drop id: Int?) async {
        guard acting != nil, drop != id, phase != .sending else { return }
        drop = id
        await check()
    }

    /// Sends the add. Never queued: offline, nothing goes.
    func send() async {
        guard case let .review(dry) = phase, dry.problems.isEmpty, let request else { return }
        phase = .sending
        do {
            let applied: TeamApplied = try await api.post("api/v1/leagues/\(store.leagueId)/team/acquire", body: request)
            notice = Notice(text: applied.result, landed: applied.landed)
            acting = nil
            phase = .idle
            // The wire and the roster both changed: read them again, skipping the server's caches.
            await store.refresh(force: true)
            await refresh(force: true)
        } catch {
            fail(error)
        }
    }

    /// Asks the server again after a failure.
    func retry() async { await check() }

    /// Closes the sheet without adding.
    func cancel() {
        if case .sending = phase { return }
        acting = nil
        phase = .idle
    }

    private var request: AcquireRequest? {
        guard let acting, let view = store.season?.view else { return nil }
        return AcquireRequest(
            kind: .add,
            week: view.currentWeek,
            snapshot: roster.map { .init(playerId: $0.playerId, slot: $0.slot) },
            add: acting.player.playerId,
            drop: drop)
    }

    private func check() async {
        guard let request else { return }
        phase = .checking
        do {
            let dry: TeamDryRun = try await api.post("api/v1/leagues/\(store.leagueId)/team/acquire?dryRun=1", body: request)
            self.dry = dry
            phase = .review(dry)
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
            acting = nil
            phase = .idle
        default:
            phase = .failed(error.message, details: [])
        }
    }
}
