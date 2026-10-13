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
        XCTAssertTrue(app.tabBars.buttons["Recaps"].exists)
        XCTAssertTrue(app.staticTexts["App Tester · 2026"].exists)

        app.tabBars.buttons["Lineup"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["section-lineup"].waitForExistence(timeout: 5))

        app.buttons["league-switcher"].firstMatch.tap()
        app.buttons["Sunday Regulars"].tap()
        XCTAssertTrue(app.staticTexts["Sunday Regulars · 2026"].waitForExistence(timeout: 5))
    }
}
