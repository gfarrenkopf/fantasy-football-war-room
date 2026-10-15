import Foundation
import Testing

@testable import DraftRoom

extension StubbedNetwork {
    @MainActor
    @Suite
    struct NotificationsModelTests {
        let api: APIClient

        nonisolated static func settings(lineup: String = "email", push: Bool = true) -> Data {
            Data(#"""
            {"alerts":[
              {"kind":"lineup","title":"Sunday AI lineup","detail":"When your Sunday lineup is ready.","channel":"\#(lineup)"},
              {"kind":"draft","title":"Draft day","detail":"Before your draft starts.","channel":"off"}
            ],"email":true,"push":\#(push),"hasDevice":true}
            """#.utf8)
        }

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = nil
            api = APIClient(baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
        }

        @Test func loadsTheAlertsAndOffersOnlyWhatWorks() async throws {
            StubURLProtocol.reply = { _ in .init(status: 200, body: Self.settings(push: false)) }
            let model = NotificationsModel(api: api)
            await model.start()
            #expect(model.load == .ready)
            let settings = try #require(model.settings)
            #expect(settings.alerts.map(\.channel) == [.email, .off])
            #expect(settings.choices(for: settings.alerts[0]) == [.email, .off])
            #expect(!model.wantsPush)
        }

        @Test func savesAChoiceWithPut() async throws {
            StubURLProtocol.reply = { request in
                .init(status: 200, body: Self.settings(lineup: request.httpMethod == "PUT" ? "push" : "email"))
            }
            let model = NotificationsModel(api: api)
            await model.start()
            await model.choose(.push, for: "lineup")
            #expect(model.settings?.alerts.first?.channel == .push)
            #expect(model.wantsPush)

            let put = try #require(StubURLProtocol.requests.last)
            #expect(put.httpMethod == "PUT")
            #expect(put.url?.path() == "/api/v1/notifications")
            #expect(try JSONDecoder().decode([String: [String: String]].self, from: put.httpBody ?? Data()) == ["alerts": ["lineup": "push"]])
        }

        @Test func goesBackWhenTheSaveFails() async {
            StubURLProtocol.reply = { request in
                request.httpMethod == "PUT" ? .init(status: 500, body: Data(#"{"error":"Nope"}"#.utf8)) : .init(status: 200, body: Self.settings())
            }
            let model = NotificationsModel(api: api)
            await model.start()
            await model.choose(.both, for: "lineup")
            #expect(model.settings?.alerts.first?.channel == .email)
            #expect(model.errorMessage == "Nope")
        }
    }
}
