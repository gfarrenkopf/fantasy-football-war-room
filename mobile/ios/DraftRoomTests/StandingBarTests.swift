import Foundation
import Testing

@testable import DraftRoom

/// The standing strip's hide-on-scroll (APE-438): it goes on a scroll down, comes back on a scroll up
/// or at the top, and follows the user straight away both ways. The strip keeps its room in the bar,
/// so the inset is the same whether it's shown or not.
@MainActor
@Suite
struct StandingBarTests {
    let bar = StandingBar()
    /// The scroll view's top inset, the strip's room included.
    let inset: CGFloat = 120

    private func spot(_ y: CGFloat, inset: CGFloat? = nil) -> ScrollSpot {
        ScrollSpot(y: y, inset: inset ?? self.inset, end: 4000)
    }

    /// Scrolls from `from` to `to` in small steps.
    private func scroll(_ from: CGFloat, _ to: CGFloat) {
        let step: CGFloat = from < to ? 8 : -8
        var y = from
        while (step > 0 && y < to) || (step < 0 && y > to) {
            let next = step > 0 ? min(y + step, to) : max(y + step, to)
            bar.scrolled(from: spot(y), to: spot(next))
            y = next
        }
    }

    @Test func hidesOnAScrollDownAndShowsOnTheWayBackUp() {
        scroll(-inset, -inset + StandingBar.travel)
        #expect(!bar.hidden) // a nudge
        scroll(-inset + StandingBar.travel, 400)
        #expect(bar.hidden)
        scroll(400, 360)
        #expect(!bar.hidden)
    }

    @Test func aFlickBackUpRightAfterItGoesBringsItBack() {
        scroll(-inset, 400)
        #expect(bar.hidden)
        // No waiting on the strip to settle: the very next scroll up past `travel` counts.
        bar.scrolled(from: spot(400), to: spot(380))
        bar.scrolled(from: spot(380), to: spot(350))
        #expect(!bar.hidden)
    }

    @Test func alwaysComesBackAtTheTop() {
        scroll(-inset, 400)
        #expect(bar.hidden)
        bar.scrolled(from: spot(400), to: spot(-inset))
        #expect(!bar.hidden)
    }

    @Test func theBounceAtTheEndDoesntBringItBack() {
        scroll(-inset, 400)
        #expect(bar.hidden)
        let end = ScrollSpot(y: 500, inset: inset, end: 400)
        bar.scrolled(from: spot(400), to: end)
        bar.scrolled(from: end, to: ScrollSpot(y: 440, inset: inset, end: 400))
        #expect(bar.hidden)
    }

    @Test func anInsetChangeIsntAScroll() {
        scroll(-inset, 400)
        #expect(bar.hidden)
        // The text size grows the bar, and the offset follows a report later.
        bar.scrolled(from: spot(400), to: spot(400, inset: inset + 60))
        bar.scrolled(from: spot(400, inset: inset + 60), to: spot(340, inset: inset + 60))
        #expect(!bar.hidden) // a real 60-point move up from where the inset settled
    }

    @Test func resetShowsItAndForgetsTheLastTab() {
        scroll(-inset, 400)
        #expect(bar.hidden)
        bar.reset()
        #expect(!bar.hidden)
        // The next tab's first report starts its own turn, wherever it sits.
        bar.scrolled(from: spot(1000), to: spot(1020))
        #expect(!bar.hidden)
    }
}
