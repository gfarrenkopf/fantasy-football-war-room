import Foundation
import Testing

@testable import DraftRoom

extension StubbedNetwork {
    /// Filling a hole (APE-404): the ranked fills from team/fills, then consent, the server's steps
    /// and each step's result from team/fill, against the fill route's fixtures.
    @MainActor
    @Suite
    struct FillModelTests {
        let api: APIClient
        let cache: SeasonCache

        /// Josh Allen, out with no other QB on the team.
        static let allen = 3918298
        static let maye = 4431452

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
            api = APIClient(baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
            cache = SeasonCache(folder: FileManager.default.temporaryDirectory.appending(path: "fill-tests-\(UUID().uuidString)"))
        }

        private static let fillsPath = "/api/v1/leagues/lg-1/team/fills"
        private static let fillPath = "/api/v1/leagues/lg-1/team/fill"
        private static func ok(_ fixture: String) -> StubURLProtocol.Reply { .init(status: 200, body: Fixture.data(fixture)) }

        /// A model over the holes season, its fills, and each route answered as given.
        private func model(season: Data = Fixture.data("season-holes"), routes: [String: StubURLProtocol.Reply] = [:]) async -> FillModel {
            let fillsPath = Self.fillsPath
            StubURLProtocol.reply = { request in
                let path = request.url?.path() ?? ""
                let key = request.url?.query()?.contains("dryRun=1") == true ? "\(path)?dryRun" : path
                if let reply = routes[key] { return reply }
                if path == fillsPath { return .init(status: 200, body: Fixture.data("team-fills")) }
                return .init(status: 200, body: season)
            }
            let store = SeasonStore(api: api, leagueId: "lg-1", cache: cache)
            await store.start()
            return FillModel(api: api, store: store)
        }

        /// The holes season before the user has agreed to ESPN writes (the fixture has).
        private static func notAgreed() throws -> Data {
            var json = try #require(JSONSerialization.jsonObject(with: Fixture.data("season-holes")) as? [String: Any])
            var consent = try #require(json["consent"] as? [String: Any])
            consent["agreed"] = false
            json["consent"] = consent
            return try JSONSerialization.data(withJSONObject: json)
        }

        private func fillRequests() -> [URLRequest] {
            StubURLProtocol.requests.filter { $0.url?.path() == Self.fillPath }
        }

        private func hole(_ model: FillModel) throws -> Hole {
            try #require(model.store.season?.lineup.holes.first { $0.kind == "hard" })
        }

        @Test func readsTheHolesFillsWithHowEachMakesRoom() async throws {
            let model = await model()
            await model.open(try hole(model))
            let options = try #require(model.options)
            #expect(options.hole.key == "QB")
            let best = try #require(options.fills.first)
            #expect(best.player.name == "Drake Maye")
            #expect(best.ir == Self.allen)
            #expect(model.room(best) == "Josh Allen goes to IR")
            #expect(model.phase == .picking)
        }

        @Test func asksForConsentThenConfirmsTheServersSteps() async throws {
            let model = await model(season: try Self.notAgreed(), routes: [
                "/api/v1/espn/write-consent": Self.ok("write-consent"),
                "\(Self.fillPath)?dryRun": Self.ok("fill-dry-run"),
            ])
            await model.open(try hole(model))
            await model.choose(try #require(model.options?.fills.first))
            guard case let .consent(version, _) = model.phase else { Issue.record("expected consent, got \(model.phase)"); return }
            #expect(fillRequests().isEmpty) // nothing asked before the consent

            await model.agree(version: version)
            guard case let .review(dry) = model.phase else { Issue.record("expected review, got \(model.phase)"); return }
            #expect(dry.steps == ["Move Josh Allen to IR", "Add Drake Maye", "Start Drake Maye at QB"])
            let body = try #require(fillRequests().last?.httpBody)
            let sent = try #require(JSONSerialization.jsonObject(with: body) as? NSDictionary)
            let fixture = try #require(JSONSerialization.jsonObject(with: Fixture.data("fill-request")) as? NSDictionary)
            #expect(sent == fixture)
        }

        @Test func fillsAndShowsEachStepLanded() async throws {
            let model = await model(routes: [
                "\(Self.fillPath)?dryRun": Self.ok("fill-dry-run"),
                Self.fillPath: Self.ok("fill-applied"),
            ])
            await model.open(try hole(model))
            await model.choose(try #require(model.options?.fills.first))
            await model.send()
            guard case let .done(applied) = model.phase else { Issue.record("expected done, got \(model.phase)"); return }
            #expect(applied.landed)
            #expect(applied.result == "Done. Drake Maye starts at QB.")
            #expect(applied.steps.allSatisfy { $0.landed == true })
            model.dismiss()
            #expect(model.hole == nil)
        }

        @Test func saysWhereAFillStopped() async throws {
            let model = await model(routes: [
                "\(Self.fillPath)?dryRun": Self.ok("fill-dry-run"),
                Self.fillPath: Self.ok("fill-stopped"),
            ])
            await model.open(try hole(model))
            await model.choose(try #require(model.options?.fills.first))
            await model.send()
            guard case let .done(applied) = model.phase else { Issue.record("expected done, got \(model.phase)"); return }
            #expect(!applied.landed)
            #expect(applied.result == "ESPN didn't add Drake Maye. Josh Allen is on IR now.")
            #expect(applied.steps.map(\.landed) == [true, false, nil])
            #expect(applied.details == ["ESPN says the player isn't a free agent any more: ESPN shows him on waivers"])
        }

        @Test func aFillNoLongerOnOfferSaysSo() async throws {
            let changed = Data(#"{"error":"Your team changed on ESPN since this page loaded. Nothing was sent.","changed":["The ways to fill this hole have changed. Look again and pick one."]}"#.utf8)
            let model = await model(routes: ["\(Self.fillPath)?dryRun": .init(status: 409, body: changed)])
            await model.open(try hole(model))
            await model.choose(try #require(model.options?.fills.first))
            #expect(model.phase == .failed("Your team changed on ESPN since this page loaded. Nothing was sent.", details: ["The ways to fill this hole have changed. Look again and pick one."]))
            model.back()
            #expect(model.phase == .picking)
            #expect(model.chosen == nil)
        }

        @Test func neverQueuesAFillOffline() async throws {
            let model = await model(routes: ["\(Self.fillPath)?dryRun": Self.ok("fill-dry-run")])
            await model.open(try hole(model))
            await model.choose(try #require(model.options?.fills.first))
            StubURLProtocol.reply = nil // the network drops
            await model.send()
            guard case let .failed(message, _) = model.phase else { Issue.record("expected failed, got \(model.phase)"); return }
            #expect(message.hasPrefix("You're offline"))
            #expect(fillRequests().count == 2) // the dry run and the one failed send
        }
    }
}
