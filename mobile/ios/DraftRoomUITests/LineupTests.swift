import XCTest

/// The Lineup tab (APE-382) against the stubbed API (Support/UITestStub.swift): War Room fills the
/// empty FLEX, the user starts Kraft at TE, leaves the FLEX change out, and saves.
final class LineupTests: XCTestCase {
    @MainActor
    func testSwapUntickAndSave() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let tab = app.tabBars.buttons["Lineup"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()

        // A starter whose game is on is locked.
        let qb = app.buttons["seat-0"]
        XCTAssertTrue(qb.waitForExistence(timeout: 5))
        XCTAssertTrue(qb.label.contains("locked"), qb.label)

        // Start Kraft at TE.
        let te = app.buttons["seat-3"]
        XCTAssertTrue(te.label.hasPrefix("TE, Sam LaPorta, projected 10.2"), te.label)
        te.tap()
        let kraft = app.buttons["pick-8"]
        XCTAssertTrue(kraft.waitForExistence(timeout: 5))
        kraft.tap()
        XCTAssertTrue(te.waitForExistence(timeout: 5))
        XCTAssertTrue(te.label.contains("swapping in Tucker Kraft"), te.label)

        // Review: the consent first, then the server's list of changes.
        let review = app.buttons["review-lineup"]
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        XCTAssertEqual(review.label, "Review 2 swaps")
        review.tap()
        let consent = app.switches["consent-toggle"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        consent.switches.firstMatch.tap()
        app.buttons["consent-agree"].tap()

        let flex = app.switches["change-6:FLEX"]
        XCTAssertTrue(flex.waitForExistence(timeout: 5))
        XCTAssertTrue(app.switches["change-4:BN,8:TE"].exists)
        flex.switches.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Apply this change to your team on ESPN for week 3?"].waitForExistence(timeout: 5))

        app.buttons["apply-lineup"].tap()
        // Only the user's own move went, so no Lock In moment: the plain "Done".
        XCTAssertTrue(app.descendants(matching: .any)["lineup-done"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["lock-in"].exists)
    }
}
