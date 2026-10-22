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
        XCTAssertTrue(app.tabBars.buttons["Trades"].exists)
        XCTAssertTrue(app.tabBars.buttons["Waivers"].exists)

        app.tabBars.buttons["Lineup"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["section-lineup"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["seat-0"].waitForExistence(timeout: 5))

        // A league switch opens the tab the new league's week calls for: Game day while games are on.
        app.buttons["league-switcher"].firstMatch.tap()
        app.buttons["Sunday Regulars"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["scoreboard"].waitForExistence(timeout: 5))
        XCTAssertTrue(gameDay.isSelected)
    }

    /// The section menu top left (APE-416): it lists the tab's cards and scrolls to the one picked.
    @MainActor
    func testSectionMenuJumps() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["scoreboard"].waitForExistence(timeout: 10))
        let bench = app.staticTexts["Your bench"]
        XCTAssertFalse(bench.isHittable)

        let menu = app.buttons["section-menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        menu.tap()
        XCTAssertTrue(app.buttons["Scoreboard"].waitForExistence(timeout: 5))
        app.buttons["Your bench"].tap()
        let landed = expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: bench)
        wait(for: [landed], timeout: 5)

        // Every tab with cards gets its own list.
        app.tabBars.buttons["Lineup"].tap()
        XCTAssertTrue(app.buttons["seat-0"].waitForExistence(timeout: 5))
        menu.tap()
        XCTAssertTrue(app.buttons["Starters"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Bench"].exists)
    }

    /// A pushed screen has no sections: back takes the menu's place.
    @MainActor
    func testBackReplacesSectionMenu() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub", "-uiTestFinal"]
        app.launch()

        // Win Night opens first on a decided win; skip to its end and leave it.
        XCTAssertTrue(app.buttons["win-night-close"].waitForExistence(timeout: 10))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
        let done = app.buttons["win-night-done"]
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()
        XCTAssertTrue(app.buttons["section-menu"].waitForExistence(timeout: 5))

        let hero = app.buttons["recap-hero"]
        for _ in 0 ..< 8 where !hero.isHittable { app.swipeUp() }
        hero.tap()
        XCTAssertTrue(app.descendants(matching: .any)["recap-hero-text"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["section-menu"].exists)
    }

    /// Unsaved lineup changes ride above the tab bar on every tab, and open the review on Lineup.
    @MainActor
    func testReviewFollowsToEveryTab() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let lineup = app.tabBars.buttons["Lineup"]
        XCTAssertTrue(lineup.waitForExistence(timeout: 10))
        lineup.tap()
        let te = app.buttons["seat-3"]
        XCTAssertTrue(te.waitForExistence(timeout: 5))
        te.tap()
        let kraft = app.buttons["pick-8"]
        XCTAssertTrue(kraft.waitForExistence(timeout: 5))
        kraft.tap()

        app.tabBars.buttons["Trades"].tap()
        let review = app.buttons["review-lineup"]
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        XCTAssertEqual(review.label, "Review 2 swaps")
        review.tap()
        XCTAssertTrue(app.switches["consent-toggle"].waitForExistence(timeout: 5))
        XCTAssertTrue(lineup.isSelected)
    }

    /// Leaving a tab and coming back keeps its section menu, without a scroll to bring it back.
    @MainActor
    func testSectionMenuSurvivesATabSwitch() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub"]
        app.launch()

        let menu = app.buttons["section-menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        app.tabBars.buttons["Lineup"].tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        app.tabBars.buttons["Game day"].tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
        app.tabBars.buttons["Lineup"].tap()
        XCTAssertTrue(menu.waitForExistence(timeout: 5))
    }
}
