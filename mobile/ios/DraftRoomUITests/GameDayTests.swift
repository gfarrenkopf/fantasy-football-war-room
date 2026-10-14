import XCTest

/// Game day (APE-380) against the stubbed API's live week (Support/SeasonSample.swift).
final class GameDayTests: XCTestCase {
    @MainActor
    func testShowsTheLiveMatchupAndSendsHolesToLineup() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let scoreboard = app.descendants(matching: .any)["scoreboard"]
        XCTAssertTrue(scoreboard.waitForExistence(timeout: 10))
        XCTAssertTrue(scoreboard.label.contains("Up 4.3"), scoreboard.label)
        XCTAssertTrue(scoreboard.label.contains("61% chance to win"), scoreboard.label)
        // Each slot reads as one sentence, both sides of it.
        let qb = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'QB. Yours: Jalen Hurts'")).firstMatch
        XCTAssertTrue(qb.exists)
        XCTAssertTrue(qb.label.contains("Theirs: Joe Burrow"), qb.label)

        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Your bench"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Around the league"].exists)

        app.swipeDown()
        app.swipeDown()
        let hole = app.buttons["hole-banner"]
        XCTAssertTrue(hole.waitForExistence(timeout: 5))
        hole.tap()
        XCTAssertTrue(app.descendants(matching: .any)["section-lineup"].waitForExistence(timeout: 5))
    }
}
