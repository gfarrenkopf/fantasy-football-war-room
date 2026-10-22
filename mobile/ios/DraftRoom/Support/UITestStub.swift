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

        /// The season alerts (21.3), with a PUT's change applied. Not kept between requests.
        private static func notifications(body: Data?) -> String {
            struct Sent: Decodable { let alerts: [String: String] }
            let changed = body.flatMap { try? JSONDecoder().decode(Sent.self, from: $0) }?.alerts ?? [:]
            let rows = [
                ("lineup", "Sunday AI lineup", "When your Sunday lineup is ready."),
                ("kickoff", "Before kickoff", "Changes for an early game, and starters ruled out after the Sunday lineup."),
                ("reminder", "Lineup reminder", "Before the week's first kickoff, when your lineup has a hole."),
                ("reconnect", "ESPN reconnect", "When ESPN signs Draft Room out."),
                ("draft", "Draft day", "Before your draft starts."),
            ].map { kind, title, detail in
                #"{"kind":"\#(kind)","title":"\#(title)","detail":"\#(detail)","channel":"\#(changed[kind] ?? (kind == "reminder" ? "push" : "both"))","pushOnly":\#(kind == "reminder")}"#
            }
            return #"{"alerts":[\#(rows.joined(separator: ","))],"email":true,"push":true,"hasDevice":true}"#
        }

        /// Josh Downs going on IR (APE-387), when the request puts him there.
        private static let toIr = (id: "7:IR", text: "Move Josh Downs to IR")

        /// The lineup route: a dry run lists the changes, ticked as the request names them; a save lands them.
        private static func lineup(dryRun: Bool, body: Data?) -> (Int, String) {
            struct Sent: Decodable { let changes: [String]?; let ir: [Int]? }
            let sent = body.flatMap { try? JSONDecoder().decode(Sent.self, from: $0) }
            let picked = sent?.changes.map(Set.init)
            let changes = sent?.ir?.contains(7) == true ? changes + [toIr] : changes
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

        /// The acquire route: a dry run words the add, claim or cancel; a send lands it.
        private static func acquire(dryRun: Bool, body: Data?) -> (Int, String) {
            struct Sent: Decodable { let kind: String; let add: Int?; let drop: Int?; let claimId: String? }
            guard let sent = body.flatMap({ try? JSONDecoder().decode(Sent.self, from: $0) }) else { return (400, #"{"error":"Invalid request"}"#) }
            let all = SeasonSample.mine + SeasonSample.pool.map(\.player) + SeasonSample.wire.ahead.flatMap { $0.fills.map(\.player) }
            let name = { (id: Int) in all.first { $0.playerId == id }?.name ?? "Player \(id)" }
            switch (sent.kind, dryRun) {
            case ("cancel", true):
                return (200, #"{"text":"Cancel your claim for Keon Coleman.","problems":[]}"#)
            case ("cancel", false):
                return (200, #"{"cancelled":true,"landed":true,"result":"Claim for Keon Coleman cancelled."}"#)
            case ("claim", true):
                return (200, #"{"text":"Claim \#(name(sent.add ?? 0)) off waivers\#(sent.drop.map { ", dropping \(name($0)) if the claim goes through" } ?? "").","problems":[]}"#)
            case ("claim", false):
                return (200, #"{"pending":true,"landed":true,"result":"Claim placed for \#(name(sent.add ?? 0))."}"#)
            case (_, true):
                return (200, #"{"text":"Add \#(name(sent.add ?? 0))\#(sent.drop.map { " and drop \(name($0))" } ?? "").","problems":[]}"#)
            default:
                return (200, #"{"added":true,"dropped":true,"landed":true,"result":"Done. \#(name(sent.add ?? 0)) is on your team\#(sent.drop.map { ", and \(name($0)) is gone" } ?? "")."}"#)
            }
        }

        /// The fill route: a dry run lists the steps for Boswell (Elliott to IR) or Moody (Downs dropped); a send lands them.
        private static func fill(dryRun: Bool, body: Data?) -> (Int, String) {
            struct Sent: Decodable { let add: Int }
            guard let sent = body.flatMap({ try? JSONDecoder().decode(Sent.self, from: $0) }) else { return (400, #"{"error":"Invalid request"}"#) }
            let boswell = sent.add == 23
            let name = boswell ? "Chris Boswell" : "Jake Moody"
            let steps = boswell ? ["Move Jake Elliott to IR", "Add Chris Boswell", "Start Chris Boswell at K"] : ["Add Jake Moody and drop Josh Downs", "Start Jake Moody at K over Jake Elliott"]
            let quoted = steps.map { "\"\($0)\"" }.joined(separator: ",")
            if dryRun { return (200, #"{"text":"Fill your K hole with \#(name).","steps":[\#(quoted)],"problems":[]}"#) }
            let landed = steps.map { #"{"text":"\#($0)","landed":true}"# }.joined(separator: ",")
            return (200, #"{"landed":true,"result":"Done. \#(name) starts at K.","steps":[\#(landed)],"details":[]}"#)
        }

        /// The trades route: GET lists the offers; a dry run words the write (and grades a proposal); a send lands it.
        private static func trades(get: Bool, dryRun: Bool, body: Data?) -> (Int, String) {
            if get { return (200, SeasonSample.tradesJSON) }
            struct Sent: Decodable { let kind: String }
            guard let sent = body.flatMap({ try? JSONDecoder().decode(Sent.self, from: $0) }) else { return (400, #"{"error":"Invalid trade"}"#) }
            let words: (dry: String, done: String) = switch sent.kind {
            case "accept": ("Accept on ESPN? You get Bijan Robinson and send Tank Bigsby. It goes through after the league's review.", "Offer accepted. It's in the league's review.")
            case "decline": ("Decline Gridiron Gang's offer on ESPN?", "Offer declined.")
            case "withdraw": ("Withdraw your offer to Gridiron Gang on ESPN?", "Offer withdrawn.")
            default: ("Offer Gridiron Gang this trade on ESPN?", "Offer sent to Gridiron Gang. It's in Pending on ESPN.")
            }
            if dryRun {
                let grade = sent.kind == "propose" ? #","grade":{"headline":"Better for you","level":"gain","perWeek":1.2,"theirs":0.4,"delta":16.8,"weeks":14,"slots":[],"dropLines":[],"drops":[]}"# : ""
                return (200, #"{"text":"\#(words.dry)","problems":[]\#(grade)}"#)
            }
            return (200, #"{"done":true,"landed":true,"result":"\#(words.done)"}"#)
        }

        /// Whether the stub's AI lineup has been written, and its trade ideas found, this launch.
        nonisolated(unsafe) private static var aiWritten = false
        nonisolated(unsafe) private static var aiFound = false

        /// The AI routes (APE-390): the state, and a lineup write or a search for ideas that lands.
        private static func ai(write: Bool = false, find: Bool = false) -> (Int, String) {
            let locked = ProcessInfo.processInfo.arguments.contains("-uiTestAiLocked")
            if write || find {
                if locked { return (402, #"{"error":"\#(AiSample.lockedNote)","locked":true}"#) }
                if write { aiWritten = true }
                if find { aiFound = true }
            }
            return (200, AiSample.json(written: aiWritten, found: aiFound, locked: locked))
        }

        static func answer(_ path: String, query: String = "", body: Data? = nil) -> (Int, String) {
            switch path {
            case "/api/v1/leagues/lg-1/ai", "/api/v1/leagues/lg-2/ai":
                ai(write: false)
            case "/api/v1/leagues/lg-1/ai/lineup", "/api/v1/leagues/lg-2/ai/lineup":
                ai(write: true)
            case "/api/v1/leagues/lg-1/ai/trade-ideas", "/api/v1/leagues/lg-2/ai/trade-ideas":
                ai(find: true)
            case "/api/v1/leagues/lg-1/ai/trade", "/api/v1/leagues/lg-2/ai/trade":
                (200, AiSample.writeup)
            case "/api/v1/leagues/lg-1/team/trades", "/api/v1/leagues/lg-2/team/trades":
                trades(get: body == nil, dryRun: query.contains("dryRun=1"), body: body)
            case "/api/v1/leagues/lg-1/team/fills", "/api/v1/leagues/lg-2/team/fills":
                (200, SeasonSample.fillsJSON)
            case "/api/v1/leagues/lg-1/team/fill", "/api/v1/leagues/lg-2/team/fill":
                fill(dryRun: query.contains("dryRun=1"), body: body)
            case "/api/v1/leagues/lg-1/team/waivers", "/api/v1/leagues/lg-2/team/waivers":
                (200, SeasonSample.wireJSON)
            case "/api/v1/leagues/lg-1/team/players", "/api/v1/leagues/lg-2/team/players":
                (200, SeasonSample.playersJSON(query: query))
            case "/api/v1/leagues/lg-1/team/acquire", "/api/v1/leagues/lg-2/team/acquire":
                acquire(dryRun: query.contains("dryRun=1"), body: body)
            case "/api/v1/leagues/lg-1/lineup", "/api/v1/leagues/lg-2/lineup":
                lineup(dryRun: query.contains("dryRun=1"), body: body)
            case "/api/v1/espn/write-consent":
                (200, #"{"version":2,"agreed":true}"#)
            case "/api/v1/me":
                // `-uiTestReview` signs in as App Review's account, with its Settings rows (APE-398).
                (200, ProcessInfo.processInfo.arguments.contains("-uiTestReview")
                    ? #"{"user":{"id":"u1","email":"review@example.test","name":null},"flags":{"season":true,"ai":true,"payments":false},"minAppVersion":"1.0","review":true}"#
                    : #"{"user":{"id":"u1","email":"tester@example.test","name":"Test User"},"flags":{"season":true,"ai":true,"payments":false},"minAppVersion":"1.0"}"#)
            case "/api/v1/review/sample":
                (200, #"{"sent":1}"#)
            case "/api/v1/leagues":
                (200, #"{"leagues":[{"id":"lg-1","name":"App Tester","espnLeagueId":"704343562","espnTeamId":1,"season":2026},{"id":"lg-2","name":"Sunday Regulars","espnLeagueId":"111","espnTeamId":4,"season":2026}]}"#)
            case "/api/v1/leagues/lg-1/season", "/api/v1/leagues/lg-2/season":
                // `-uiTestFinal` serves the week decided (a win) instead of the live one.
                // `-uiTestHole` serves the kicker out with no backup (APE-404).
                (200, ProcessInfo.processInfo.arguments.contains("-uiTestFinal") ? SeasonSample.json(SeasonSample.final)
                    : ProcessInfo.processInfo.arguments.contains("-uiTestHole") ? SeasonSample.holedJSON : SeasonSample.liveJSON)
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
            case let path where path.contains("/live-activity"):
                (204, "")
            case "/api/v1/devices":
                (204, "")
            case "/api/v1/notifications":
                (200, notifications(body: body))
            default:
                (404, #"{"error":"Not found"}"#)
            }
        }
    }
}
#endif
