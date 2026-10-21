import XCTest

final class LaunchTests: XCTestCase {
    @MainActor
    func testSignedOutLaunchShowsSignIn() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["signin"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Continue with Google"].exists)
        // Email is folded behind its own button until it's wanted.
        app.buttons["Continue with email"].tap()
        XCTAssertTrue(app.textFields["signin-email"].waitForExistence(timeout: 2))
    }
}
