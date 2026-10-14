import Foundation
import Testing

@testable import DraftRoom

extension StubbedNetwork {
    /// The Waivers tab (APE-388): the wire from team/waivers, and the add with its drop from consent to
    /// result against the acquire route's fixtures (APE-386).
    @MainActor
    @Suite
    struct WaiversModelTests {
        let api: APIClient
        let cache: SeasonCache

        // The pregame team's weakest player, first among the drops.
        static let broncos = -16007

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
            api = APIClient(baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
            cache = SeasonCache(folder: FileManager.default.temporaryDirectory.appending(path: "waivers-tests-\(UUID().uuidString)"))
        }

        private static let wirePath = "/api/v1/leagues/lg-1/team/waivers"
        private static let acquirePath = "/api/v1/leagues/lg-1/team/acquire"
        private static func ok(_ fixture: String) -> StubURLProtocol.Reply { .init(status: 200, body: Fixture.data(fixture)) }

        /// A model over the pregame season and the fixture wire, with each route answered as given.
        private func model(season: Data = Fixture.data("season-pregame"), wire: Data = Fixture.data("team-waivers"), routes: [String: StubURLProtocol.Reply] = [:]) async -> WaiversModel {
            let wirePath = Self.wirePath
            StubURLProtocol.reply = { request in
                let path = request.url?.path() ?? ""
                let key = request.url?.query()?.contains("dryRun=1") == true ? "\(path)?dryRun" : path
                if let reply = routes[key] { return reply }
                if path == wirePath { return .init(status: 200, body: wire) }
                return .init(status: 200, body: season)
            }
            let store = SeasonStore(api: api, leagueId: "lg-1", cache: cache)
            await store.start()
            let model = WaiversModel(api: api, store: store)
            await model.start()
            return model
        }

        private static func sent(_ request: URLRequest?) throws -> [String: Any] {
            let body = try #require(request?.httpBody)
            return try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
        }

        private func acquireRequests() -> [URLRequest] {
            StubURLProtocol.requests.filter { $0.url?.path() == Self.acquirePath }
        }

        /// A JSON fixture with one change made to its top-level object.
        private static func edit(_ fixture: String, _ change: (inout [String: Any]) throws -> Void) throws -> Data {
            var json = try #require(JSONSerialization.jsonObject(with: Fixture.data(fixture)) as? [String: Any])
            try change(&json)
            return try JSONSerialization.data(withJSONObject: json)
        }

        private static func agreed() throws -> Data {
            try edit("season-pregame") { json in
                var consent = try #require(json["consent"] as? [String: Any])
                consent["agreed"] = true
                json["consent"] = consent
            }
        }

        // MARK: The wire

        @Test func readsTheWire() async throws {
            let model = await model()
            let wire = try #require(model.wire)
            #expect(wire.pickups.count == 7)
            let top = try #require(wire.pickups.first)
            #expect(top.player.name == "Bijan Robinson")
            #expect(top.player.status == "FREEAGENT")
            #expect(top.player.ros == 360)
            #expect(abs(top.perWeek - 7.47) < 0.001)
            #expect(top.drop == 4882093)
            #expect(wire.note == "Waiver priority 4 of 4")
            #expect(wire.ahead.first?.hole.key == "TE")
            #expect(wire.ahead.first?.fills.first?.player.weekly?["4"] == 14)
            #expect(!model.hasRoom)
            #expect(model.dropChoices.first?.playerId == Self.broncos)
            #expect(model.name(4882093) == "Bhayshul Tuten")
        }

        @Test func saysWhenESPNCantBeRead() async throws {
            let model = await model(wire: Data(#"{"error":"ESPN couldn't be read for this league","problem":"no-login"}"#.utf8), routes: [
                Self.wirePath: .init(status: 409, body: Data(#"{"error":"ESPN couldn't be read for this league","problem":"no-login"}"#.utf8)),
            ])
            #expect(model.load == .problem("ESPN couldn't be read for this league", reconnect: true))
        }

        // MARK: Adding

        @Test func asksForConsentThenConfirmsTheSuggestedDrop() async throws {
            let model = await model(routes: [
                "/api/v1/espn/write-consent": Self.ok("write-consent"),
                "\(Self.acquirePath)?dryRun": Self.ok("acquire-add-dry-run"),
            ])
            let bijan = try #require(model.wire?.pickups.first)
            await model.add(bijan)
            #expect(model.acting == bijan)
            #expect(model.drop == 4882093) // the suggested drop
            guard case let .consent(version, _) = model.phase else { Issue.record("expected consent, got \(model.phase)"); return }
            #expect(acquireRequests().isEmpty)

            await model.agree(version: version)
            guard case let .review(dry) = model.phase else { Issue.record("expected review, got \(model.phase)"); return }
            #expect(dry.text == "Add Bijan Robinson and drop Broncos D/ST.")
            let body = try Self.sent(acquireRequests().last)
            #expect(body["kind"] as? String == "add")
            #expect(body["drop"] as? Int == 4882093)
        }

        @Test func aNewDropAsksAgainWithTheRequestTheServerExpects() async throws {
            let model = await model(season: try Self.agreed(), routes: ["\(Self.acquirePath)?dryRun": Self.ok("acquire-add-dry-run")])
            await model.add(try #require(model.wire?.pickups.first))
            await model.choose(drop: Self.broncos)
            #expect(acquireRequests().count == 2)
            let body = try Self.sent(acquireRequests().last)
            let fixture = try #require(JSONSerialization.jsonObject(with: Fixture.data("acquire-add-request")) as? [String: Any])
            #expect(body["kind"] as? String == fixture["kind"] as? String)
            #expect(body["week"] as? Int == fixture["week"] as? Int)
            #expect(body["add"] as? Int == fixture["add"] as? Int)
            #expect(body["drop"] as? Int == fixture["drop"] as? Int)
            #expect((body["snapshot"] as? [Any])?.count == (fixture["snapshot"] as? [Any])?.count)
        }

        @Test func aFullRosterWithNoSuggestionDropsTheWeakest() async throws {
            let model = await model(season: try Self.agreed(), routes: ["\(Self.acquirePath)?dryRun": Self.ok("acquire-add-dry-run")])
            let bijan = try #require(model.wire?.pickups.first)
            await model.add(Pickup(player: bijan.player, delta: bijan.delta, perWeek: bijan.perWeek, drop: nil))
            #expect(model.drop == Self.broncos)
        }

        @Test func withRoomNobodyHasToGo() async throws {
            let wire = try Self.edit("team-waivers") { json in
                json["drops"] = ["needed": false, "candidates": [Self.broncos]]
            }
            let model = await model(season: try Self.agreed(), wire: wire, routes: ["\(Self.acquirePath)?dryRun": Self.ok("acquire-add-dry-run")])
            #expect(model.hasRoom)
            let bijan = try #require(model.wire?.pickups.first)
            await model.add(Pickup(player: bijan.player, delta: bijan.delta, perWeek: bijan.perWeek, drop: nil))
            #expect(model.drop == nil)
            let body = try Self.sent(acquireRequests().last)
            #expect(body["drop"] is NSNull) // the key goes, as null
        }

        @Test func addsAndSaysWhatESPNShows() async throws {
            let model = await model(season: try Self.agreed(), routes: [
                "\(Self.acquirePath)?dryRun": Self.ok("acquire-add-dry-run"),
                Self.acquirePath: Self.ok("acquire-add-applied"),
            ])
            await model.add(try #require(model.wire?.pickups.first))
            await model.send()
            #expect(model.acting == nil)
            #expect(model.phase == .idle)
            #expect(model.notice == .init(text: "Done. Bijan Robinson is on your team, and Broncos D/ST is gone.", landed: true))
            // The roster and the wire are both read again, skipping the server's caches.
            let reads = StubURLProtocol.requests.filter { $0.url?.query() == "refresh=1" }.map { $0.url?.path() ?? "" }
            #expect(reads.contains(Self.wirePath))
            #expect(reads.contains("/api/v1/leagues/lg-1/season"))
        }

        @Test func saysWhenTheAddDidntLand() async throws {
            let model = await model(season: try Self.agreed(), routes: [
                "\(Self.acquirePath)?dryRun": Self.ok("acquire-add-dry-run"),
                Self.acquirePath: Self.ok("acquire-add-missed"),
            ])
            await model.add(try #require(model.wire?.pickups.first))
            await model.send()
            #expect(model.notice?.landed == false)
            #expect(model.notice?.text.hasPrefix("ESPN doesn't show Bijan Robinson") == true)
        }

        @Test func saysWhyESPNRefused() async throws {
            let model = await model(season: try Self.agreed(), routes: [
                "\(Self.acquirePath)?dryRun": Self.ok("acquire-add-dry-run"),
                Self.acquirePath: .init(status: 409, body: Fixture.data("acquire-refused")),
            ])
            await model.add(try #require(model.wire?.pickups.first))
            await model.send()
            #expect(model.phase == .failed("ESPN refused the change. Nothing changed.", details: ["ESPN says the player isn't a free agent any more: ESPN shows him on waivers"]))
            #expect(model.acting != nil) // the sheet stays up with the reason
        }

        @Test func neverQueuesAnAddOffline() async throws {
            let model = await model(season: try Self.agreed(), routes: ["\(Self.acquirePath)?dryRun": Self.ok("acquire-add-dry-run")])
            await model.add(try #require(model.wire?.pickups.first))
            StubURLProtocol.reply = nil // the network drops
            await model.send()
            guard case let .failed(message, _) = model.phase else { Issue.record("expected failed, got \(model.phase)"); return }
            #expect(message.contains("offline"))
            #expect(acquireRequests().count == 2) // the dry run and the one failed send
        }

        @Test func cancelClosesTheSheetWithoutSending() async throws {
            let model = await model(season: try Self.agreed(), routes: ["\(Self.acquirePath)?dryRun": Self.ok("acquire-add-dry-run")])
            await model.add(try #require(model.wire?.pickups.first))
            model.cancel()
            #expect(model.acting == nil)
            #expect(acquireRequests().count == 1)
        }
    }
}
