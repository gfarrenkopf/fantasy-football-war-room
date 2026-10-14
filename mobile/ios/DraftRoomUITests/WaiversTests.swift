import XCTest

/// The Waivers tab (APE-388) against the stubbed API (Support/UITestStub.swift): the wire, then
/// Rico Dowdle added with a drop the user picks over the suggested one.
final class WaiversTests: XCTestCase {
    @MainActor
    func testAddWithADrop() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let tab = app.tabBars.buttons["Waivers"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()

        // Next week's hole, then the ranked pickups; Jennings is still on waivers, so no Add.
        XCTAssertTrue(app.staticTexts["Week 4: hole at K"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Waiver priority 4 of 12"].exists)
        XCTAssertFalse(app.buttons["add-22"].exists)

        app.buttons["add-21"].tap()
        let consent = app.switches["consent-toggle"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        consent.switches.firstMatch.tap()
        app.buttons["consent-agree"].tap()

        // Downs is the suggested drop; Bigsby goes instead.
        let text = app.staticTexts["acquire-text"]
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        XCTAssertEqual(text.label, "Add Rico Dowdle and drop Josh Downs.")
        app.buttons["drop-6"].tap()
        XCTAssertTrue(app.staticTexts["Add Rico Dowdle and drop Tank Bigsby."].waitForExistence(timeout: 5))

        app.buttons["acquire-send"].tap()
        let notice = app.staticTexts["waivers-notice"]
        XCTAssertTrue(notice.waitForExistence(timeout: 5))
        XCTAssertEqual(notice.label, "Done. Rico Dowdle is on your team, and Tank Bigsby is gone.")
    }
}
