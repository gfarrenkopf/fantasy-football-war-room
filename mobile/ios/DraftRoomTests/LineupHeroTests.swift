import Foundation
import Testing

@testable import DraftRoom

extension StubbedNetwork {
    /// The Lineup tab's hero (APE-403): which verdict leads, how loud it is, "Use Draft Room's
    /// lineup" filling the editor, the "Started by Draft Room" marker, and the hole card's words.
    @MainActor
    @Suite
    struct LineupHeroTests {
        let api: APIClient
        let cache: SeasonCache
        let defaults: UserDefaults

        // The fixtures' team (see .research/ape403): London is out at WR, Javonte Williams outprojects
        // Chase Brown at FLEX, and Gibbs is War Room's move at RB.
        static let allen = 3918298, gibbs = 4429795, london = 4426502, egbuka = 4567750
        static let javonte = 4361579, warren = 4431459

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
            api = APIClient(baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
            cache = SeasonCache(folder: FileManager.default.temporaryDirectory.appending(path: "hero-tests-\(UUID().uuidString)"))
            defaults = UserDefaults(suiteName: "hero-tests-\(UUID().uuidString)")!
        }

        private func model(_ fixture: String) async -> LineupModel {
            let body = Fixture.data(fixture)
            StubURLProtocol.reply = { _ in .init(status: 200, body: body) }
            let store = SeasonStore(api: api, leagueId: "lg-1", cache: cache)
            await store.start()
            return LineupModel(api: api, store: store, defaults: defaults)
        }

        // MARK: Decoding

        @Test func decodesTheStartSitHeroAndItsMarkers() throws {
            let season = try APIClient.decoder.decode(SeasonResponse.self, from: Fixture.data("season-startsit"))
            let sit = season.lineup.startSit
            #expect(sit.level == "must")
            #expect(sit.headline == "Points stuck on your bench")
            #expect(sit.swaps.count == 2)
            #expect(sit.swaps[0].into == Self.egbuka && sit.swaps[0].out == Self.london)
            #expect(sit.swaps[0].tag == .init(label: "OUT", kind: "out"))
            #expect(sit.swaps[1].tag == nil)
            #expect(sit.banked == 3.2)
            #expect(season.view.warRoomMoves == [WarRoomMove(playerId: Self.gibbs, slot: "RB", gain: 3.2)])
            #expect(season.view.matchup?.me.winProbability == 0.58)
        }

        @Test func decodesHolesWithTheirKickoff() throws {
            let season = try APIClient.decoder.decode(SeasonResponse.self, from: Fixture.data("season-holes"))
            #expect(season.lineup.holes.map(\.kind) == ["hard", "soft"])
            #expect(season.lineup.holes[0].kickoff == ISO8601DateFormatter().date(from: "2026-09-20T17:00:00Z"))
        }

        // MARK: Which hero leads

        @Test func suggestionsLeadWithTheStartSitVerdict() async {
            let model = await model("season-startsit")
            #expect(model.hero == .startSit)
            #expect(model.isSuggesting)
            #expect(model.softHoles.isEmpty)
        }

        @Test func espnHavingDraftRoomsLineupShowsBanked() async {
            #expect(await model("season-banked").hero == .banked)
            // No moves on record, but nothing to suggest or staged: still "Your lineup is set".
            #expect(await model("season-pregame").hero == .banked)
        }

        @Test func anEditWithNothingBankedShowsTheRestingVerdict() async {
            let model = await model("season-pregame")
            model.choose(2, Self.javonte)
            #expect(model.hero == .startSit)
        }

        @Test func aHardHoleTakesTheHeroAndASoftOneIsANote() async {
            let model = await model("season-holes")
            guard case let .holes(holes) = model.hero else { Issue.record("expected the hole card"); return }
            #expect(holes.map(\.key) == ["QB"])
            #expect(model.softHoles.map(\.key) == ["TE"])
        }

        // MARK: Emphasis

        @Test func theVerdictGrowsWithTheGain() {
            let levels = ["rest", "trim", "gain", "swing", "must"].map(HeroEmphasis.init(level:))
            #expect(!levels[0].toned)
            #expect(levels.dropFirst().allSatisfy { $0.toned })
            #expect(levels.dropFirst().map(\.numberSize) == levels.dropFirst().map(\.numberSize).sorted())
            #expect(levels.map(\.wash) == [0, 0, 0, 0.09, 0.14])
            #expect(levels.map(\.breathes) == [false, false, false, false, true])
            #expect(HeroEmphasis(level: "unknown") == levels[0])
        }

        @Test(arguments: [(0.04, "rest"), (0.05, "trim"), (1, "gain"), (4.9, "gain"), (5, "swing"), (10, "must")])
        func bankedPointsPickTheWebsLevels(_ points: Double, _ level: String) {
            #expect(HeroEmphasis.level(points) == level)
        }

        // MARK: Use Draft Room's lineup

        @Test func useDraftRoomsLineupFillsTheEditor() async {
            let model = await model("season-startsit")
            #expect(model.isRecommended) // staged from the start; the button only shows once it isn't
            model.startFromEspn()
            #expect(!model.hasChanges)
            model.startFromDraftRoom()
            #expect(model.staged == model.recommended)
            #expect(model.changedSeats == [4, 6]) // WR (London out) and FLEX
            #expect(model.phase == .idle) // nothing sent: the save goes through the review
            #expect(StubURLProtocol.requests.allSatisfy { $0.url?.path() != "/api/v1/leagues/lg-1/lineup" })
        }

        @Test func wordsEachSuggestedSwap() async throws {
            let model = await model("season-startsit")
            let swaps = try #require(model.lineup?.startSit.swaps).map { HeroSwap($0, model: model) }
            #expect(swaps.map(\.text) == ["Start Emeka Egbuka over Drake London", "Start Javonte Williams over Chase Brown"])
        }

        // MARK: Started by Draft Room

        @Test func marksTheStarterDraftRoomMoved() async {
            let model = await model("season-startsit")
            #expect(model.madeMove(at: 1)?.gain == 3.2)
            #expect(model.madeMove(at: 2) == nil)
            model.choose(1, Self.javonte) // he's coming out: no marker on a row that's changing
            #expect(model.madeMove(at: 1) == nil)
        }

        // MARK: Hole card

        @Test func saysWhichSlotIsEmptyAndWhy() async throws {
            let model = await model("season-holes")
            let holes = try #require(model.lineup?.holes)
            #expect(HoleText.headline([holes[0]]) == "Hole at QB")
            #expect(HoleText.why(holes[0], holder: model.player(Self.allen)) == "Josh Allen OUT · no one else on your team can play QB")
            #expect(HoleText.soft(holes[1], holder: model.player(Self.warren)) == "Tyler Warren is doubtful, with no backup at TE.")
        }

        @Test func wordsByesEmptySlotsAndLikelyOuts() {
            let bye = Hole(key: "RB", kind: "hard", reason: "bye", playerId: 1)
            let player = SeasonSample.player(1, "Joe Smith", "RB", slot: "RB", actual: nil, points: 0, game: nil)
            #expect(HoleText.why(bye, holder: player) == "Joe Smith is on a bye · no one else on your team can play RB")
            #expect(HoleText.why(Hole(key: "SUPERFLEX", kind: "hard", reason: "empty", playerId: nil), holder: nil) == "Nobody on your team can play OP.")
            #expect(HoleText.headline([bye, Hole(key: "TE", kind: "hard", reason: "out", playerId: 2)]) == "Holes at RB and TE")
            #expect(HoleText.soft(Hole(key: "WR", kind: "soft", reason: "likely-out", playerId: nil), holder: nil) == "Your WR may sit: ESPN projects him for 0, with no backup at WR.")
        }

        @Test func suggestsAPickupOnlyInsideADayOfKickoff() {
            let kickoff = Date(timeIntervalSince1970: 1_790_000_000)
            let hole = Hole(key: "TE", kind: "soft", reason: "doubtful", playerId: 1, kickoff: kickoff)
            #expect(!HoleText.soon(hole, now: kickoff.addingTimeInterval(-2 * 24 * 3600)))
            #expect(HoleText.soon(hole, now: kickoff.addingTimeInterval(-3600)))
            #expect(!HoleText.soon(Hole(key: "TE", kind: "soft", reason: "doubtful", playerId: 1), now: kickoff))
        }
    }
}
