#if DEBUG
import Foundation

/// Debug builds launched with `-uiTestStub` answer the API from canned JSON instead of a server, so
/// UI tests can drive the signed-in app. Never compiled into Release.
enum UITestStub {
    @MainActor static func apiIfRequested() -> APIClient? {
        guard ProcessInfo.processInfo.arguments.contains("-uiTestStub") else { return nil }
        // Every stubbed launch starts the same: on the first league, with nothing kept from a past run.
        UserDefaults.standard.removeObject(forKey: "lastLeagueId")
        SeasonCache.shared.clear()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return APIClient(baseURL: URL(string: "https://stub.invalid")!, session: URLSession(configuration: configuration), tokens: StubTokens())
    }

    private final class StubTokens: TokenStore, @unchecked Sendable {
        private var value: String? = "stub"
        func token() -> String? { value }
        func setToken(_ token: String?) { value = token }
    }

    private final class StubProtocol: URLProtocol {
        override class func canInit(with _: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            let (status, body) = Self.answer(request.url?.path() ?? "")
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}

        static func answer(_ path: String) -> (Int, String) {
            switch path {
            case "/api/v1/me":
                (200, #"{"user":{"id":"u1","email":"tester@example.test","name":"Test User"},"flags":{"season":true,"ai":true,"payments":false},"minAppVersion":"1.0"}"#)
            case "/api/v1/leagues":
                (200, #"{"leagues":[{"id":"lg-1","name":"App Tester","espnLeagueId":"704343562","espnTeamId":1,"season":2026},{"id":"lg-2","name":"Sunday Regulars","espnLeagueId":"111","espnTeamId":4,"season":2026}]}"#)
            case "/api/v1/leagues/lg-1/season", "/api/v1/leagues/lg-2/season":
                (200, SeasonSample.liveJSON)
            case "/api/v1/espn/login":
                (200, #"{"login":{"status":"connected","season":2026}}"#)
            case "/api/v1/auth/signout":
                (204, "")
            default:
                (404, #"{"error":"Not found"}"#)
            }
        }
    }
}
#endif
