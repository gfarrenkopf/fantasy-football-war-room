import Foundation
import Testing

@testable import DraftRoom

extension StubbedNetwork {
    /// Game day's season (APE-380): decoding the season route's fixtures, and the store's reads,
    /// device cache, problems, opening tab and live polling.
    @MainActor
    @Suite
    struct SeasonStoreTests {
        let api: APIClient
        let cache: SeasonCache

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
            api = APIClient(baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
            cache = SeasonCache(folder: FileManager.default.temporaryDirectory.appending(path: "season-tests-\(UUID().uuidString)"))
        }

        private func store() -> SeasonStore { SeasonStore(api: api, leagueId: "lg-1", cache: cache) }

        private static func reply(_ fixture: String) -> @Sendable (URLRequest) -> StubURLProtocol.Reply {
            { _ in .init(status: 200, body: Fixture.data(fixture)) }
        }

        @Test(arguments: ["season-pregame", "season-live", "season-final", "season-startsit", "season-banked", "season-holes", "season-final-loss", "season-between"])
        func decodesTheSeasonRoutesFixtures(_ name: String) throws {
            let season = try APIClient.decoder.decode(SeasonResponse.self, from: Fixture.data(name))
            let mine = try #require(season.gameDayView.team(season.gameDayView.myTeamId))
            #expect(!mine.roster.isEmpty)
            #expect(season.gameDay.bench.playerIds.allSatisfy { season.gameDayView.player($0) != nil })
            for row in season.gameDay.headToHead {
                if let id = row.me { #expect(season.gameDay.pace(of: id) != nil) }
            }
        }

        @Test func pregameOpensOnLineupLiveAndFinalOnGameDay() throws {
            let pregame = try APIClient.decoder.decode(SeasonResponse.self, from: Fixture.data("season-pregame"))
            #expect(pregame.phase == .lineup && pregame.defaultTab == "lineup")
            #expect(pregame.live?.started == false && pregame.live?.status == "Up next")
            let live = try APIClient.decoder.decode(SeasonResponse.self, from: Fixture.data("season-live"))
            #expect(live.phase == .live && live.live?.live == true && !live.gameDay.around.isEmpty)
            let final = try APIClient.decoder.decode(SeasonResponse.self, from: Fixture.data("season-final"))
            #expect(final.phase == .results && final.live?.decided == true && final.result != nil)
        }

        @Test func readsTheSeasonAndKeepsItOnTheDevice() async throws {
            StubURLProtocol.reply = Self.reply("season-live")
            let store = store()
            await store.start()
            #expect(store.load == .ready)
            #expect(store.isLive)
            #expect(store.openingTab == .gameDay)
            #expect(StubURLProtocol.requests.last?.url?.path() == "/api/v1/leagues/lg-1/season")
            #expect(StubURLProtocol.requests.last?.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
            #expect(cache.read("lg-1")?.league == store.season?.league)
        }

        @Test func pullToRefreshSkipsTheServersCache() async throws {
            StubURLProtocol.reply = Self.reply("season-pregame")
            let store = store()
            await store.refresh(force: true)
            #expect(StubURLProtocol.requests.last?.url?.query() == "refresh=1")
            #expect(store.openingTab == .lineup)
        }

        @Test func showsTheKeptSeasonOfflineAndSaysSo() async throws {
            StubURLProtocol.reply = Self.reply("season-live")
            await store().start()
            StubURLProtocol.reply = nil // no network

            let offline = store()
            await offline.start()
            #expect(offline.load == .ready)
            #expect(offline.offline)
            #expect(offline.season?.league.id == "lg-1")
            #expect(offline.openingTab == .gameDay)
        }

        @Test func failsWithNothingKept() async {
            let store = store()
            await store.start()
            #expect(store.load == .failed(APIError.offline.message))
            #expect(store.openingTab == nil)
        }

        @Test func offersToReconnectWhenESPNSignedDraftRoomOut() async {
            StubURLProtocol.reply = { _ in .init(status: 409, body: Data(#"{"error":"ESPN signed Draft Room out.","problem":"disconnected"}"#.utf8)) }
            let store = store()
            await store.start()
            #expect(store.load == .problem("ESPN signed Draft Room out.", reconnect: true))

            StubURLProtocol.reply = { _ in .init(status: 409, body: Data(#"{"error":"Couldn't reach ESPN.","problem":"unavailable"}"#.utf8)) }
            await store.refresh()
            #expect(store.load == .problem("Couldn't reach ESPN.", reconnect: false))
        }

        @Test func keepsTheFirstOpeningTab() async {
            StubURLProtocol.reply = Self.reply("season-pregame")
            let store = store()
            await store.start()
            StubURLProtocol.reply = Self.reply("season-live")
            await store.refresh()
            #expect(store.season?.phase == .live)
            #expect(store.openingTab == .lineup)
        }

        @Test func pollsOnlyWhileAGameIsOn() async throws {
            StubURLProtocol.reply = Self.reply("season-live")
            let live = store()
            await live.start()
            let before = StubURLProtocol.requests.count
            let polling = Task { await live.poll(every: .milliseconds(20)) }
            try await Task.sleep(for: .milliseconds(150))
            polling.cancel()
            await polling.value
            #expect(StubURLProtocol.requests.count > before)

            // Once it's cancelled (the screen went away, or the app went to the background), it stops.
            let after = StubURLProtocol.requests.count
            try await Task.sleep(for: .milliseconds(80))
            #expect(StubURLProtocol.requests.count == after)

            StubURLProtocol.reply = Self.reply("season-pregame")
            let quiet = store()
            await quiet.start()
            let start = StubURLProtocol.requests.count
            let idle = Task { await quiet.poll(every: .milliseconds(20)) }
            try await Task.sleep(for: .milliseconds(120))
            idle.cancel()
            await idle.value
            #expect(StubURLProtocol.requests.count == start)
        }

        @Test func clearingForgetsEveryKeptSeason() async {
            StubURLProtocol.reply = Self.reply("season-live")
            await store().start()
            cache.clear()
            #expect(cache.read("lg-1") == nil)
        }
    }
}

@Suite
struct SeasonFormatTests {
    @Test func saysTheLeadInWords() {
        #expect(SeasonFormat.lead(4.26, started: true, decided: false) == "Up 4.3")
        #expect(SeasonFormat.lead(-13.5, started: true, decided: false) == "Down 13.5")
        #expect(SeasonFormat.lead(17.6, started: true, decided: true) == "Won by 17.6")
        #expect(SeasonFormat.lead(-2, started: true, decided: true) == "Lost by 2.0")
        #expect(SeasonFormat.lead(0, started: true, decided: false) == "Tied")
        #expect(SeasonFormat.lead(0, started: false, decided: false) == "vs")
    }

    @Test func namesHolesLikeTheWeb() {
        #expect(SeasonFormat.slots(["RB"]) == "RB")
        #expect(SeasonFormat.slots(["QB", "TE"]) == "QB and TE")
        #expect(SeasonFormat.slots(["QB", "RB", "RB", "DST"]) == "QB, RB and D/ST")
    }

    @Test func shortensNamesButNotDefenses() {
        let player = { (name: String, pos: String) in
            ViewPlayer(playerId: 1, name: name, pos: pos, team: nil, slot: "BN", injuryStatus: "ACTIVE", locked: false, actual: nil, points: 0, game: nil)
        }
        #expect(SeasonFormat.shortName(player("Jahmyr Gibbs", "RB")) == "J. Gibbs")
        #expect(SeasonFormat.shortName(player("Amon-Ra St. Brown", "WR")) == "A. St. Brown")
        #expect(SeasonFormat.shortName(player("Lions D/ST", "DST")) == "Lions D/ST")
    }

    @Test func tellsTheGameLikeTheWeb() {
        let score = GameState.Score(team: 24, opponent: 17)
        #expect(SeasonFormat.game(GameState(state: "in", detail: "8:12 - 3rd", opponent: "NYJ", home: false, kickoff: nil, score: score)) == "@ NYJ · 24–17 · 8:12 - 3rd")
        #expect(SeasonFormat.game(GameState(state: "post", detail: "", opponent: "NYJ", home: true, kickoff: nil, score: score)) == "vs NYJ · W 24–17 · Final")
        #expect(SeasonFormat.gameWhen(GameState(state: "post", detail: "", opponent: "NYJ", home: true, kickoff: nil, score: score)) == "Final")
    }

    @Test func saysWhenTheSeasonWasRead() {
        let now = Date()
        #expect(SeasonFormat.updated(now.addingTimeInterval(-20), now: now) == "Updated just now")
        #expect(SeasonFormat.updated(now.addingTimeInterval(-300), now: now) == "Updated 5 min ago")
    }
}
