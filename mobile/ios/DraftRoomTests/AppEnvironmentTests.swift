import Foundation
import Testing
@testable import DraftRoom

struct AppEnvironmentTests {
    @Test func debugBuildPointsAtTheLocalServer() {
        #expect(AppEnvironment.current.apiBaseURL == URL(string: "http://localhost:3000"))
    }

    @Test func readsTheBaseURLFromInfoPlist() {
        let url = AppEnvironment.baseURL(from: ["APIBaseURL": "https://draftroom.online"])
        #expect(url.host() == "draftroom.online")
    }
}
