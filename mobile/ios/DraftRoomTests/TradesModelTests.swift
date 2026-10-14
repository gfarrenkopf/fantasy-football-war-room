import Foundation
import Testing

@testable import DraftRoom

extension StubbedNetwork {
    /// The Trades tab (APE-405): the graded offers from team/trades with what each allows, the builder
    /// graded by a dry run, and accepting and proposing from consent to result, against the trades
    /// route's fixtures (APE-386).
    @MainActor
    @Suite
    struct TradesModelTests {
        let api: APIClient
        let cache: SeasonCache

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
            api = APIClient(baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
            cache = SeasonCache(folder: FileManager.default.temporaryDirectory.appending(path: "trades-tests-\(UUID().uuidString)"))
        }

        private static let tradesPath = "/api/v1/leagues/lg-1/team/trades"
        private static func ok(_ fixture: String) -> StubURLProtocol.Reply { .init(status: 200, body: Fixture.data(fixture)) }

        /// A model over the pregame season and the fixture offers, with each write answered as given.
        private func model(season: Data = Fixture.data("season-pregame"), routes: [String: StubURLProtocol.Reply] = [:]) async -> TradesModel {
            let tradesPath = Self.tradesPath
            StubURLProtocol.reply = { request in
                let path = request.url?.path() ?? ""
                let key = request.url?.query()?.contains("dryRun=1") == true ? "\(path)?dryRun" : path
                if request.httpMethod == "GET", path == tradesPath { return .init(status: 200, body: Fixture.data("team-trades")) }
                if let reply = routes[key] { return reply }
                return .init(status: 200, body: season)
            }
            let store = SeasonStore(api: api, leagueId: "lg-1", cache: cache)
            await store.start()
            let model = TradesModel(api: api, store: store)
            await model.start()
            return model
        }

        private static func agreed() throws -> Data {
            var json = try #require(JSONSerialization.jsonObject(with: Fixture.data("season-pregame")) as? [String: Any])
            var consent = try #require(json["consent"] as? [String: Any])
            consent["agreed"] = true
            json["consent"] = consent
            return try JSONSerialization.data(withJSONObject: json)
        }

        private func writes() -> [URLRequest] {
            StubURLProtocol.requests.filter { $0.url?.path() == Self.tradesPath && $0.httpMethod == "POST" }
        }

        private static func sent(_ request: URLRequest?) throws -> NSDictionary {
            let body = try #require(request?.httpBody)
            return try #require(JSONSerialization.jsonObject(with: body) as? NSDictionary)
        }

        @Test func readsTheOffersWithWhatEachAllows() async throws {
            let model = await model()
            let trades = try #require(model.trades)
            #expect(trades.deadline.passed == false)
            let theirs = try #require(trades.offers.first { $0.kind == "theirs" })
            #expect(theirs.actions == ["accept", "decline"])
            #expect(theirs.grade?.headline == "About even for you")
            #expect(theirs.partner.name == "Gridiron Gang")
            let mine = try #require(trades.offers.first { $0.kind == "mine" })
            #expect(mine.actions == ["withdraw"])
            #expect(model.names(theirs.gets) == model.name(theirs.gets[0]))
        }

        @Test func acceptsAnOfferFromConsentToResult() async throws {
            let model = await model(routes: [
                "/api/v1/espn/write-consent": Self.ok("write-consent"),
                "\(Self.tradesPath)?dryRun": Self.ok("trade-accept-dry-run"),
                Self.tradesPath: Self.ok("trade-accept-applied"),
            ])
            let offer = try #require(model.trades?.offers.first { $0.kind == "theirs" })
            await model.respond(offer, .accept)
            guard case let .consent(version, _) = model.phase else { Issue.record("expected consent, got \(model.phase)"); return }
            #expect(writes().isEmpty)

            await model.agree(version: version)
            guard case let .review(dry) = model.phase else { Issue.record("expected review, got \(model.phase)"); return }
            #expect(dry.text.hasPrefix("Accept on ESPN? You get"))
            #expect(try Self.sent(writes().last) == (try #require(JSONSerialization.jsonObject(with: Fixture.data("trade-accept-request")) as? NSDictionary)))

            await model.send()
            #expect(model.action == nil)
            #expect(model.notice == .init(text: "Offer accepted. It's in the league's review.", landed: true))
        }

        @Test func saysWhenESPNDoesntShowTheChange() async throws {
            let model = await model(season: try Self.agreed(), routes: [
                "\(Self.tradesPath)?dryRun": Self.ok("trade-accept-dry-run"),
                Self.tradesPath: Self.ok("trade-accept-unseen"),
            ])
            await model.respond(try #require(model.trades?.offers.first), .accept)
            await model.send()
            #expect(model.notice == .init(text: "ESPN doesn't show that change. Check ESPN. Draft Room has been alerted.", landed: false))
        }

        @Test func withdrawsTheUsersOwnOffer() async throws {
            let model = await model(season: try Self.agreed(), routes: ["\(Self.tradesPath)?dryRun": Self.ok("trade-withdraw-dry-run")])
            let mine = try #require(model.trades?.offers.first { $0.kind == "mine" })
            await model.respond(mine, .withdraw)
            guard case let .review(dry) = model.phase else { Issue.record("expected review, got \(model.phase)"); return }
            #expect(dry.text == "Withdraw your offer to Gridiron Gang on ESPN?")
            let body = try Self.sent(writes().last)
            #expect(body["kind"] as? String == "withdraw")
            #expect(body["tradeId"] as? String == "trade-2")
            #expect(body["snapshot"] == nil) // only an accept checks the roster
        }

        @Test func gradesTheBuilderThenProposesIt() async throws {
            let model = await model(season: try Self.agreed(), routes: [
                "\(Self.tradesPath)?dryRun": Self.ok("trade-propose-dry-run"),
                Self.tradesPath: Self.ok("trade-propose-applied"),
            ])
            let fixture = try #require(JSONSerialization.jsonObject(with: Fixture.data("trade-propose-request")) as? [String: Any])
            let give = try #require((fixture["gives"] as? [Int])?.first)
            let get = try #require((fixture["gets"] as? [Int])?.first)
            await model.choose(partner: try #require(fixture["partner"] as? Int))
            model.side = .send
            await model.toggle(give)
            model.side = .get
            await model.toggle(get)
            let grade = try #require(model.grade)
            #expect(grade.headline == "About even for you")

            await model.propose()
            guard case .review = model.phase else { Issue.record("expected review, got \(model.phase)"); return }
            let body = try Self.sent(writes().last)
            #expect(body["gives"] as? [Int] == [give])
            #expect(body["gets"] as? [Int] == [get])
            #expect(body["drops"] as? [Int] == grade.drops)

            await model.send()
            #expect(model.notice?.text == "Offer sent to Gridiron Gang. It's in Pending on ESPN.")
            #expect(model.gives.isEmpty && model.gets.isEmpty && model.grade == nil) // the builder clears
        }

        @Test func aNewPartnerStartsTheOtherSideOver() async throws {
            let model = await model(routes: ["\(Self.tradesPath)?dryRun": Self.ok("trade-propose-dry-run")])
            let first = try #require(model.others.first)
            model.side = .get
            await model.toggle(try #require(first.roster.first).playerId)
            #expect(model.gets.count == 1)
            let other = try #require(model.others.dropFirst().first)
            await model.choose(partner: other.id)
            #expect(model.gets.isEmpty)
            #expect(model.partner?.id == other.id)
        }
    }
}
