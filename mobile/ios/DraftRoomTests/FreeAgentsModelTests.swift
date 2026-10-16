import Foundation
import Testing

@testable import DraftRoom

extension StubbedNetwork {
    /// The Waivers tab's free-agent search (APE-411): team/players searched by name and position,
    /// paged, and read again after an add.
    @MainActor
    @Suite
    struct FreeAgentsModelTests {
        let api: APIClient

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
            api = APIClient(baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
        }

        private static let path = "/api/v1/leagues/lg-1/team/players"

        /// Answers team/players with page one, or page two when asked past the first page.
        private func model(status: Int = 200) -> FreeAgentsModel {
            StubURLProtocol.reply = { request in
                let paged = request.url?.query()?.contains("offset=") == true
                if status != 200 { return .init(status: status, body: Data(#"{"error":"ESPN couldn't be read for this league","problem":"unavailable"}"#.utf8)) }
                return .init(status: 200, body: Fixture.data(paged ? "team-players-page2" : "team-players"))
            }
            return FreeAgentsModel(api: api, leagueId: "lg-1", debounce: .zero)
        }

        private func queries() -> [String] {
            StubURLProtocol.requests.filter { $0.url?.path() == Self.path }.map { $0.url?.query() ?? "" }
        }

        /// Waits for the debounced search to land.
        private func settle(_ model: FreeAgentsModel, queries count: Int) async {
            for _ in 0 ..< 100 where queries().count < count || model.load == .loading {
                try? await Task.sleep(for: .milliseconds(10))
            }
        }

        @Test func browsesTheMostRosteredFirstWithoutAName() async {
            let model = model()
            await model.start()
            #expect(queries() == [""])
            #expect(model.load == .ready)
            #expect(model.players.map(\.player.name) == ["Bijan Robinson", "CeeDee Lamb", "Drake Maye"])
            #expect(model.more)
        }

        @Test func searchesByNameAndPositionOnceTheNameHasTwoLetters() async {
            let model = model()
            await model.start()
            model.search("b")
            model.search("b ")
            model.choose(position: "RB")
            await settle(model, queries: 2)
            model.search("Bijan R")
            await settle(model, queries: 3)
            #expect(queries() == ["", "pos=RB", "q=Bijan%20R&pos=RB"])
        }

        @Test func showsASearchAlreadyAnsweredWithoutAskingAgainUntilAReload() async {
            let model = model()
            await model.start()
            model.choose(position: "RB")
            await settle(model, queries: 2)
            model.choose(position: nil)
            #expect(model.load == .ready)
            #expect(model.players.count == 3)
            model.choose(position: "RB")
            #expect(queries() == ["", "pos=RB"])
            await model.reload()
            #expect(queries() == ["", "pos=RB", "pos=RB"])
        }

        @Test func listsRosteredPlayersAmongTheFreeAgentsByHowWidelyTheyreRostered() async throws {
            var page = try #require(JSONSerialization.jsonObject(with: Fixture.data("team-players")) as? [String: Any])
            var players = try #require(page["players"] as? [[String: Any]])
            for (i, owned) in [90, 40, 10].enumerated() {
                var player = try #require(players[i]["player"] as? [String: Any])
                player["ownership"] = ["owned": owned, "started": 1]
                players[i]["player"] = player
            }
            var star = try #require(players[0]["player"] as? [String: Any])
            star["playerId"] = 77
            star["name"] = "Rostered Star"
            star["ownership"] = ["owned": 60, "started": 50]
            page["players"] = players
            page["rostered"] = [["player": star, "teamId": 2, "team": "Gridiron Gang", "mine": false]]
            let body = try JSONSerialization.data(withJSONObject: page)
            StubURLProtocol.reply = { _ in .init(status: 200, body: body) }
            let model = FreeAgentsModel(api: api, leagueId: "lg-1", debounce: .zero)
            await model.start()
            #expect(model.rows.map(\.id) == ["free-4430807", "team-77", "free-\(model.players[1].id)", "free-\(model.players[2].id)"])
            guard case let .team(rostered) = model.rows[1] else { Issue.record("expected a rostered row"); return }
            #expect(rostered.team == "Gridiron Gang")
        }

        @Test func pagesOnPastThePlayersShownWithoutRepeatingThem() async {
            let model = model()
            await model.start()
            await model.loadMore()
            #expect(queries().last == "offset=3")
            #expect(model.players.map(\.player.name) == ["Bijan Robinson", "CeeDee Lamb", "Drake Maye", "Brock Bowers"])
            #expect(!model.more)
            await model.loadMore()
            #expect(queries().count == 2)
        }

        @Test func saysWhyWhenESPNCantBeRead() async {
            let model = model(status: 409)
            await model.start()
            guard case let .failed(message) = model.load else { Issue.record("expected a failure"); return }
            #expect(!message.isEmpty)
            #expect(model.players.isEmpty)
        }
    }
}
