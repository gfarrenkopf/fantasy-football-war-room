import XCTest

/// Game day once the week is decided (APE-402), against the stubbed API's final (`-uiTestFinal`,
/// Support/SeasonSample.swift): a win, so Win Night opens first, then the result it leaves behind.
final class GameDayResultTests: XCTestCase {
    @MainActor
    func testAWinOpensWinNightThenShowsTheResult() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub", "-uiTestFinal"]
        app.launch()

        // Win Night opens on its own the first time; a tap on the stage jumps to the end.
        XCTAssertTrue(app.buttons["win-night-close"].waitForExistence(timeout: 10))
        finishWinNight(app, sharing: true)

        // The result it leaves behind reads as one sentence.
        let moment = app.descendants(matching: .any)["result-moment"]
        XCTAssertTrue(moment.waitForExistence(timeout: 5))
        XCTAssertTrue(moment.label.hasPrefix("Week 3 final: you won, 79.0 to 59.9, beating Gridiron Gang by 19.1."), moment.label)
        XCTAssertTrue(app.buttons["share-card"].exists)
        XCTAssertFalse(app.buttons["win-night-close"].exists)

        // It never opens again by itself; Watch it again replays it.
        app.buttons["watch-again"].tap()
        XCTAssertTrue(app.buttons["win-night-close"].waitForExistence(timeout: 5))
        finishWinNight(app)
        XCTAssertTrue(moment.waitForExistence(timeout: 5))

        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Why you won"].waitForExistence(timeout: 5))
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Head to head"].waitForExistence(timeout: 5))
    }

    /// Skips to the end of the show, however far it has got (a tap on the stage only skips), then leaves it.
    @MainActor
    private func finishWinNight(_ app: XCUIApplication, sharing: Bool = false) {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
        let done = app.buttons["win-night-done"]
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        // The show ends on the win card to share.
        if sharing { XCTAssertTrue(app.buttons["win-night-share"].exists) }
        done.tap()
        XCTAssertTrue(done.waitForNonExistence(timeout: 5))
    }
}
