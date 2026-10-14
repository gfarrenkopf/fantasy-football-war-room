import Foundation
import Testing
import UIKit

@testable import DraftRoom

extension StubbedNetwork {
    /// The recap archive (APE-384): decoding the recap routes' fixtures (.research/ape383), the list's
    /// order, the store's reads and device cache, the first-open moment, season links, and drawing
    /// the share card.
    @MainActor
    @Suite
    struct RecapTests {
        static let allen = 3918298

        let api: APIClient
        let cache: RecapCache
        let defaults = UserDefaults(suiteName: "recap-tests-\(UUID().uuidString)")!

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
            api = APIClient(baseURL: URL(string: "https://draftroom.online")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
            cache = RecapCache(folder: FileManager.default.temporaryDirectory.appending(path: "recap-tests-\(UUID().uuidString)"))
        }

        private func store() -> RecapsStore { RecapsStore(api: api, leagueId: "lg-1", cache: cache) }

        private func recap(_ fixture: String) throws -> RecapResponse {
            try APIClient.decoder.decode(RecapResponse.self, from: Fixture.data(fixture))
        }

        /// Answers the list with `recaps` and a week with `recap-win`, `recap-loss` or `recap-bye`.
        private static let routes: @Sendable (URLRequest) -> StubURLProtocol.Reply = { request in
            let path = request.url?.path() ?? ""
            let fixture = switch path {
            case "/api/v1/leagues/lg-1/recaps": "recaps"
            case "/api/v1/leagues/lg-1/recaps/1": "recap-win"
            case "/api/v1/leagues/lg-1/recaps/2": "recap-loss"
            case "/api/v1/leagues/lg-1/recaps/3": "recap-bye"
            default: ""
            }
            return fixture.isEmpty ? .init(status: 404, body: Data(#"{"error":"No recap for that week yet"}"#.utf8)) : .init(status: 200, body: Fixture.data(fixture))
        }

        // MARK: Decoding

        @Test func decodesTheArchiveNewestFirst() throws {
            let archive = try APIClient.decoder.decode(RecapsResponse.self, from: Fixture.data("recaps"))
            #expect(archive.league.name == "App Tester" && archive.seasons == [2026])
            #expect(archive.weeks.map(\.week) == [4, 3, 2, 1])
            #expect(archive.weeks(in: 2026).map(\.week) == [4, 3, 2, 1])
            #expect(archive.weeks(in: 2025).isEmpty)
            let newest = try #require(archive.weeks.first)
            #expect(newest.mine == RecapResult(result: .win, me: 118.6, them: 104.2, opponent: "Gridiron Gang"))
            #expect(newest.headline == "A 14.4-point win over Gridiron Gang." && !newest.settled)
            #expect(archive.weeks[1].mine == nil && archive.weeks[1].headline == "Bye week" && archive.weeks[1].settled)
            #expect(archive.weeks[2].mine?.result == .loss)
            #expect(archive.weeks[3].date == (try Date("2026-09-16T13:00:00.000Z", strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))))
            let empty = try APIClient.decoder.decode(RecapsResponse.self, from: Fixture.data("recaps-empty"))
            #expect(empty.weeks.isEmpty && empty.seasons.isEmpty)
        }

        @Test func weeksSortNewestFirstWithinASeason() {
            let at = Date(timeIntervalSince1970: 0)
            func week(_ season: Int, _ week: Int) -> RecapSummary {
                RecapSummary(season: season, week: week, headline: "", mine: nil, date: at, settled: true)
            }
            let archive = RecapsResponse(league: .init(id: "lg-1", name: "L"), seasons: [2026, 2025], weeks: [week(2025, 2), week(2026, 1), week(2025, 17), week(2026, 3)])
            #expect(archive.weeks(in: 2026).map(\.week) == [3, 1])
            #expect(archive.weeks(in: 2025).map(\.week) == [17, 2])
        }

        @Test func decodesAWinAsTheWebTellsIt() throws {
            let win = try recap("recap-win")
            #expect(win.key == RecapKey(season: 2026, week: 1) && win.settled)
            let league = win.recap
            #expect(league.mine?.result == .win && league.mine?.margin == 10.8)
            #expect(league.story.hasPrefix(win.headline))
            #expect(league.standings.first?.mine == true && league.standings.first?.record == "1–0")
            #expect(league.topScorers.first?.playerId == Self.allen && league.topScorers.count == 5)
            #expect(league.gameChanger?.player.playerId == Self.allen && league.gameChanger?.margin == 10.8)
            #expect(league.benchwarmers.count == 3 && league.falseStarters.allSatisfy { $0.gap < 0 })
            #expect(win.swing?.final == 10.8)
            let card = try #require(win.card)
            #expect(card.result == .win && card.starters.first?.playerId == Self.allen && card.star?.beat == true)
        }

        @Test func decodesALossAndABye() throws {
            let loss = try recap("recap-loss")
            #expect(loss.recap.mine?.result == .loss && loss.card?.result == .loss && loss.recap.gameChanger == nil)
            let bye = try recap("recap-bye")
            #expect(bye.mine == nil && bye.recap.mine == nil && bye.card == nil && bye.swing == nil)
            #expect(bye.headline == "Bye week" && bye.recap.story.isEmpty && !bye.recap.standings.isEmpty)
        }

        // MARK: The store

        @Test func readsTheArchiveAndAWeekAndKeepsThemOnTheDevice() async throws {
            StubURLProtocol.reply = Self.routes
            let store = store()
            await store.start()
            #expect(store.load == .ready && store.archive?.weeks.count == 4)
            #expect(StubURLProtocol.requests.last?.value(forHTTPHeaderField: "Authorization") == "Bearer tok")

            let key = RecapKey(season: 2026, week: 2)
            await store.open(key)
            #expect(StubURLProtocol.requests.last?.url?.path() == "/api/v1/leagues/lg-1/recaps/2")
            #expect(StubURLProtocol.requests.last?.url?.query() == "season=2026")
            guard case let .ready(recap) = store.weeks[key] else { Issue.record("week not ready"); return }
            #expect(recap.recap.mine?.result == .loss)
            #expect(cache.archive("lg-1")?.weeks.count == 4 && cache.week("lg-1", key)?.week == 2)
        }

        @Test func showsTheKeptArchiveOfflineAndSaysSo() async throws {
            StubURLProtocol.reply = Self.routes
            let first = store()
            await first.start()
            await first.open(RecapKey(season: 2026, week: 1))
            StubURLProtocol.reply = nil // no network

            let offline = store()
            await offline.start()
            #expect(offline.load == .ready && offline.offline && offline.archive?.weeks.count == 4)
            await offline.open(RecapKey(season: 2026, week: 1))
            #expect(offline.weeks[RecapKey(season: 2026, week: 1)].map { if case .ready = $0 { true } else { false } } == true)
            await offline.open(RecapKey(season: 2026, week: 2))
            #expect(offline.weeks[RecapKey(season: 2026, week: 2)] == .failed(APIError.offline.message))
        }

        @Test func failsWithNothingKept() async {
            let store = store()
            await store.start()
            #expect(store.load == .failed(APIError.offline.message) && store.archive == nil)
        }

        @Test func aWeekNotKeptSaysSo() async {
            StubURLProtocol.reply = Self.routes
            let store = store()
            await store.open(RecapKey(season: 2026, week: 9))
            #expect(store.weeks[RecapKey(season: 2026, week: 9)] == .failed("No recap for that week yet"))
        }

        // MARK: The moment

        @Test func theMomentPlaysOncePerLeagueAndWeek() {
            let moments = MomentStore(defaults: defaults)
            let week4 = RecapKey(season: 2026, week: 4)
            #expect(moments.claimRecap(leagueId: "lg-1", week4))
            #expect(!moments.claimRecap(leagueId: "lg-1", week4))
            #expect(moments.claimRecap(leagueId: "lg-1", RecapKey(season: 2026, week: 3)))
            #expect(moments.claimRecap(leagueId: "lg-2", week4))
            #expect(moments.claimRecap(leagueId: "lg-1", RecapKey(season: 2027, week: 4)))
            // Its own key: Win Night for the same week is a separate moment.
            #expect(MomentStore.recapKey(leagueId: "lg-1", week4) != MomentStore.winNightKey(leagueId: "lg-1", season: 2026, week: 4))
            #expect(MomentStore.recapKey(leagueId: "lg-1", week4).hasPrefix("moment:"))
        }

        // MARK: Season links

        @Test func buildsAndReadsTheShareLink() throws {
            let url = store().link(for: RecapKey(season: 2026, week: 4))
            #expect(url.absoluteString == "https://draftroom.online/season/lg-1?recap=2026-4")
            #expect(SeasonLink(url) == SeasonLink(leagueId: "lg-1", recap: RecapKey(season: 2026, week: 4)))
            #expect(SeasonLink(URL(string: "https://draftroom.online/season/lg-9")!) == SeasonLink(leagueId: "lg-9"))
            // A malformed week still opens the league.
            #expect(SeasonLink(URL(string: "https://draftroom.online/season/lg-9?recap=week4")!) == SeasonLink(leagueId: "lg-9"))
            #expect(SeasonLink(URL(string: "https://draftroom.online/draft")!) == nil)
            #expect(SeasonLink(URL(string: "https://draftroom.online/season/lg-9/extra")!) == nil)
            #expect(SeasonLink(URL(string: "draftroom://auth/callback?code=x")!) == nil)
            #expect(SeasonLink(URL(string: "draftroom://season/lg-1?recap=2026-2")!) == SeasonLink(leagueId: "lg-1", recap: RecapKey(season: 2026, week: 2)))
        }

        // MARK: The share card

        @Test(arguments: ["recap-win", "recap-loss"])
        func drawsTheShareCard(_ fixture: String) throws {
            let recap = try recap(fixture)
            let drawn = try #require(recap.card)
            let card = try #require(RecapCardImage(recap: drawn, league: recap.league.name))
            #expect(card.image.size.width * card.image.scale == 1080)
            #expect(card.image.size.height * card.image.scale == 1350)
            #expect(card.fileName == "app-tester-week-\(recap.week)-\(drawn.result.rawValue).png")
            #expect(card.image.pngData() != nil)
        }
    }
}
