import Foundation
import Testing

@testable import DraftRoom

extension StubbedNetwork {
    /// The Lineup tab (APE-382): staging swaps from the season route's seats and eligible slots, the
    /// resets, and the save from consent to result against the lineup route's fixtures (APE-381).
    @MainActor
    @Suite
    struct LineupModelTests {
        let api: APIClient
        let cache: SeasonCache
        let defaults: UserDefaults

        // The pregame fixture's team: seats QB RB RB WR WR TE FLEX DST K.
        static let gibbs = 4429795, cook = 4379399, chaseBrown = 4362238, london = 4426502
        static let javonte = 4361579, mcLaurin = 3121422

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
            api = APIClient(baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
            cache = SeasonCache(folder: FileManager.default.temporaryDirectory.appending(path: "lineup-tests-\(UUID().uuidString)"))
            defaults = UserDefaults(suiteName: "lineup-tests-\(UUID().uuidString)")!
        }

        /// A model over the pregame season, with each route answered from its fixture.
        private func model(season: Data = Fixture.data("season-pregame"), routes: [String: StubURLProtocol.Reply] = [:]) async -> LineupModel {
            StubURLProtocol.reply = { request in
                let path = request.url?.path() ?? ""
                let key = request.url?.query()?.contains("dryRun=1") == true ? "\(path)?dryRun" : path
                if let reply = routes[key] { return reply }
                return .init(status: 200, body: season)
            }
            let store = SeasonStore(api: api, leagueId: "lg-1", cache: cache)
            await store.start()
            return LineupModel(api: api, store: store, defaults: defaults)
        }

        private static let lineupPath = "/api/v1/leagues/lg-1/lineup"
        private static func ok(_ fixture: String) -> StubURLProtocol.Reply { .init(status: 200, body: Fixture.data(fixture)) }

        private static func sent(_ request: URLRequest?) throws -> [String: Any] {
            let body = try #require(request?.httpBody)
            return try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
        }

        private func lineupRequests() -> [URLRequest] {
            StubURLProtocol.requests.filter { $0.url?.path() == Self.lineupPath }
        }

        /// The pregame season with one player's game under way.
        private static func season(locking playerId: Int) throws -> Data {
            var json = try #require(JSONSerialization.jsonObject(with: Fixture.data("season-pregame")) as? [String: Any])
            var view = try #require(json["view"] as? [String: Any])
            var teams = try #require(view["teams"] as? [[String: Any]])
            for t in teams.indices {
                guard var roster = teams[t]["roster"] as? [[String: Any]] else { continue }
                for p in roster.indices where roster[p]["playerId"] as? Int == playerId { roster[p]["locked"] = true }
                teams[t]["roster"] = roster
            }
            view["teams"] = teams
            json["view"] = view
            return try JSONSerialization.data(withJSONObject: json)
        }

        // MARK: Staging

        @Test func startsFromDraftRoomsLineupWithNothingToSave() async {
            let model = await model()
            #expect(model.staged == model.recommended)
            #expect(model.seats == ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DST", "K"])
            #expect(!model.hasChanges)
            #expect(!model.hasUnsavedEdits)
        }

        @Test func offersOnlyLegalSwaps() async {
            let model = await model()
            let rb = model.options(for: 1)
            #expect(rb.first?.playerId == Self.gibbs) // War Room's pick, which is also ESPN's, leads
            #expect(rb.allSatisfy { $0.pos == "RB" })
            #expect(model.options(for: 6).allSatisfy { ["RB", "WR", "TE"].contains($0.pos) })
            #expect(model.options(for: 0).map(\.pos) == ["QB"])

            let mcLaurin = model.player(Self.mcLaurin)!
            #expect(model.seats(for: mcLaurin) == [3, 4, 6]) // WR, WR, FLEX
        }

        @Test func stagesASwapAndCountsTheSeat() async {
            let model = await model()
            model.choose(2, Self.javonte)
            #expect(model.staged[2] == Self.javonte)
            #expect(model.changedSeats == [2])
            #expect(model.hasUnsavedEdits)
            #expect(model.staged.filter { $0 == Self.cook }.isEmpty) // Cook goes to the bench
        }

        @Test func twoRunningBacksTradingSeatsIsNoChange() async {
            let model = await model()
            model.choose(1, Self.cook) // Cook from the second RB seat into the first
            #expect(model.staged == model.onEspn)
            #expect(!model.hasChanges)
        }

        @Test func swapsTwoStartersWhenTheOtherSeatCanTakeHim() async {
            let model = await model()
            model.choose(6, Self.london) // London from WR into FLEX: Chase Brown can't play WR, so the WR seat empties
            #expect(model.staged[6] == Self.london)
            #expect(model.staged[4] == nil)
            model.choose(4, Self.mcLaurin)
            #expect(model.changedSeats == [4, 6])
        }

        @Test func resetsToESPNOrToDraftRoomInOneTap() async {
            let model = await model()
            model.choose(2, Self.javonte)
            model.startFromEspn()
            #expect(model.staged == model.onEspn)
            #expect(!model.hasUnsavedEdits)
            model.choose(4, Self.mcLaurin)
            model.startFromDraftRoom()
            #expect(model.staged == model.recommended)
            #expect(!model.hasUnsavedEdits)
        }

        @Test func lockedPlayersStayPut() async throws {
            let model = await model(season: try Self.season(locking: Self.gibbs))
            #expect(model.isLocked(1))
            #expect(!model.options(for: 2).contains { $0.playerId == Self.gibbs })
            let javonte = try #require(model.player(Self.javonte))
            #expect(!model.seats(for: javonte).contains(1))
        }

        @Test func theShellAsksBeforeDiscardingEdits() async throws {
            let shell = ShellModel(api: api, defaults: defaults)
            StubURLProtocol.reply = { request in
                request.url?.path() == "/api/v1/leagues"
                    ? .init(status: 200, body: Data(#"{"leagues":[{"id":"lg-1","name":"App Tester","espnLeagueId":"704343562","espnTeamId":1,"season":2026}]}"#.utf8))
                    : .init(status: 200, body: Fixture.data("season-pregame"))
            }
            await shell.refresh()
            let league = try #require(shell.selected)
            await shell.season(for: league).start()
            let lineup = shell.lineup(for: league)
            lineup.sync()
            #expect(!shell.hasUnsavedLineup)
            lineup.choose(2, Self.javonte)
            #expect(shell.hasUnsavedLineup)
            #expect(shell.lineup(for: league) === lineup) // kept across tab switches
        }

        // MARK: Saving

        @Test func asksForConsentFirstThenListsTheChanges() async throws {
            let model = await model(routes: [
                "/api/v1/espn/write-consent": Self.ok("write-consent"),
                "\(Self.lineupPath)?dryRun": Self.ok("lineup-dry-run"),
            ])
            model.choose(2, Self.javonte)
            await model.review()
            guard case let .consent(version, lines) = model.phase else { Issue.record("expected consent, got \(model.phase)"); return }
            #expect(version == 2 && !lines.isEmpty)
            #expect(lineupRequests().isEmpty)

            await model.agree(version: version)
            let consent = try Self.sent(StubURLProtocol.requests.first { $0.url?.path() == "/api/v1/espn/write-consent" })
            #expect(consent["version"] as? Int == 2)
            guard case let .review(dry) = model.phase else { Issue.record("expected review, got \(model.phase)"); return }
            #expect(dry.changes.map(\.text) == ["Start Javonte Williams at RB, bench James Cook III", "Start Terry McLaurin at WR, bench Drake London"])

            let body = try Self.sent(lineupRequests().last)
            #expect(body["changes"] == nil)
            #expect((body["lineup"] as? [Any])?.count == 9)
            #expect((body["snapshot"] as? [Any])?.isEmpty == false)
        }

        @Test func togglesAskTheServerAgainWithTheTickedChanges() async throws {
            let model = await model(season: try Self.agreed(), routes: ["\(Self.lineupPath)?dryRun": Self.ok("lineup-dry-run")])
            model.choose(2, Self.javonte)
            await model.review()
            #expect(lineupRequests().count == 1)
            await model.toggle("4426502:BN,3121422:WR", on: false)
            #expect(lineupRequests().count == 2)
            let body = try Self.sent(lineupRequests().last)
            #expect(body["changes"] as? [String] == ["4379399:BN,4361579:RB"])
            #expect(model.picked == ["4379399:BN,4361579:RB"])
        }

        @Test func savesTheTickedChangesAndPlaysLockInOncePerWeek() async throws {
            let model = await model(season: try Self.agreed(), routes: [
                "\(Self.lineupPath)?dryRun": Self.ok("lineup-dry-run"),
                Self.lineupPath: Self.ok("lineup-applied"),
            ])
            model.choose(2, Self.javonte)
            await model.review()
            await model.send()
            guard case let .saved(applied) = model.phase else { Issue.record("expected saved, got \(model.phase)"); return }
            #expect(applied.allLanded)
            #expect(model.moment?.headline == "Lineup locked")
            #expect(model.momentIsNew)
            #expect(try Self.sent(lineupRequests().last)["changes"] as? [String] == ["4379399:BN,4361579:RB", "4426502:BN,3121422:WR"])
            // The season is read again, skipping the server's cache, so Game day matches.
            #expect(StubURLProtocol.requests.last?.url?.query() == "refresh=1")

            await model.review()
            await model.send()
            #expect(model.moment != nil && !model.momentIsNew)
        }

        @Test func showsEachChangeThatDidntLand() async throws {
            let model = await model(season: try Self.agreed(), routes: [
                "\(Self.lineupPath)?dryRun": Self.ok("lineup-dry-run"),
                Self.lineupPath: Self.ok("lineup-partial"),
            ])
            model.choose(2, Self.javonte)
            await model.review()
            await model.send()
            let save = try #require(model.lastSave)
            #expect(!save.allLanded)
            #expect(save.changes.first { !$0.landed }?.result == "Only part of this landed on ESPN: Drake London didn't move. Check it there.")
            #expect(model.moment == nil)
        }

        @Test func saysWhyESPNWontTakeIt() async throws {
            let model = await model(season: try Self.agreed(), routes: [
                "\(Self.lineupPath)?dryRun": Self.ok("lineup-dry-run"),
                Self.lineupPath: .init(status: 409, body: Fixture.data("lineup-refused")),
            ])
            model.choose(2, Self.javonte)
            await model.review()
            await model.send()
            #expect(model.phase == .failed("This can't be done on ESPN. Nothing was sent.", details: ["James Cook III's game has started, so ESPN won't move them this week."]))
        }

        @Test func asksForConsentAgainWhenTheServerSaysItsOutOfDate() async throws {
            let model = await model(season: try Self.agreed(), routes: [
                "\(Self.lineupPath)?dryRun": Self.ok("lineup-dry-run"),
                Self.lineupPath: .init(status: 409, body: Fixture.data("lineup-consent")),
            ])
            model.choose(2, Self.javonte)
            await model.review()
            await model.send()
            guard case .consent = model.phase else { Issue.record("expected consent, got \(model.phase)"); return }
        }

        @Test func neverQueuesASaveOffline() async throws {
            let model = await model(season: try Self.agreed(), routes: ["\(Self.lineupPath)?dryRun": Self.ok("lineup-dry-run")])
            model.choose(2, Self.javonte)
            await model.review()
            StubURLProtocol.reply = nil // the network drops
            await model.send()
            guard case let .failed(message, _) = model.phase else { Issue.record("expected failed, got \(model.phase)"); return }
            #expect(message.contains("offline"))
            StubURLProtocol.reply = Self.reply(Fixture.data("season-pregame"))
            await model.store.refresh()
            #expect(lineupRequests().count == 2) // the dry run and the one failed send, nothing replayed
        }

        /// The pregame season with the write consent already given.
        private static func agreed() throws -> Data {
            var json = try #require(JSONSerialization.jsonObject(with: Fixture.data("season-pregame")) as? [String: Any])
            var consent = try #require(json["consent"] as? [String: Any])
            consent["agreed"] = true
            json["consent"] = consent
            return try JSONSerialization.data(withJSONObject: json)
        }

        private static func reply(_ body: Data) -> @Sendable (URLRequest) -> StubURLProtocol.Reply {
            { _ in .init(status: 200, body: body) }
        }
    }
}
