import Foundation
@testable import DraftRoom

/// Answers URLSession requests from the test instead of the network.
final class StubURLProtocol: URLProtocol {
    struct Reply: Sendable {
        var status: Int
        var body: Data
    }

    /// Set by each test (the suites using it run serialized). Records every request it answers.
    nonisolated(unsafe) static var reply: (@Sendable (URLRequest) -> Reply)?
    nonisolated(unsafe) static var requests: [URLRequest] = []

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with _: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var request = request
        // URLSession moves the body into a stream; keep it readable for assertions.
        if request.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
            stream.close()
            request.httpBody = data
        }
        Self.requests.append(request)
        guard let reply = Self.reply?(request) else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// Recorded responses from the server's /api/v1 routes (DraftRoomTests/Fixtures).
enum Fixture {
    private final class Marker {}

    static func data(_ name: String) -> Data {
        let url = Bundle(for: Marker.self).url(forResource: name, withExtension: "json")!
        return try! Data(contentsOf: url)
    }
}

/// A token store in memory, so tests never touch the real Keychain item.
final class MemoryTokenStore: TokenStore, @unchecked Sendable {
    private var value: String?
    init(_ value: String? = nil) { self.value = value }
    func token() -> String? { value }
    func setToken(_ token: String?) { value = token }
}
