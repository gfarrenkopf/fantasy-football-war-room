import SwiftUI

/// The AI lineup (APE-391), after the web's AiLineupCard: the AI talks through this week's lineup and
/// makes the close calls. "Use this lineup" stages its starters in the editor above; the save goes
/// through the usual review, so the lineup route stays the only way anything reaches ESPN.
struct AiLineupCard: View {
    let ai: AiModel
    let lineup: LineupModel

    var body: some View {
        if let state = ai.ai {
            SeasonCard(title: "AI lineup", note: state.access.state == "trial" ? state.access.note : nil) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    content(state)
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("ai-lineup")
            .animation(Motion.respond, value: state)
            .animation(Motion.respond, value: ai.working)
        }
    }

    @ViewBuilder private func content(_ state: AiResponse) -> some View {
        if state.access.isLocked {
            AiLocked(note: state.access.note)
        } else if let written = state.lineup {
            Written(lineup: written)
            if !written.espn.matches {
                let staged = lineup.isStaged(ai: written.starters)
                Button {
                    lineup.startFromAi(written.starters)
                } label: {
                    Label(staged ? "In your lineup above" : "Use this lineup", systemImage: staged ? "checkmark" : "arrow.up")
                }
                .buttonStyle(ProviderButtonStyle(prominent: !staged))
                .disabled(staged)
                .accessibilityIdentifier("ai-use-lineup")
                .sensoryFeedback(Haptic.choice, trigger: staged) { _, now in now }
            }
            if state.lineupAction == "rewrite" {
                action("Rewrite with the latest news", working: "Rewriting…", prominent: false)
            }
        } else if let note = state.lineupNote {
            Text(note).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
        } else if state.lineupAction == "write" {
            if ai.working != .lineup {
                Text("The AI talks through this week's lineup and makes the close calls: one mid-week, and one on Sunday morning after the inactives.")
                    .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            action("Write my AI lineup", working: "Writing your lineup…", prominent: true)
        }
        if let error = ai.lineupError {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .typeStyle(TypeScale.label).foregroundStyle(.warnInk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("ai-lineup-error")
        }
    }

    /// The write button, or, while it runs, a calm note that the user can leave and come back.
    @ViewBuilder private func action(_ title: String, working: String, prominent: Bool) -> some View {
        if ai.working == .lineup {
            Writing(title: working)
        } else {
            Button(title) { Task { await ai.writeLineup() } }
                .buttonStyle(ProviderButtonStyle(prominent: prominent))
                .accessibilityIdentifier("ai-write-lineup")
        }
    }
}

/// The AI's lineup as written: its intro, any close call it made the other way, each call's reason,
/// and whether ESPN starts these players now.
private struct Written: View {
    let lineup: AiLineup

    var body: some View {
        Text(lineup.intro).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.text)
            .fixedSize(horizontal: false, vertical: true)
        if let departures = lineup.departures {
            Text(departures)
                .typeStyle(TypeScale.label).foregroundStyle(.sky)
                .fixedSize(horizontal: false, vertical: true)
                .padding(Spacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.skyLine.opacity(0.18), in: RoundedRectangle(cornerRadius: Radius.lg))
                .accessibilityIdentifier("ai-departures")
        }
        if !lineup.calls.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lineup.calls.enumerated()), id: \.offset) { index, call in
                    if index > 0 { Divider().overlay(.rowLine) }
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.lg) {
                        Text(call.slot).typeStyle(TypeScale.micro).foregroundStyle(.muted)
                            .frame(width: 36, alignment: .leading)
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text(call.player?.name ?? "Nobody").typeStyle(TypeScale.body).foregroundStyle(.text)
                            Text(call.reason).typeStyle(TypeScale.label).foregroundStyle(.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.vertical, Spacing.md)
                    .accessibilityElement(children: .combine)
                }
            }
        }
        Label(lineup.espn.text, systemImage: lineup.espn.matches ? "checkmark.circle.fill" : "arrow.left.arrow.right")
            .typeStyle(TypeScale.label)
            .foregroundStyle(lineup.espn.matches ? Color.valueInk : Color.warnInk)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("ai-espn")
        Text("Written \(lineup.createdAt.formatted(.dateTime.weekday(.abbreviated).hour().minute())) from the projections then.")
            .typeStyle(TypeScale.label).foregroundStyle(.dim)
    }
}

/// A write running: the AI can take a minute, and the user is free to go.
private struct Writing: View {
    let title: String

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.lg) {
            ProgressView().tint(.sky)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(title).typeStyle(TypeScale.body).foregroundStyle(.text)
                Text("Up to a minute. You can leave this screen; it'll be here when you're back.")
                    .typeStyle(TypeScale.label).foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.bg.opacity(0.35), in: RoundedRectangle(cornerRadius: Radius.lg))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("ai-writing")
    }
}

/// Past the free weeks with no pass: the server's one line. No link, button or price (App Store
/// guideline 3.1.1).
struct AiLocked: View {
    let note: String?

    var body: some View {
        Label(note ?? "", systemImage: "lock")
            .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("ai-locked")
    }
}
