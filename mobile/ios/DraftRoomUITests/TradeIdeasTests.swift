import XCTest

/// Trade ideas and write-ups (APE-392) against the stubbed API (Support/UITestStub.swift, AiSample):
/// find this week's ideas, load the win-win into the builder, read its AI write-up, and check the
/// counter it suggests.
final class TradeIdeasTests: XCTestCase {
    @MainActor
    func testFindAnIdeaAndReadItsWriteup() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let tab = app.tabBars.buttons["Trades"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()

        let find = app.buttons["find-trade-ideas"]
        XCTAssertTrue(find.waitForExistence(timeout: 5))
        find.tap()

        let load = app.buttons["load-idea-safe"]
        XCTAssertTrue(load.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Win-win"].exists)
        XCTAssertTrue(app.staticTexts["No bolder swing this week that a partner would plausibly take."].exists)
        load.tap()
        XCTAssertTrue(app.staticTexts["Graded in the builder. Change either side to make it your own."].waitForExistence(timeout: 5))

        let writeup = app.buttons["trade-writeup"]
        for _ in 0 ..< 6 where !writeup.isHittable { app.swipeUp() }
        XCTAssertTrue(writeup.waitForExistence(timeout: 5))
        writeup.tap()

        XCTAssertTrue(app.staticTexts["Counter"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["share-writeup"].exists)
        let counter = app.buttons["check-counter"]
        XCTAssertTrue(counter.exists)
        counter.tap()
        // The counter asks for two players: it's in the builder now, and the idea is no longer the one loaded.
        XCTAssertTrue(app.buttons["You get · 2"].waitForExistence(timeout: 5))
    }
}
