import Foundation
import Testing

@testable import DraftRoom

extension StubbedNetwork {
    @MainActor
    @Suite
    struct EspnConnectModelTests {
        let api = APIClient(baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
        let login = EspnLogin(espnS2: "AEB%2Fnot-real", swid: "{154E132F-8C13-4AC0-9DAC-20C2C5625594}")

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = { request in
                switch request.url?.path() {
                case "/api/v1/espn/disclosure":
                    .init(status: 200, body: Data(#"{"version":3,"points":["Unofficial.","Stored encrypted."]}"#.utf8))
                case "/api/v1/espn/leagues":
                    .init(status: 200, body: Data(#"{"leagues":[{"espnLeagueId":"704343562","name":"App Tester","season":2026,"espnTeamId":1,"teamName":"The Goats"},{"espnLeagueId":"111","name":"Old","season":2025,"espnTeamId":1,"teamName":null}]}"#.utf8))
                case "/api/v1/espn/connect":
                    .init(status: 200, body: Data(#"{"leagueId":"lg-1","created":true}"#.utf8))
                default:
                    .init(status: 404, body: Data(#"{"error":"Not found"}"#.utf8))
                }
            }
        }

        @Test func walksFromConsentToConnected() async throws {
            let model = EspnConnectModel(api: api)
            await model.start()
            #expect(model.step == .consent(EspnDisclosure(version: 3, points: ["Unofficial.", "Stored encrypted."])))
            model.agree()
            guard case .signingIn = model.step else { Issue.record("expected sign-in"); return }

            await model.signedIn(login)
            guard case let .pick(leagues) = model.step else { Issue.record("expected a pick"); return }
            #expect(leagues.map(\.espnLeagueId) == ["704343562"])

            await model.choose(leagues[0])
            #expect(model.step == .connected(EspnConnected(leagueId: "lg-1", created: true), name: "App Tester"))

            let connect = try #require(StubURLProtocol.requests.last)
            let body = try JSONSerialization.jsonObject(with: connect.httpBody ?? Data()) as? [String: Any]
            #expect(body?["espnS2"] as? String == login.espnS2)
            #expect(body?["swid"] as? String == login.swid)
            #expect(body?["espnLeagueId"] as? String == "704343562")
            #expect(body?["season"] as? Int == 2026)
            #expect(body?["consentVersion"] as? Int == 3)
        }

        @Test func showsConnectErrorsAsWritten() async {
            let model = EspnConnectModel(api: api)
            await model.start()
            model.agree()
            await model.signedIn(login)
            StubURLProtocol.reply = { _ in .init(status: 403, body: Data(#"{"error":"You don't have a team in this ESPN league."}"#.utf8)) }
            guard case let .pick(leagues) = model.step else { Issue.record("expected a pick"); return }
            await model.choose(leagues[0])
            #expect(model.errorMessage == "You don't have a team in this ESPN league.")
            guard case .pick = model.step else { Issue.record("expected to stay on the pick"); return }
        }

        @Test func fallsBackToTypingTheLeague() async {
            let model = EspnConnectModel(api: api)
            await model.start()
            model.agree()
            let answer = StubURLProtocol.reply
            StubURLProtocol.reply = { _ in .init(status: 503, body: Data(#"{"error":"Couldn't reach ESPN."}"#.utf8)) }
            await model.signedIn(login)
            #expect(model.step == .enterLeague(listFailed: true))

            // ESPN answers the retry with the same login.
            StubURLProtocol.reply = answer
            await model.loadLeagues()
            guard case .pick = model.step else { Issue.record("expected a pick"); return }
        }
    }
}

struct EspnLeagueEntryTests {
    @Test func readsLeagueIdsAndLinks() {
        #expect(EspnConnectModel.leagueId(from: " 704343562 ") == "704343562")
        #expect(EspnConnectModel.leagueId(from: "https://fantasy.espn.com/football/league?leagueId=704343562&seasonId=2026") == "704343562")
        #expect(EspnConnectModel.season(from: "https://fantasy.espn.com/football/league?leagueId=704343562&seasonId=2026") == 2026)
        #expect(EspnConnectModel.leagueId(from: "https://example.com/?leagueId=1") == nil)
        #expect(EspnConnectModel.leagueId(from: "my league") == nil)
    }

    @Test func needsBothCookiesOnEspn() throws {
        func cookie(_ name: String, _ value: String, _ domain: String = ".espn.com") -> HTTPCookie {
            HTTPCookie(properties: [.name: name, .value: value, .domain: domain, .path: "/"])!
        }
        let swid = "{154E132F-8C13-4AC0-9DAC-20C2C5625594}"
        // ESPN gives signed-out visitors a SWID too; only espn_s2 means signed in.
        #expect(EspnCookies.login(from: [cookie("SWID", swid)]) == nil)
        #expect(EspnCookies.login(from: [cookie("SWID", swid), cookie("espn_s2", "abc", ".example.com")]) == nil)
        #expect(EspnCookies.login(from: [cookie("SWID", swid), cookie("espn_s2", "AEB%2F")]) == EspnLogin(espnS2: "AEB%2F", swid: swid))
    }
}
