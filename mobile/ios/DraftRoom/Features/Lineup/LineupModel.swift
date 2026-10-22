import Foundation
import Observation

/// The lineup the user is staging for ESPN in one league (APE-382), after the web's useLineupDraft.ts.
/// It starts as War Room's lineup; once ESPN's lineup changes under it (after a save, or a refresh),
/// it starts again from what ESPN has. Kept by the shell per league, so edits survive switching tabs.
///
/// Staging is only seat bookkeeping: who sits where, from the season response's seats and eligible
/// slots. The moves, their words, their checks and the Lock In moment all come from the server.
@MainActor
@Observable
final class LineupModel {
    enum Phase: Equatable {
        case idle
        /// The first save: the write consent, with the server's text, before anything goes.
        case consent(version: Int, lines: [String])
        /// Asking the server what the lineup changes, or re-asking after a toggle.
        case checking
        /// The confirm sheet: each change in the server's words, with a toggle.
        case review(LineupDryRun)
        case sending
        /// ESPN took the save; the sheet closes and the screen shows what landed.
        case saved(LineupApplied)
        /// Nothing was sent, or what was sent couldn't be checked: the server's words and its reasons.
        case failed(String, details: [String])
    }

    let store: SeasonStore
    private(set) var staged: [Int?] = []
    /// Who should be on IR (the web's IR picker, APE-387): saved with the lineup.
    private(set) var ir: [Int] = []
    private(set) var phase: Phase = .idle
    /// The change ids the user left ticked in the confirm sheet; nil until the first dry run.
    private(set) var picked: Set<String>?
    /// The last list of changes the server sent, kept on screen while a toggle is re-checked.
    private(set) var dry: LineupDryRun?
    /// The last save's results, kept on screen until the next edit.
    private(set) var lastSave: LineupApplied?
    /// The Lock In moment from the last save, and whether this is its first showing this week.
    private(set) var moment: LockInMoment?
    private(set) var momentIsNew = false
    /// The user has changed the lineup by hand since it was last set up: switching away asks first.
    private(set) var edited = false
    /// A player whose slot the tab should open: a tapped "is out" push (21.4). Cleared once shown.
    var focus: Int?

    /// Dropping a player from a picker (APE-425): the drop on its way, then what ESPN shows, or why it didn't go.
    /// The player whose drop is on its way to ESPN: the tab says so until the answer comes back.
    private(set) var droppingPlayer: ViewPlayer?
    private(set) var dropNotice: DropNotice?
    var dropFailure: DropFailure?

    struct DropNotice: Equatable {
        let text: String
        let landed: Bool
    }

    struct DropFailure: Equatable, Identifiable {
        let message: String
        let details: [String]
        var id: String { message + details.joined() }
    }

    private let api: APIClient
    private let defaults: UserDefaults
    /// Where each of the user's players sat on ESPN when staging started.
    private var seen: String?
    private var agreed = false
    /// After a save that left changes out, keep the staged lineup so they're still on offer.
    private var keepStaged = false

    init(api: APIClient, store: SeasonStore, defaults: UserDefaults = .standard) {
        self.api = api
        self.store = store
        self.defaults = defaults
        sync()
    }

    private var season: SeasonResponse? { store.season }
    var lineup: SeasonLineup? { season?.lineup }
    var seats: [String] { lineup?.seats ?? [] }
    var onEspn: [Int?] { lineup?.onEspn ?? [] }
    var recommended: [Int?] { lineup?.recommended ?? [] }

    /// The user's roster this week.
    var roster: [ViewPlayer] {
        guard let view = season?.view else { return [] }
        return view.team(view.myTeamId)?.roster ?? []
    }

    func player(_ id: Int?) -> ViewPlayer? { id.flatMap { id in roster.first { $0.playerId == id } } }

    var bench: [ViewPlayer] { roster.filter { $0.slot == "BN" }.sorted { $0.points > $1.points } }
    var injuredReserve: [ViewPlayer] { roster.filter { $0.slot == "IR" } }
    /// Who's on IR on ESPN now.
    var onIr: [Int] { injuredReserve.map(\.playerId) }
    var irSlots: Int { season?.view.irSlots ?? 0 }

    /// The IR checklist (the web's IrPicker): who's on IR, and who could go there, players ESPN lists
    /// as out or on injured reserve whose game hasn't started. The server says who's eligible. Empty
    /// when the league has no IR slots or nobody qualifies, and then the checklist isn't shown.
    var irCandidates: [ViewPlayer] {
        guard let lineup, irSlots > 0 else { return [] }
        return roster.filter { $0.slot == "IR" || (lineup.canPlay($0.playerId, "IR") && !$0.locked) }
    }

    /// Players moving on or off IR.
    var irChanges: Int { Set(ir).symmetricDifference(onIr).count }

    /// Staging has caught up with the season read: rows may index `staged` by seat.
    var isReady: Bool { !seats.isEmpty && staged.count == seats.count && onEspn.count == seats.count }

    /// The seats whose player would change.
    var changedSeats: [Int] {
        guard isReady else { return [] }
        return seats.indices.filter { staged[$0] != onEspn[$0] }
    }
    var hasChanges: Bool { !changedSeats.isEmpty || irChanges > 0 }
    var isOnEspn: Bool { staged == onEspn }
    var isRecommended: Bool { staged == recommended }
    /// Edits the user would lose by switching league or signing out.
    var hasUnsavedEdits: Bool { edited && hasChanges }

    /// Starts again when ESPN's lineup has changed under the staged one. Call after each season read.
    func sync() {
        guard let lineup else { return }
        let key = roster.map { "\($0.playerId):\($0.slot)" }.joined(separator: ",")
        guard key != seen else { return }
        let first = seen == nil
        seen = key
        if !agreed { agreed = season?.consent.agreed == true }
        if first {
            staged = lineup.recommended
            ir = onIr
        } else if !keepStaged {
            staged = lineup.onEspn
            ir = onIr
            edited = false
        }
        keepStaged = false
    }

    // MARK: The hero

    /// What leads the tab, in the web LineupPanel's order: the Lock In moment just after a save, then
    /// any hard hole, then what War Room's moves banked once nothing is left to suggest, and otherwise
    /// the start/sit verdict.
    enum Hero: Equatable {
        case lockIn(LockInMoment)
        case holes([Hole])
        case banked
        case startSit
    }

    var hero: Hero? {
        guard let lineup, isReady else { return nil }
        if let moment { return .lockIn(moment) }
        if !hardHoles.isEmpty { return .holes(hardHoles) }
        // ESPN has War Room's lineup and nothing is staged, or its moves banked something already.
        if !isSuggesting, lineup.startSit.banked >= 0.05 || !hasChanges { return .banked }
        return .startSit
    }

    /// Starting slots nobody on the roster can play this week.
    var hardHoles: [Hole] { lineup?.holes.filter { $0.kind == "hard" } ?? [] }

    /// War Room has changes to suggest against ESPN's lineup.
    var isSuggesting: Bool { !(lineup?.startSit.swaps.isEmpty ?? true) }

    /// A doubtful or likely-out starter with nobody behind him: a note under the hero, never the hero.
    var softHoles: [Hole] { lineup?.holes.filter { $0.kind == "soft" } ?? [] }

    /// The War Room move that put ESPN's player in this seat this week, while he's still there and
    /// staying ("Started by Draft Room").
    func madeMove(at seat: Int) -> WarRoomMove? {
        guard isReady, seats.indices.contains(seat), let id = onEspn[seat], staged[seat] == id else { return nil }
        return season?.view.warRoomMoves.first { $0.playerId == id && $0.slot == seats[seat] }
    }

    /// The players the Lock In moment just started for War Room: their markers draw in.
    var freshlyMade: Set<Int> { Set(moment?.moves.filter { !$0.own }.map(\.playerId) ?? []) }

    /// "Make these moves" after a partial save: stage the rest of War Room's lineup and open the review.
    func finishDraftRoom() async {
        startFromDraftRoom()
        await review()
    }

    // MARK: Staging

    /// Who may sit in a seat: anyone not staged for IR who can play it and isn't locked, War Room's pick
    /// first, then ESPN's, then by projection. Whoever holds the seat stays on the list.
    func options(for seat: Int) -> [ViewPlayer] {
        guard let lineup, isReady, seats.indices.contains(seat) else { return [] }
        let key = seats[seat]
        let rank = { (id: Int) in id == self.recommended[seat] ? 0 : id == self.onEspn[seat] ? 1 : 2 }
        return roster
            .filter { !ir.contains($0.playerId) && lineup.canPlay($0.playerId, key) && (!$0.locked || $0.playerId == staged[seat]) }
            .sorted { (rank($0.playerId), -$0.points) < (rank($1.playerId), -$1.points) }
    }

    /// The seats a bench player could take: those his position can play whose holder isn't locked.
    func seats(for benched: ViewPlayer) -> [Int] {
        guard let lineup, !benched.locked, !ir.contains(benched.playerId) else { return [] }
        let at = staged.firstIndex(of: benched.playerId)
        return seats.indices.filter { i in
            i != at && lineup.canPlay(benched.playerId, seats[i]) && player(staged[i])?.locked != true
        }
    }

    /// Whether a seat can be changed at all: not while its player's game is on.
    func isLocked(_ seat: Int) -> Bool {
        guard isReady, seats.indices.contains(seat) else { return false }
        return player(staged[seat])?.locked == true || player(onEspn[seat])?.locked == true
    }

    /// Puts a player in a seat, or empties it with nil (the web's chooseSeat). Picking someone staged
    /// elsewhere swaps the two when the other seat can take the player displaced.
    func choose(_ seat: Int, _ id: Int?) {
        guard let lineup, isReady, seats.indices.contains(seat), staged[seat] != id else { return }
        var next = staged
        if let id, let was = next.firstIndex(of: id), was != seat {
            let displaced = next[seat]
            next[was] = displaced.flatMap { lineup.canPlay($0, seats[was]) ? $0 : nil }
        }
        next[seat] = id
        staged = Self.align(seats: seats, before: onEspn, after: next)
        edited = true
        editedSinceSave()
    }

    /// Moves a player on or off IR. A player going on IR gives up his seat (the web's toggleIr).
    func toggleIr(_ id: Int, on: Bool) {
        guard isReady, player(id)?.locked != true, ir.contains(id) != on else { return }
        if on {
            ir.append(id)
            staged = staged.map { $0 == id ? nil : $0 }
        } else {
            ir.removeAll { $0 == id }
        }
        edited = true
        editedSinceSave()
    }

    /// One tap back to ESPN's lineup or to War Room's (the web's LineupSources). The hero's "Use Draft
    /// Room's lineup" is the second: it only stages, and the save goes through the usual review.
    func startFromEspn() { start(from: onEspn) }
    func startFromDraftRoom() { start(from: recommended) }

    /// Stages the AI lineup (APE-391): its starters seat by seat, slot by slot in order, everyone else
    /// on the bench. Like "Use Draft Room's lineup", it only stages; the save is the usual review.
    func startFromAi(_ starters: [AiLineup.Starter]) {
        guard isReady else { return }
        start(from: aiLineup(starters))
    }

    /// Whether the staged lineup is the AI's already.
    func isStaged(ai starters: [AiLineup.Starter]) -> Bool {
        isReady && staged == aiLineup(starters) && ir == onIr
    }

    private func aiLineup(_ starters: [AiLineup.Starter]) -> [Int?] {
        var left = starters
        let lineup = seats.map { key -> Int? in
            guard let i = left.firstIndex(where: { $0.key == key }) else { return nil }
            return left.remove(at: i).playerId
        }
        return Self.align(seats: seats, before: onEspn, after: lineup)
    }

    private func start(from lineup: [Int?]) {
        staged = lineup
        ir = onIr
        edited = lineup != recommended
        editedSinceSave()
    }

    private func editedSinceSave() {
        lastSave = nil
        moment = nil
        if case .failed = phase { phase = .idle }
    }

    /// Lays a staged lineup against ESPN's, seat for seat (the web's alignSeats): a player who holds
    /// a slot on ESPN keeps his seat there, so two RBs trading seats aren't a change.
    static func align(seats: [String], before: [Int?], after: [Int?]) -> [Int?] {
        var aligned = [Int?](repeating: nil, count: seats.count)
        var placed = Set<Int>()
        for (i, key) in seats.enumerated() {
            guard let id = before[i], seats.indices.contains(where: { seats[$0] == key && after[$0] == id }) else { continue }
            aligned[i] = id
            placed.insert(id)
        }
        for (i, key) in seats.enumerated() {
            guard let id = after[i], !placed.contains(id) else { continue }
            if let open = seats.indices.first(where: { seats[$0] == key && aligned[$0] == nil }) {
                aligned[open] = id
                placed.insert(id)
            }
        }
        return aligned
    }

    // MARK: Dropping

    /// The user hasn't agreed to ESPN writes yet: the drop's confirm carries the consent's lines.
    var dropNeedsConsent: Bool { !agreed }
    var consentLines: [String] { season?.consent.lines ?? [] }

    /// Drops a player on ESPN with nobody added (APE-425), once the user has confirmed: the consent
    /// first if it's never been given, then the write. He leaves the staged lineup and IR; the user's
    /// own edits survive the read that follows. Never queued: offline, nothing goes.
    func drop(_ player: ViewPlayer) async {
        guard let season, droppingPlayer == nil else { return }
        droppingPlayer = player
        dropNotice = nil
        defer { droppingPlayer = nil }
        do {
            if !agreed {
                let _: ConsentGrant = try await api.post("api/v1/espn/write-consent", body: ConsentRequest(version: season.consent.version))
                agreed = true
            }
            let request = AcquireRequest(
                kind: .drop, week: season.view.currentWeek,
                snapshot: roster.map { .init(playerId: $0.playerId, slot: $0.slot) },
                drop: player.playerId)
            let applied: TeamApplied = try await api.post("api/v1/leagues/\(store.leagueId)/team/acquire", body: request)
            dropNotice = DropNotice(text: applied.result, landed: applied.landed)
            keepStaged = hasUnsavedEdits
            staged = staged.map { $0 == player.playerId ? nil : $0 }
            ir.removeAll { $0 == player.playerId }
            await store.refresh(force: true)
            sync()
        } catch {
            switch error {
            case .consentNeeded:
                agreed = false
                dropFailure = DropFailure(message: "Draft Room's terms for changing your ESPN team have changed. Try the drop again to agree to them.", details: [])
            case let .declined(message, details):
                dropFailure = DropFailure(message: message, details: details)
            case .offline:
                dropFailure = DropFailure(message: "You're offline, so nothing was sent to ESPN. Try again once you're connected.", details: [])
            case .signedOut:
                break
            default:
                dropFailure = DropFailure(message: error.message, details: [])
            }
        }
    }

    /// Puts the drop's toast away.
    func dismissDropNotice() { dropNotice = nil }

    // MARK: Saving

    /// Opens the save: the consent the first time, then the server's list of changes.
    func review() async {
        guard let season else { return }
        picked = nil
        dry = nil
        if !agreed {
            phase = .consent(version: season.consent.version, lines: season.consent.lines)
            return
        }
        await check()
    }

    /// Records the consent, then carries on to the list of changes.
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

    /// Ticks or unticks a change, then asks the server again: one change can depend on another.
    func toggle(_ id: String, on: Bool) async {
        guard case let .review(dry) = phase else { return }
        var next = picked ?? Set(dry.changes.filter(\.picked).map(\.id))
        if on { next.insert(id) } else { next.remove(id) }
        picked = next
        await check()
    }

    /// Sends the ticked changes. Never queued: offline, nothing goes.
    func send() async {
        guard case let .review(dry) = phase, dry.problems.isEmpty, dry.changes.contains(where: \.picked), let request = request(changes: dry.changes.filter(\.picked).map(\.id)) else { return }
        phase = .sending
        do {
            let applied: LineupApplied = try await api.post("api/v1/leagues/\(store.leagueId)/lineup", body: request)
            lastSave = applied
            keepStaged = dry.changes.contains { !$0.picked }
            edited = keepStaged && edited
            if let lockIn = applied.lockIn, let season = self.season {
                let key = "moment:\(store.leagueId):\(season.view.season):\(season.view.currentWeek):lineup"
                momentIsNew = !defaults.bool(forKey: key)
                defaults.set(true, forKey: key)
                moment = lockIn
            }
            phase = .saved(applied)
            // Game day and the lineup both read ESPN as it now is.
            await store.refresh(force: true)
            sync()
        } catch {
            fail(error)
        }
    }

    /// Closes the sheet without saving.
    func cancel() {
        if case .sending = phase { return }
        phase = .idle
    }

    private func check() async {
        guard let request = request(changes: picked.map { Array($0).sorted() }) else { return }
        phase = .checking
        do {
            let dry: LineupDryRun = try await api.post("api/v1/leagues/\(store.leagueId)/lineup?dryRun=1", body: request)
            if picked == nil { picked = Set(dry.changes.filter(\.picked).map(\.id)) }
            self.dry = dry
            phase = .review(dry)
        } catch {
            fail(error)
        }
    }

    private func request(changes: [String]?) -> LineupRequest? {
        guard let season else { return nil }
        return LineupRequest(
            week: season.view.currentWeek,
            season: season.view.season,
            snapshot: roster.map { .init(playerId: $0.playerId, slot: $0.slot) },
            lineup: staged,
            ir: ir,
            changes: changes)
    }

    private func fail(_ error: APIError) {
        switch error {
        case let .consentNeeded(version, lines):
            agreed = false
            phase = .consent(version: version, lines: lines)
        case let .declined(message, details):
            phase = .failed(message, details: details)
        case .offline:
            phase = .failed("You're offline, so nothing was sent to ESPN. Save again once you're connected.", details: [])
        case .signedOut:
            phase = .idle
        default:
            phase = .failed(error.message, details: [])
        }
    }
}
