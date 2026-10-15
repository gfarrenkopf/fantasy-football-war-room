import Foundation
import Testing
import UserNotifications

@testable import DraftRoom

/// Stands in for iOS: a fixed permission answer, and a count of APNs registrations.
@MainActor
final class FakePush: PushSystem {
    var status: UNAuthorizationStatus
    var allow: Bool
    private(set) var prompts = 0
    private(set) var registrations = 0

    init(status: UNAuthorizationStatus, allow: Bool = true) {
        self.status = status
        self.allow = allow
    }

    func authorizationStatus() async -> UNAuthorizationStatus { status }
    func requestAuthorization() async -> Bool {
        prompts += 1
        status = allow ? .authorized : .denied
        return allow
    }
    func registerForRemoteNotifications() { registrations += 1 }
}

extension StubbedNetwork {
    @MainActor
    @Suite
    struct PushRegistrarTests {
        let api: APIClient

        init() {
            StubURLProtocol.requests = []
            StubURLProtocol.reply = { _ in .init(status: 204, body: Data()) }
            api = APIClient(baseURL: URL(string: "http://localhost:3000")!, session: StubURLProtocol.session(), tokens: MemoryTokenStore("tok"))
        }

        @Test func sendsTheTokenAsHexWithItsEnvironmentAndVersion() async throws {
            let push = PushRegistrar(api: api, system: FakePush(status: .authorized), appVersion: "1.2")
            await push.didRegister(deviceToken: Data([0x0a, 0xff, 0x10]))

            let request = try #require(StubURLProtocol.requests.first)
            #expect(request.httpMethod == "POST")
            #expect(request.url?.path() == "/api/v1/devices")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
            #expect(
                try JSONDecoder().decode([String: String].self, from: request.httpBody ?? Data()) == [
                    "token": "0aff10", "environment": "sandbox", "appVersion": "1.2",
                ])
        }

        @Test func sendsARepeatedTokenOncePerLaunch() async {
            let push = PushRegistrar(api: api, system: FakePush(status: .authorized))
            await push.didRegister(deviceToken: Data([1, 2]))
            await push.didRegister(deviceToken: Data([1, 2]))
            #expect(StubURLProtocol.requests.count == 1)
            await push.refresh()
            await push.didRegister(deviceToken: Data([1, 2]))
            #expect(StubURLProtocol.requests.count == 2)
        }

        @Test func asksOnlyTheFirstTimeAndRegistersWhenAllowed() async {
            let system = FakePush(status: .notDetermined)
            let push = PushRegistrar(api: api, system: system)
            await push.askOnce()
            await push.askOnce()
            #expect(system.prompts == 1)
            #expect(system.registrations == 1)
        }

        @Test func registersOnLaunchOnlyWhenAllowed() async {
            let denied = FakePush(status: .denied)
            await PushRegistrar(api: api, system: denied).refresh()
            #expect(denied.registrations == 0)

            let undecided = FakePush(status: .notDetermined)
            await PushRegistrar(api: api, system: undecided).refresh()
            #expect(undecided.registrations == 0)
            #expect(undecided.prompts == 0)

            let allowed = FakePush(status: .authorized)
            await PushRegistrar(api: api, system: allowed).refresh()
            #expect(allowed.registrations == 1)
        }
    }
}
