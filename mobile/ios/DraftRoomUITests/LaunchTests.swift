import XCTest

final class LaunchTests: XCTestCase {
    @MainActor
    func testSignedOutLaunchShowsSignIn() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["signin"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Continue with Google"].exists)
        XCTAssertTrue(app.textFields["signin-email"].exists)
    }
}
