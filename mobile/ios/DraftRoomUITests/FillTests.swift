import XCTest

/// Filling a hole (APE-404) against the stubbed API (Support/UITestStub.swift): Jake Elliott is out
/// with no other kicker, so Fill it offers Boswell with Elliott to IR, and the fill lands every step.
final class FillTests: XCTestCase {
    @MainActor
    func testFillAHole() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub", "-uiTestHole"]
        app.launch()

        let tab = app.tabBars.buttons["Lineup"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()

        let fill = app.buttons["fill-hole-K"]
        XCTAssertTrue(fill.waitForExistence(timeout: 5))
        fill.tap()

        // The ranked fills, each saying how the roster makes room.
        let boswell = app.buttons["fill-23"]
        XCTAssertTrue(boswell.waitForExistence(timeout: 5))
        XCTAssertTrue(boswell.label.contains("Jake Elliott goes to IR"), boswell.label)
        XCTAssertTrue(app.buttons["fill-25"].label.contains("Drops Josh Downs"), app.buttons["fill-25"].label)
        boswell.tap()

        // The consent first, then the server's steps.
        let consent = app.switches["consent-toggle"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        consent.switches.firstMatch.tap()
        app.buttons["consent-agree"].tap()
        XCTAssertTrue(app.staticTexts["Fill your K hole with Chris Boswell."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Move Jake Elliott to IR"].exists)

        app.buttons["fill-send"].tap()
        let result = app.descendants(matching: .any)["fill-result"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCTAssertEqual(result.label, "Done. Chris Boswell starts at K.")
        app.buttons["fill-done"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["fill-sheet"].waitForNonExistence(timeout: 5))
    }
}
