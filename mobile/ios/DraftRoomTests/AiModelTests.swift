import Foundation
import Testing

@testable import DraftRoom

extension StubbedNetwork {
    /// In-season AI (APE-391): the AI routes' fixtures decoded (APE-390), the AI lineup staged in the
    /// editor, and the locked and hidden states.
    @MainActor
    @Suite
    struct AiModelTests {
        let api: APIClient
        let cache: SeasonCache

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
            api = APIClient(baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
            cache = SeasonCache(folder: FileManager.default.temporaryDirectory.appending(path: "ai-tests-\(UUID().uuidString)"))
        }

        private static let aiPath = "/api/v1/leagues/lg-1/ai"

        /// The pregame season, with the AI routes answered as given.
        private func store(ai: [String: StubURLProtocol.Reply]) async -> SeasonStore {
            StubURLProtocol.reply = { request in
                let path = request.url?.path() ?? ""
                if let reply = ai[path] { return reply }
                return .init(status: 200, body: Fixture.data("season-pregame"))
            }
            let store = SeasonStore(api: api, leagueId: "lg-1", cache: cache)
            await store.start()
            return store
        }

        private static func ok(_ fixture: String) -> StubURLProtocol.Reply { .init(status: 200, body: Fixture.data(fixture)) }

        @Test func decodesTheTrialWithItsLineupAndIdeas() throws {
            let ai = try APIClient.decoder.decode(AiResponse.self, from: Fixture.data("ai-trial"))
            #expect(ai.access.state == "trial")
            #expect(ai.access.note == "Free trial · week 2 of 5")
            #expect(ai.lineupAction == "rewrite")
            let lineup = try #require(ai.lineup)
            #expect(lineup.departures?.hasPrefix("Start Jeremiyah Love over Chase Brown at FLEX") == true)
            #expect(lineup.calls.map(\.slot) == ["QB", "FLEX"])
            #expect(lineup.espn.matches == false)
            #expect(lineup.starters.count == 9)
            let idea = try #require(ai.ideas?.ideas.first)
            #expect(idea.label == "Win-win")
            #expect(idea.status == "ok")
            #expect(idea.grade != nil)
            #expect(ai.ideas?.missing == ["No bolder swing this week that a partner would plausibly take."])
        }

        @Test func decodesTheEmptyLockedAndWriteupFixtures() throws {
            let empty = try APIClient.decoder.decode(AiResponse.self, from: Fixture.data("ai-empty"))
            #expect(empty.access.state == "unlocked")
            #expect(empty.lineup == nil && empty.lineupAction == "write" && empty.canFindIdeas)
            let locked = try APIClient.decoder.decode(AiResponse.self, from: Fixture.data("ai-locked"))
            #expect(locked.access.isLocked)
            #expect(locked.access.note?.contains("draftroom.online") == true)
            #expect(locked.lineupAction == nil && !locked.canFindIdeas)
            let writeup = try APIClient.decoder.decode(AiWriteup.self, from: Fixture.data("ai-writeup"))
            #expect(writeup.leanLabel == "Counter")
            #expect(writeup.reasons.count == 2)
            #expect(writeup.counter?.get.count == 2)
        }

        @Test func stagesTheAiLineupInTheEditor() async throws {
            let store = await store(ai: [Self.aiPath: Self.ok("ai-trial")])
            let ai = AiModel(api: api, store: store)
            await ai.start()
            let lineup = LineupModel(api: api, store: store)
            let written = try #require(ai.ai?.lineup)
            #expect(!lineup.isStaged(ai: written.starters))

            lineup.startFromAi(written.starters)
            #expect(lineup.isStaged(ai: written.starters))
            // The one close call: the AI's FLEX in for the engine's.
            let flex = try #require(lineup.seats.firstIndex(of: "FLEX"))
            let aiFlex = try #require(written.starters.first { $0.key == "FLEX" }?.playerId)
            #expect(lineup.staged[flex] == aiFlex)
            #expect(lineup.changedSeats == [flex])
            #expect(lineup.hasChanges)
        }

        @Test func writesTheLineupAndShowsWhatTheServerSendsBack() async throws {
            let store = await store(ai: [Self.aiPath: Self.ok("ai-empty"), "\(Self.aiPath)/lineup": Self.ok("ai-trial")])
            let ai = AiModel(api: api, store: store)
            await ai.start()
            #expect(ai.ai?.lineupAction == "write")
            await ai.writeLineup()
            #expect(ai.ai?.lineup?.intro.isEmpty == false)
            #expect(ai.working == nil && ai.lineupError == nil)
            let write = try #require(StubURLProtocol.requests.last { $0.url?.path() == "\(Self.aiPath)/lineup" })
            #expect(write.httpMethod == "POST")
            #expect(write.timeoutInterval == AiModel.writeTimeout)
        }

        @Test func aLockedWriteReadsTheLockedState() async throws {
            let locked = StubURLProtocol.Reply(status: 402, body: Data(#"{"error":"Your free weeks of AI are over.","locked":true}"#.utf8))
            var replies = [Self.aiPath: Self.ok("ai-empty"), "\(Self.aiPath)/lineup": locked]
            let store = await store(ai: replies)
            let ai = AiModel(api: api, store: store)
            await ai.start()
            replies[Self.aiPath] = Self.ok("ai-locked")
            let after = replies
            StubURLProtocol.reply = { request in after[request.url?.path() ?? ""] ?? .init(status: 200, body: Fixture.data("season-pregame")) }
            await ai.writeLineup()
            #expect(ai.ai?.access.isLocked == true)
            #expect(ai.lineupError == nil)
        }

        @Test func showsNoAiToAnAccountWithout() async {
            let store = await store(ai: [Self.aiPath: .init(status: 403, body: Data(#"{"error":"In-season AI isn't available on this account yet"}"#.utf8))])
            let ai = AiModel(api: api, store: store)
            await ai.start()
            #expect(ai.load == .hidden)
        }

        @Test func aWriteFailureSaysWhyInTheServersWords() async {
            let failed = StubURLProtocol.Reply(status: 503, body: Data(#"{"error":"The AI lineup couldn't be written just now. The recommended lineup still stands."}"#.utf8))
            let store = await store(ai: [Self.aiPath: Self.ok("ai-empty"), "\(Self.aiPath)/lineup": failed])
            let ai = AiModel(api: api, store: store)
            await ai.start()
            await ai.writeLineup()
            #expect(ai.lineupError == "The AI lineup couldn't be written just now. The recommended lineup still stands.")
            #expect(ai.ai?.lineupAction == "write")
        }

        // MARK: Trade ideas and write-ups (APE-392)

        @Test func findsTradeIdeasAndSaysWhenThereAreNone() async throws {
            var none = try #require(JSONSerialization.jsonObject(with: Fixture.data("ai-empty")) as? [String: Any])
            none["none"] = true
            let noneBody = try JSONSerialization.data(withJSONObject: none)
            let store = await store(ai: [Self.aiPath: Self.ok("ai-empty"), "\(Self.aiPath)/trade-ideas": .init(status: 200, body: noneBody)])
            let ai = AiModel(api: api, store: store)
            await ai.start()
            await ai.findIdeas()
            #expect(ai.ideasNone)
            #expect(ai.ai?.canFindIdeas == true)

            let found = Self.ok("ai-trial")
            StubURLProtocol.reply = { request in
                request.url?.path() == "/api/v1/leagues/lg-1/ai/trade-ideas" ? found : .init(status: 200, body: Fixture.data("season-pregame"))
            }
            await ai.findIdeas()
            #expect(!ai.ideasNone)
            #expect(ai.ai?.ideas?.ideas.first?.label == "Win-win")
        }

        @Test func keysTheWriteupToItsTrade() async throws {
            let store = await store(ai: [Self.aiPath: Self.ok("ai-trial"), "\(Self.aiPath)/trade": Self.ok("ai-writeup")])
            let ai = AiModel(api: api, store: store)
            await ai.start()
            let trade = AiTradeRequest(partner: 2, gives: [1], gets: [2])
            await ai.writeUp(trade)
            #expect(ai.writeup(for: trade)?.leanLabel == "Counter")
            #expect(ai.writeup(for: AiTradeRequest(partner: 2, gives: [1], gets: [3])) == nil)
            let sent = try #require(StubURLProtocol.requests.last { $0.url?.path() == "\(Self.aiPath)/trade" }?.httpBody)
            let body = try #require(JSONSerialization.jsonObject(with: sent) as? NSDictionary)
            #expect(body == ["partner": 2, "gives": [1], "gets": [2]])
        }

        @Test func loadsAnIdeaIntoTheBuilderUntilEitherSideChanges() async throws {
            let store = await store(ai: [Self.aiPath: Self.ok("ai-trial")])
            let ai = AiModel(api: api, store: store)
            await ai.start()
            let trades = TradesModel(api: api, store: store)
            let idea = try #require(ai.ai?.ideas?.ideas.first)
            await trades.load(partner: idea.partner.id, gives: idea.gives.map(\.id), gets: idea.gets.map(\.id), idea: idea.kind)
            #expect(trades.loadedIdea == "safe")
            #expect(trades.loads == 1)
            #expect(trades.aiTrade == AiTradeRequest(partner: idea.partner.id, gives: idea.gives.map(\.id), gets: idea.gets.map(\.id)))

            trades.side = .get
            let more = try #require(trades.partner?.roster.first { !idea.gets.map(\.id).contains($0.playerId) })
            await trades.toggle(more.playerId)
            #expect(trades.loadedIdea == nil)
            #expect(trades.aiTrade?.gets.count == 2)
            trades.clear()
            #expect(trades.aiTrade == nil)
        }
    }
}
