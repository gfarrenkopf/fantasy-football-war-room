#if DEBUG
import Foundation

/// Debug builds launched with `-uiTestStub` answer the API from canned JSON instead of a server, so
/// UI tests can drive the signed-in app. Never compiled into Release.
enum UITestStub {
    @MainActor static func apiIfRequested() -> APIClient? {
        guard ProcessInfo.processInfo.arguments.contains("-uiTestStub") else { return nil }
        // Every stubbed launch starts the same: on the first league, with nothing kept from a past run.
        UserDefaults.standard.removeObject(forKey: "lastLeagueId")
        for key in UserDefaults.standard.dictionaryRepresentation().keys where key.hasPrefix("moment:") {
            UserDefaults.standard.removeObject(forKey: key)
        }
        SeasonCache.shared.clear()
        RecapCache.shared.clear()
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
            let (status, body) = Self.answer(request.url?.path() ?? "", query: request.url?.query() ?? "", body: Self.body(of: request))
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}

        private static func body(of request: URLRequest) -> Data? {
            if let body = request.httpBody { return body }
            guard let stream = request.httpBodyStream else { return nil }
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
            return data
        }

        /// The sample's two lineup changes (SeasonSample.lineup plus Kraft in at TE), as the server words them.
        private static let changes = [
            (id: "6:FLEX", text: "Start Tank Bigsby at FLEX"),
            (id: "4:BN,8:TE", text: "Start Tucker Kraft at TE, bench Sam LaPorta"),
        ]

        /// The lineup route: a dry run lists both changes, ticked as the request names them; a save lands them.
        private static func lineup(dryRun: Bool, body: Data?) -> (Int, String) {
            struct Sent: Decodable { let changes: [String]? }
            let picked = (body.flatMap { try? JSONDecoder().decode(Sent.self, from: $0) }?.changes).map(Set.init)
            let chosen = changes.filter { picked?.contains($0.id) ?? true }
            if dryRun {
                let rows = changes.map { c in #"{"id":"\#(c.id)","text":"\#(c.text)","picked":\#(chosen.contains { $0.id == c.id }),"moves":[]}"# }
                return (200, #"{"changes":[\#(rows.joined(separator: ","))],"problems":[]}"#)
            }
            let rows = chosen.map { c in #"{"id":"\#(c.id)","text":"\#(c.text)","landed":true,"result":"Done on ESPN.","moves":[]}"# }
            let lockIn = chosen.contains { $0.id == "6:FLEX" }
                ? #"{"banked":7.4,"before":80,"after":\#(chosen.count == 2 ? 88.8 : 87.4),"leftover":0,"level":"gain","headline":"Lineup locked","confetti":false,"moves":[{"playerId":6,"text":"Tank Bigsby in at FLEX","gain":7.4,"own":false}]}"#
                : "null"
            return (200, #"{"changes":[\#(rows.joined(separator: ","))],"lockIn":\#(lockIn)}"#)
        }

        static func answer(_ path: String, query: String = "", body: Data? = nil) -> (Int, String) {
            switch path {
            case "/api/v1/leagues/lg-1/lineup", "/api/v1/leagues/lg-2/lineup":
                lineup(dryRun: query.contains("dryRun=1"), body: body)
            case "/api/v1/espn/write-consent":
                (200, #"{"version":2,"agreed":true}"#)
            case "/api/v1/me":
                (200, #"{"user":{"id":"u1","email":"tester@example.test","name":"Test User"},"flags":{"season":true,"ai":true,"payments":false},"minAppVersion":"1.0"}"#)
            case "/api/v1/leagues":
                (200, #"{"leagues":[{"id":"lg-1","name":"App Tester","espnLeagueId":"704343562","espnTeamId":1,"season":2026},{"id":"lg-2","name":"Sunday Regulars","espnLeagueId":"111","espnTeamId":4,"season":2026}]}"#)
            case "/api/v1/leagues/lg-1/season", "/api/v1/leagues/lg-2/season":
                // `-uiTestFinal` serves the week decided (a win) instead of the live one.
                (200, ProcessInfo.processInfo.arguments.contains("-uiTestFinal") ? SeasonSample.json(SeasonSample.final) : SeasonSample.liveJSON)
            case "/api/v1/leagues/lg-1/recaps":
                (200, RecapSample.json(RecapSample.archive))
            case "/api/v1/leagues/lg-2/recaps":
                (200, RecapSample.json(RecapSample.empty))
            case let recaps where recaps.hasPrefix("/api/v1/leagues/lg-1/recaps/"):
                RecapSample.recap(week: Int(recaps.split(separator: "/").last ?? "") ?? 0).map { (200, RecapSample.json($0)) } ?? (404, #"{"error":"No recap for that week yet"}"#)
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
