import XCTest

/// The recap archive on Game day (APE-384), against the stubbed API's decided week (`-uiTestFinal`,
/// Support/RecapSample.swift): week 3 is Game day's own result, so the archive leads with week 2.
final class RecapTests: XCTestCase {
    @MainActor
    func testOpensARecapFromTheArchive() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestStub", "-uiTestFinal"]
        app.launch()

        // Win Night opens first on a decided win; skip to its end and leave it.
        XCTAssertTrue(app.buttons["win-night-close"].waitForExistence(timeout: 10))
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
        let done = app.buttons["win-night-done"]
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        // The archive sits below the result; the week Game day already tells isn't listed again.
        let hero = app.buttons["recap-hero"]
        for _ in 0 ..< 8 where !hero.isHittable { app.swipeUp() }
        XCTAssertTrue(hero.waitForExistence(timeout: 5))
        XCTAssertTrue(hero.label.hasPrefix("Week 2: lost 88.2 to 91.0 against Hail Marys."), hero.label)
        XCTAssertFalse(app.buttons["recap-week-3"].exists)

        hero.tap()
        let story = app.descendants(matching: .any)["recap-hero-text"]
        XCTAssertTrue(story.waitForExistence(timeout: 5))
        XCTAssertTrue(story.label.hasPrefix("Week 2 final: you lost, 88.2 to 91.0, to Hail Marys. Brutal."), story.label)
        XCTAssertTrue(app.buttons["share-recap"].waitForExistence(timeout: 5))
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Standings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Game changer"].exists || app.staticTexts["Top scorers"].exists)

        // Back to Game day, and on to the week before.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let week1 = app.buttons["recap-week-1"]
        for _ in 0 ..< 4 where !week1.isHittable { app.swipeUp() }
        week1.tap()
        XCTAssertTrue(story.waitForExistence(timeout: 5))
        XCTAssertTrue(story.label.hasPrefix("Week 1 final: you won, 102.4 to 87.3"), story.label)
    }
}
