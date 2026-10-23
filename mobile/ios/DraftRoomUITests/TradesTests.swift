import XCTest

/// The Trades tab (APE-405) against the stubbed API (Support/UITestStub.swift): Gridiron Gang's offer
/// of Bijan Robinson for Tank Bigsby, accepted on ESPN.
final class TradesTests: XCTestCase {
    @MainActor
    func testAcceptAnOffer() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let tab = app.tabBars.buttons["Trades"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()

        // Each offer shows only what the user can do with it.
        let accept = app.buttons["accept-trade-1"]
        XCTAssertTrue(accept.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["decline-trade-1"].exists)
        XCTAssertTrue(app.buttons["withdraw-trade-2"].exists)
        XCTAssertFalse(app.buttons["accept-trade-2"].exists)
        accept.tap()

        // The consent first, then the server's question.
        let consent = app.switches["consent-toggle"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        consent.switches.firstMatch.tap()
        app.buttons["consent-agree"].tap()
        XCTAssertTrue(app.staticTexts["Accept on ESPN? You get Bijan Robinson and send Tank Bigsby. It goes through after the league's review."].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["trade-send"].label, "Accept on ESPN")
        app.buttons["trade-send"].tap()

        let notice = app.descendants(matching: .any)["trades-notice"]
        XCTAssertTrue(notice.waitForExistence(timeout: 5))
        XCTAssertEqual(notice.label, "Offer accepted. It's in the league's review.")
    }
}
