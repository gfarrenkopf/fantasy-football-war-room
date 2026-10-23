import SwiftUI

/// What ESPN shows after a write, in the server's words: a floating capsule like the system's own
/// confirmations, shown over a tab where the eye is (a drop on Lineup, an offer on Trades). VoiceOver
/// reads it out; a tap or a few seconds puts it away. One that didn't land stays longer.
struct NoticeToast: View {
    let text: String
    let landed: Bool
    let identifier: String
    let onDismiss: () -> Void

    var body: some View {
        Label {
            Text(text).foregroundStyle(landed ? Color.text : Color.reachInk)
        } icon: {
            Image(systemName: landed ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(landed ? Color.valueInk : Color.reachInk)
        }
            .typeStyle(TypeScale.body).fontWeight(.semibold)
            .toastCapsule(border: landed ? Color.line2 : Color.reach.opacity(0.6))
            .onTapGesture(perform: onDismiss)
            // One element read as the server's words: left to the Label, the identifier lands on the
            // icon too, which VoiceOver reads as "Selected".
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(text)
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Dismisses")
            .accessibilityIdentifier(identifier)
            .task(id: text) {
                AccessibilityNotification.Announcement(text).post()
                try? await Task.sleep(for: .seconds(landed ? 4 : 8))
                if !Task.isCancelled { onDismiss() }
            }
    }
}

extension View {
    /// The toasts' floating capsule, like the system's own confirmations.
    func toastCapsule(border: Color) -> some View {
        fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.lg)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(border))
            .shadow(color: .black.opacity(0.35), radius: 16, y: 6)
            .contentShape(Capsule())
    }
}
