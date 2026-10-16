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
        XCTAssertTrue(app.buttons["claim-22"].exists)

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

    /// Free agents (APE-411): Tyler Bass found by name, past the pickups, and added like one.
    @MainActor
    func testSearchAndAddAFreeAgent() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let tab = app.tabBars.buttons["Waivers"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()

        let field = app.textFields["free-agents-search"]
        for _ in 0 ..< 6 where !field.isHittable { app.swipeUp() }
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("bass")

        // Only Bass matches; he'd add nothing, and the row says so.
        let add = app.buttons["add-26"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Wouldn't start"].exists)

        // Nobody's name starts "ass".
        app.buttons["Clear search"].tap()
        field.tap()
        field.typeText("ass")
        XCTAssertTrue(app.staticTexts["free-agents-empty"].waitForExistence(timeout: 5))

        app.buttons["Clear search"].tap()
        field.tap()
        field.typeText("tyler")
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        app.swipeUp()
        add.tap()
        let consent = app.switches["consent-toggle"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        consent.switches.firstMatch.tap()
        app.buttons["consent-agree"].tap()
        XCTAssertTrue(app.staticTexts["Add Tyler Bass and drop Josh Downs."].waitForExistence(timeout: 5))
        app.buttons["acquire-send"].tap()
        let notice = app.staticTexts["waivers-notice"]
        XCTAssertTrue(notice.waitForExistence(timeout: 5))
        XCTAssertEqual(notice.label, "Done. Tyler Bass is on your team, and Josh Downs is gone.")
    }

    /// Rostered players (APE-413): Bijan Robinson found on Gridiron Gang, and a trade for him opened in Trades.
    @MainActor
    func testTradeForARosteredPlayerFromTheSearch() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let tab = app.tabBars.buttons["Waivers"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()

        let field = app.textFields["free-agents-search"]
        for _ in 0 ..< 6 where !field.isHittable { app.swipeUp() }
        field.tap()
        field.typeText("bijan")

        XCTAssertTrue(app.staticTexts["On Gridiron Gang"].waitForExistence(timeout: 5))
        let trade = app.buttons["trade-for-12"]
        if !trade.isHittable { app.swipeUp() }
        trade.tap()

        XCTAssertTrue(app.buttons["trade-partner"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["trade-partner"].label.contains("Gridiron Gang"))
        XCTAssertTrue(app.descendants(matching: .any)["trade-grade"].waitForExistence(timeout: 5))
    }

    /// Claims (APE-389): Jennings claimed off waivers, then Coleman's pending claim cancelled.
    @MainActor
    func testPlaceAndCancelAClaim() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let tab = app.tabBars.buttons["Waivers"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()

        let claim = app.buttons["claim-22"]
        XCTAssertTrue(claim.waitForExistence(timeout: 5))
        claim.tap()
        let consent = app.switches["consent-toggle"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        consent.switches.firstMatch.tap()
        app.buttons["consent-agree"].tap()

        XCTAssertTrue(app.staticTexts["Claim Jauan Jennings off waivers, dropping Josh Downs if the claim goes through."].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["acquire-send"].label, "Claim on ESPN")
        app.buttons["acquire-send"].tap()
        let notice = app.staticTexts["waivers-notice"]
        XCTAssertTrue(notice.waitForExistence(timeout: 5))
        XCTAssertEqual(notice.label, "Claim placed for Jauan Jennings.")

        // The pending claim, cancelled with the same confirm.
        let cancel = app.buttons["cancel-claim-claim-1"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        cancel.tap()
        XCTAssertTrue(app.staticTexts["Cancel your claim for Keon Coleman."].waitForExistence(timeout: 5))
        app.buttons["acquire-send"].tap()
        XCTAssertTrue(app.staticTexts["Claim for Keon Coleman cancelled."].waitForExistence(timeout: 5))
    }

    /// Swiping a pending claim left opens the same cancel confirm, and "Keep it" leaves it be.
    @MainActor
    func testSwipeToCancelAClaim() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let tab = app.tabBars.buttons["Waivers"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()

        let row = app.staticTexts["Keon Coleman"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.swipeLeft()
        let consent = app.switches["consent-toggle"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        consent.switches.firstMatch.tap()
        app.buttons["consent-agree"].tap()
        XCTAssertTrue(app.staticTexts["Cancel your claim for Keon Coleman."].waitForExistence(timeout: 5))
        app.buttons["Keep it"].tap()
        XCTAssertTrue(app.buttons["cancel-claim-claim-1"].waitForExistence(timeout: 5))
    }
}
