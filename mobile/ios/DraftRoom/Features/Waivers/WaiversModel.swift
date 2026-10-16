import Foundation
import Observation

/// The Waivers tab for one league, after the web's WaiverPanel, AcquireReview and ClaimList: the
/// waiver wire read when the tab opens (APE-388), adding a free agent or claiming a player on
/// waivers with a drop, and cancelling a pending claim (APE-389). The ranking, the drop candidates
/// and every word of the confirm and the result come from the server.
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
        /// Asking the server what the change does, or asking again after a new drop.
        case checking
        /// The confirm: "Add X and drop Y." in the server's words, and why it can't go.
        case review(TeamDryRun)
        case sending
        /// Nothing was sent, or what was sent couldn't be checked: the server's words and its reasons.
        case failed(String, details: [String])
    }

    /// The roster change the sheet is confirming.
    enum Action: Equatable {
        /// A free agent, at once.
        case add(Pickup)
        /// A player on waivers: placed now, decided when waivers process.
        case claim(Pickup)
        /// One of the user's pending claims.
        case cancel(PendingClaim)
    }

    /// What the last change did, in the server's words, until the next one starts.
    struct Notice: Equatable {
        let text: String
        let landed: Bool
    }

    let store: SeasonStore
    /// Every other available player, searched and browsed below the pickups (APE-411).
    let freeAgents: FreeAgentsModel
    private(set) var load: Load = .loading
    /// The change being confirmed; the sheet is up while it's set.
    private(set) var action: Action?
    /// Who goes to make room: the suggested drop to start with.
    private(set) var drop: Int?
    private(set) var phase: Phase = .idle
    /// The last confirm the server sent, kept on screen while a new drop is checked.
    private(set) var dry: TeamDryRun?
    private(set) var notice: Notice?

    private let api: APIClient
    private var agreed: Bool?
    private var reading = false

    init(api: APIClient, store: SeasonStore, freeAgents: FreeAgentsModel? = nil) {
        self.api = api
        self.store = store
        self.freeAgents = freeAgents ?? FreeAgentsModel(api: api, leagueId: store.leagueId)
    }

    /// The player being added or claimed.
    var acting: Pickup? {
        switch action {
        case let .add(pickup), let .claim(pickup): pickup
        default: nil
        }
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
        async let search: Void = freeAgents.start()
        await refresh()
        await search
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

    // MARK: Claims

    /// The user's pending claims, from the season read.
    var claims: [PendingClaim] { store.season?.view.claims ?? [] }

    /// Draft Room claims in this league; in one that bids FAAB, claims go through ESPN for now.
    var canClaim: Bool { wire?.claims.allowed ?? true }

    /// When the first of the user's claims processes, once that's within a day: the tab says so.
    func processingSoon(now: Date = .now) -> Date? {
        claims.compactMap(\.processesAt).filter { $0 > now && $0.timeIntervalSince(now) < 86_400 }.min()
    }

    // MARK: Changing the roster

    /// Opens the add of a free agent, or the claim of a player on waivers: the suggested drop, or
    /// the weakest player when the roster is full and nobody was suggested. Then the consent the
    /// first time, then the server's confirm.
    func acquire(_ pickup: Pickup) async {
        let claim = pickup.player.status == "WAIVERS"
        guard !claim || canClaim else { return }
        drop = pickup.drop ?? (hasRoom ? nil : dropChoices.first?.playerId)
        await open(claim ? .claim(pickup) : .add(pickup))
    }

    /// The same, for one of next week's fills (the web's NextWeek): no gain, the fill's drop.
    func acquire(_ fill: Ahead.Fill) async {
        await acquire(Pickup(player: fill.player, delta: 0, perWeek: 0, drop: fill.drop))
    }

    /// Opens the cancel of a pending claim.
    func cancel(_ claim: PendingClaim) async {
        drop = nil
        await open(.cancel(claim))
    }

    private func open(_ next: Action) async {
        action = next
        dry = nil
        notice = nil
        if !(agreed ?? store.season?.consent.agreed ?? false), let consent = store.season?.consent {
            phase = .consent(version: consent.version, lines: consent.lines)
            return
        }
        await check()
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

    /// Sends the change. Never queued: offline, nothing goes.
    func send() async {
        guard case let .review(dry) = phase, dry.problems.isEmpty, let request else { return }
        phase = .sending
        do {
            let applied: TeamApplied = try await api.post("api/v1/leagues/\(store.leagueId)/team/acquire", body: request)
            notice = Notice(text: applied.result, landed: applied.landed)
            action = nil
            phase = .idle
            // The wire, the roster and the claims all changed: read them again, skipping the server's caches.
            await store.refresh(force: true)
            await refresh(force: true)
            await freeAgents.reload()
        } catch {
            fail(error)
        }
    }

    /// Asks the server again after a failure.
    func retry() async { await check() }

    /// Closes the sheet without changing anything.
    func dismiss() {
        if case .sending = phase { return }
        action = nil
        phase = .idle
    }

    private var request: AcquireRequest? {
        guard let action, let view = store.season?.view else { return nil }
        let snapshot = roster.map { LineupRequest.Seat(playerId: $0.playerId, slot: $0.slot) }
        return switch action {
        case let .add(pickup): AcquireRequest(kind: .add, week: view.currentWeek, snapshot: snapshot, add: pickup.player.playerId, drop: drop)
        case let .claim(pickup): AcquireRequest(kind: .claim, week: view.currentWeek, snapshot: snapshot, add: pickup.player.playerId, drop: drop)
        case let .cancel(claim): AcquireRequest(kind: .cancel, week: view.currentWeek, claimId: claim.id)
        }
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
            action = nil
            phase = .idle
        default:
            phase = .failed(error.message, details: [])
        }
    }
}
