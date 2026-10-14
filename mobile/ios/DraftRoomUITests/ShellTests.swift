import XCTest

/// The signed-in frame, against the app's stubbed API (`-uiTestStub`, Debug builds only).
final class ShellTests: XCTestCase {
    @MainActor
    func testTabsAndLeagueSwitcher() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let gameDay = app.tabBars.buttons["Game day"]
        XCTAssertTrue(gameDay.waitForExistence(timeout: 10))
        XCTAssertTrue(app.tabBars.buttons["Lineup"].exists)
        XCTAssertTrue(app.tabBars.buttons["Trades"].exists)
        XCTAssertTrue(app.tabBars.buttons["Waivers"].exists)

        app.tabBars.buttons["Lineup"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["section-lineup"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["seat-0"].waitForExistence(timeout: 5))

        // A league switch opens the tab the new league's week calls for: Game day while games are on.
        app.buttons["league-switcher"].firstMatch.tap()
        app.buttons["Sunday Regulars"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["scoreboard"].waitForExistence(timeout: 5))
        XCTAssertTrue(gameDay.isSelected)
    }
}
