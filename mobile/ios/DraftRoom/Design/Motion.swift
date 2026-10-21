import SwiftUI

/// The app's shared feel: every screen moves and buzzes the same way. Use these rather than
/// one-off springs and haptics, as the web uses its shared easing tokens.
enum Motion {
    /// Things arriving: a screen's content settling into place.
    static let settle = Animation.spring(duration: 0.6, bounce: 0.2)
    /// Things responding to a tap: a step change, a list switch.
    static let respond = Animation.spring(duration: 0.4, bounce: 0.15)
    /// A press, under the finger.
    static let press = Animation.spring(duration: 0.2)
    /// Fades between whole states (signed in, signed out).
    static let fade = Animation.easeInOut(duration: 0.3)

    /// The stagger between items rising one after another.
    static func stagger(_ index: Int) -> Animation {
        settle.delay(0.12 + Double(index) * 0.06)
    }
}

/// The haptics, named for what happened rather than how it feels.
enum Haptic {
    /// Something finished well: signed in, connected, saved.
    static let success = SensoryFeedback.success
    /// A choice changed: a league, a tab, a toggle.
    static let choice = SensoryFeedback.selection
    /// Something didn't work.
    static let failure = SensoryFeedback.error
}
