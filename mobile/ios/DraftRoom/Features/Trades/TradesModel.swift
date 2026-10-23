import Foundation
import Observation

/// The Trades tab for one league (APE-405), after the web's TradePanel and TradeWrite: the user's
/// trades pending on ESPN, graded, with Accept, Decline or Withdraw, and a builder that grades a trade
/// as players are picked and offers it on ESPN. Every grade and every word comes from the server.
@MainActor
@Observable
final class TradesModel {
    enum Load: Equatable {
        case loading
        case ready(TradesResponse)
        /// ESPN couldn't be read for this league (409): the server's words, and whether reconnecting ESPN is the fix.
        case problem(String, reconnect: Bool)
        case failed(String)
    }

    enum Phase: Equatable {
        case idle
        /// The first write: the consent, with the server's text, before anything goes.
        case consent(version: Int, lines: [String])
        /// Asking the server what the write does.
        case checking
        /// The confirm: the question in the server's words, and why it can't go.
        case review(TradeDryRun)
        case sending
        /// Nothing was sent, or what was sent couldn't be checked: the server's words and its reasons.
        case failed(String, details: [String])
    }

    /// The write the sheet is confirming.
    enum Action: Equatable {
        /// The builder's trade, offered to its partner.
        case propose
        /// accept, decline or withdraw, on an offer pending on ESPN.
        case respond(TradeOffer, TradeRequest.Kind)
    }

    /// What the last write did, in the server's words, until the next one starts.
    struct Notice: Equatable {
        let text: String
        let landed: Bool
    }

    /// Which roster the builder is picking from.
    enum Side: Hashable {
        case send, get
    }

    let store: SeasonStore
    private(set) var load: Load = .loading
    private(set) var action: Action?
    private(set) var phase: Phase = .idle
    private(set) var notice: Notice?
    /// Counts writes that landed, once the rosters and offers are read again after each.
    private(set) var written = 0

    // The builder.
    private(set) var partnerId: Int?
    private(set) var gives: [Int] = []
    private(set) var gets: [Int] = []
    var side: Side = .send
    /// The builder's trade graded by the server; nil until there's one to grade.
    private(set) var grade: TradeGrade?
    private(set) var grading = false
    /// The trade idea open in the builder (APE-392), until either side changes.
    private(set) var loadedIdea: String?
    /// Bumped each time a trade is opened in the builder, so the tab can scroll to it.
    private(set) var loads = 0

    private let api: APIClient
    private var agreed: Bool?
    private var reading = false
    /// Bumped with each pick, so a slow grade for an older pick never lands over a newer one.
    private var picks = 0

    init(api: APIClient, store: SeasonStore) {
        self.api = api
        self.store = store
    }

    var trades: TradesResponse? {
        if case let .ready(trades) = load { return trades }
        return nil
    }

    private var view: SeasonView? { store.season?.view }

    /// The user's team, and everyone they could trade with.
    var mine: ViewTeam? { view.flatMap { $0.team($0.myTeamId) } }
    var others: [ViewTeam] { view.map { v in v.teams.filter { $0.id != v.myTeamId } } ?? [] }
    var partner: ViewTeam? { others.first { $0.id == partnerId } ?? others.first }

    /// A player's name, from any roster.
    func name(_ id: Int) -> String { view?.player(id)?.name ?? "ESPN player \(id)" }

    /// "Bijan Robinson, Breece Hall", or "Nothing".
    func names(_ ids: [Int]) -> String { ids.isEmpty ? "Nothing" : ids.map(name).joined(separator: ", ") }

    var deadlinePassed: Bool { trades?.deadline.passed ?? false }

    // MARK: Reading

    /// Reads the offers the first time the tab opens.
    func start() async {
        guard trades == nil else { return }
        await refresh()
    }

    func refresh() async {
        guard !reading else { return }
        reading = true
        defer { reading = false }
        if trades == nil { load = .loading }
        do {
            load = .ready(try await api.get("api/v1/leagues/\(store.leagueId)/team/trades"))
        } catch .signedOut {
            // The session handles this: the app is already back at sign-in.
        } catch let .problem(problem, message) {
            load = .problem(message, reconnect: ["not-linked", "no-login", "disconnected"].contains(problem))
        } catch {
            if trades == nil { load = .failed(error.message) }
        }
    }

    // MARK: The builder

    /// Changes who the trade is with; who'd come back is theirs, so it starts over.
    func choose(partner id: Int) async {
        guard id != partner?.id else { return }
        partnerId = id
        gets = []
        loadedIdea = nil
        await regrade()
    }

    /// Ticks or unticks a player on the side being picked.
    func toggle(_ id: Int) async {
        switch side {
        case .send: gives = gives.contains(id) ? gives.filter { $0 != id } : gives + [id]
        case .get: gets = gets.contains(id) ? gets.filter { $0 != id } : gets + [id]
        }
        loadedIdea = nil
        await regrade()
    }

    func isPicked(_ id: Int) -> Bool { gives.contains(id) || gets.contains(id) }

    /// Empties both sides.
    func clear() {
        gives = []
        gets = []
        grade = nil
        loadedIdea = nil
        picks += 1
    }

    /// Opens a trade in the builder: a trade idea, or the AI's counter-offer (the web's "Load into
    /// builder" and "Check this counter").
    func load(partner: Int, gives: [Int], gets: [Int], idea: String? = nil) async {
        partnerId = partner
        self.gives = gives
        self.gets = gets
        side = .send
        loadedIdea = idea
        loads += 1
        await regrade()
    }

    /// Offers a trade idea on ESPN: into the builder, graded, then the usual confirm.
    func offer(_ idea: AiIdea) async {
        await load(partner: idea.partner.id, gives: idea.gives.map(\.id), gets: idea.gets.map(\.id), idea: idea.kind)
        await propose()
    }

    /// The builder's trade, as the AI write-up asks for it; nil while it's empty.
    var aiTrade: AiTradeRequest? {
        guard let partner, !(gives.isEmpty && gets.isEmpty) else { return nil }
        return AiTradeRequest(partner: partner.id, gives: gives, gets: gets)
    }

    private var proposal: TradeRequest? {
        guard let view, let partner, let mine, !(gives.isEmpty && gets.isEmpty) else { return nil }
        return TradeRequest(
            kind: .propose, week: view.currentWeek,
            snapshot: mine.roster.map { .init(playerId: $0.playerId, slot: $0.slot) },
            partner: partner.id, gives: gives, gets: gets, drops: grade?.drops ?? [])
    }

    /// Asks the server to grade the builder's trade (a dry run of the proposal; nothing is written).
    private func regrade() async {
        picks += 1
        let pick = picks
        guard var request = proposal else {
            grade = nil
            return
        }
        request.drops = []
        grading = true
        defer { if pick == picks { grading = false } }
        let dry: TradeDryRun? = try? await api.post("api/v1/leagues/\(store.leagueId)/team/trades?dryRun=1", body: request)
        guard pick == picks else { return }
        grade = dry?.grade
    }

    // MARK: Writing

    /// Opens the offer of the builder's trade.
    func propose() async {
        guard proposal != nil else { return }
        await open(.propose)
    }

    /// Opens an accept, decline or withdraw of an offer.
    func respond(_ offer: TradeOffer, _ kind: TradeRequest.Kind) async {
        await open(.respond(offer, kind))
    }

    private func open(_ next: Action) async {
        action = next
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

    /// Sends the write. Never queued: offline, nothing goes.
    func send() async {
        guard case let .review(dry) = phase, dry.problems.isEmpty, let request else { return }
        phase = .sending
        do {
            let applied: TeamApplied = try await api.post("api/v1/leagues/\(store.leagueId)/team/trades", body: request)
            notice = Notice(text: applied.result, landed: applied.landed)
            if action == .propose { clear() }
            action = nil
            phase = .idle
            // The offers and the rosters changed: read them again.
            await store.refresh(force: true)
            await refresh()
            if applied.landed { written += 1 }
        } catch {
            fail(error)
        }
    }

    func retry() async { await check() }

    /// Puts the last write's notice away.
    func dismissNotice() { notice = nil }

    /// Closes the sheet without sending.
    func dismiss() {
        if case .sending = phase { return }
        action = nil
        phase = .idle
    }

    private var request: TradeRequest? {
        guard let action, let view else { return nil }
        switch action {
        case .propose:
            return proposal
        case let .respond(offer, kind):
            let snapshot = kind == .accept ? mine?.roster.map { LineupRequest.Seat(playerId: $0.playerId, slot: $0.slot) } : nil
            return TradeRequest(kind: kind, week: view.currentWeek, snapshot: snapshot, tradeId: offer.id)
        }
    }

    private func check() async {
        guard let request else { return }
        phase = .checking
        do {
            phase = .review(try await api.post("api/v1/leagues/\(store.leagueId)/team/trades?dryRun=1", body: request))
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
