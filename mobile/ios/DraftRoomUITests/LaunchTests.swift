import XCTest

final class LaunchTests: XCTestCase {
    @MainActor
    func testLaunchShowsTheFirstScreen() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["home"].waitForExistence(timeout: 10))
    }
}
