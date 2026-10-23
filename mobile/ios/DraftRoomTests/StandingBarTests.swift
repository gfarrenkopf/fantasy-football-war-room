import Foundation
import Testing

@testable import DraftRoom

/// The standing strip's hide-on-scroll (APE-438): it goes on a scroll down well clear of the top,
/// comes back on a scroll up or at the top, and its own inset shift never reads as the user scrolling.
@MainActor
@Suite
struct StandingBarTests {
    /// A clock the test moves by hand.
    final class Clock {
        var now = ContinuousClock.now
    }

    let clock = Clock()
    let bar: StandingBar
    /// The strip's height: the inset with it shown, over the inset without.
    let shown: CGFloat = 120
    let gone: CGFloat = 60

    init() {
        let clock = clock
        bar = StandingBar(now: { clock.now })
    }

    private func spot(_ y: CGFloat, inset: CGFloat) -> ScrollSpot { ScrollSpot(y: y, inset: inset, end: 4000) }

    /// Scrolls from `from` to `to` in small steps at one inset.
    private func scroll(_ from: CGFloat, _ to: CGFloat, inset: CGFloat) {
        let step: CGFloat = from < to ? 8 : -8
        var y = from
        while (step > 0 && y < to) || (step < 0 && y > to) {
            let next = step > 0 ? min(y + step, to) : max(y + step, to)
            bar.scrolled(from: spot(y, inset: inset), to: spot(next, inset: inset))
            y = next
        }
    }

    private func settle() { clock.now += StandingBar.settle + .milliseconds(1) }

    @Test func hidesOnAScrollDownWellClearOfTheTopAndShowsOnTheWayBackUp() {
        scroll(-shown, -shown + 100, inset: shown)
        #expect(!bar.hidden) // still near the top
        scroll(-shown + 100, 400, inset: shown)
        #expect(bar.hidden)
        settle()
        scroll(400, 360, inset: gone)
        #expect(!bar.hidden)
    }

    @Test func itsOwnInsetShiftDoesntBringItBack() {
        scroll(-shown, 400, inset: shown)
        #expect(bar.hidden)
        // The inset shrinks, then a report later the offset follows by the strip's height: not the user.
        bar.scrolled(from: spot(400, inset: shown), to: spot(400, inset: gone))
        bar.scrolled(from: spot(400, inset: gone), to: spot(340, inset: gone))
        #expect(bar.hidden)
        settle()
        scroll(340, 420, inset: gone)
        #expect(bar.hidden)
    }

    @Test func alwaysComesBackAtTheTop() {
        scroll(-shown, 400, inset: shown)
        #expect(bar.hidden)
        // Straight back to the top while it's still settling.
        bar.scrolled(from: spot(400, inset: gone), to: spot(-gone, inset: gone))
        #expect(!bar.hidden)
    }
}
