import XCTest

/// The AI lineup card (APE-391) against the stubbed API (Support/UITestStub.swift, AiSample): write
/// the AI lineup, then "Use this lineup" stages its two changes in the editor, ready to review.
final class AiLineupTests: XCTestCase {
    @MainActor
    func testWriteTheAiLineupAndUseIt() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let tab = app.tabBars.buttons["Lineup"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()

        let write = app.buttons["ai-write-lineup"]
        for _ in 0 ..< 6 where !write.isHittable { app.swipeUp() }
        XCTAssertTrue(write.waitForExistence(timeout: 5))
        XCTAssertEqual(write.label, "Write my AI lineup")
        XCTAssertTrue(app.staticTexts["Free trial · week 2 of 5"].exists)
        write.tap()

        // The ESPN check's text, not its icon, which carries the same identifier.
        XCTAssertTrue(app.staticTexts["Not on ESPN yet: Tucker Kraft at TE, Tank Bigsby at FLEX."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["ai-departures"].firstMatch.exists)

        let use = app.buttons["ai-use-lineup"]
        XCTAssertTrue(use.waitForExistence(timeout: 5))
        use.tap()
        XCTAssertTrue(app.buttons["In your lineup above"].waitForExistence(timeout: 5))

        // Staged, not saved: the review bar counts the AI's changes, and the save is the usual review.
        let review = app.buttons["review-lineup"]
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        XCTAssertEqual(review.label, "Review 2 swaps")
    }

    /// Past the free weeks: one line about the pass, and no button, link or price.
    @MainActor
    func testALockedLeagueSaysWhereThePassIs() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub", "-uiTestAiLocked"]
        app.launch()

        let tab = app.tabBars.buttons["Lineup"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()

        let locked = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "season pass")).firstMatch
        for _ in 0 ..< 6 where !locked.exists { app.swipeUp() }
        XCTAssertTrue(locked.waitForExistence(timeout: 5))
        XCTAssertTrue(locked.label.contains("draftroom.online"), locked.label)
        XCTAssertFalse(app.buttons["ai-write-lineup"].exists)
        XCTAssertFalse(app.links.firstMatch.exists)
    }
}
