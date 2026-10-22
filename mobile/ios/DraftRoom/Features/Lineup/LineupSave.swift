import SwiftUI

/// Saving the lineup to ESPN (APE-382), after the web's ApplyLineup: the write consent the first
/// time, then each change in the server's words with a toggle, then the send. Nothing is written
/// until the user taps Apply, and nothing is ever queued.
struct SaveSheet: View {
    let model: LineupModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    switch model.phase {
                    case let .consent(version, lines):
                        ConsentStep(lines: lines) { Task { await model.agree(version: version) } }
                    case let .failed(message, details):
                        FailedStep(message: message, details: details) { Task { await model.review() } }
                    case .review, .checking, .sending:
                        if let dry = model.dry {
                            ReviewStep(model: model, dry: dry)
                        } else {
                            ProgressView().tint(.muted).frame(maxWidth: .infinity).padding(Spacing.xl * 2)
                        }
                    case .idle, .saved:
                        EmptyView()
                    }
                }
                .padding(Spacing.xl + Spacing.xs)
                .animation(Motion.respond, value: model.phase)
            }
            .background(.bg)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.cancel() }.disabled(model.phase == .sending)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(model.phase == .sending)
        .accessibilityIdentifier("save-sheet")
    }

    private var title: String {
        if case .consent = model.phase { return "Changes on ESPN" }
        return "Save to ESPN"
    }
}

/// The write consent, in the server's words (never the app's): asked once, recorded on the server.
/// The first line is the promise, in text ink; the rest are its terms, quieter, on one panel.
struct ConsentStep: View {
    let lines: [String]
    let onAgree: () -> Void
    @State private var agreed = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                    if i > 0 { Divider().overlay(.rowLine) }
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                        Circle().fill(i == 0 ? Color.sky : Color.dim).frame(width: 5, height: 5)
                            .alignmentGuide(.firstTextBaseline) { $0[.bottom] + 3 }
                        Text(line)
                            .typeStyle(i == 0 ? TypeScale.body : TypeScale.label).fontWeight(i == 0 ? .semibold : .regular)
                            .foregroundStyle(i == 0 ? Color.text : Color.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, Spacing.xl)
                    .padding(.vertical, Spacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .background(.panel, in: RoundedRectangle(cornerRadius: Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Radius.card).stroke(.line))
            .accessibilityElement(children: .combine)
            Toggle("I agree", isOn: $agreed)
                .typeStyle(TypeScale.body).foregroundStyle(.text).tint(.sky)
                .accessibilityLabel("I agree to Draft Room changing my team on ESPN when I confirm")
                .accessibilityIdentifier("consent-toggle")
            Button("Agree and continue", action: onAgree)
                .buttonStyle(ProviderButtonStyle(prominent: true))
                .disabled(!agreed)
                .accessibilityIdentifier("consent-agree")
        }
    }
}

/// Each change with its toggle; any toggle asks the server again, since one change can need another.
private struct ReviewStep: View {
    let model: LineupModel
    let dry: LineupDryRun

    var body: some View {
        let picked = dry.changes.filter(\.picked)
        let busy = model.phase == .checking || model.phase == .sending
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(question(picked.count)).typeStyle(TypeScale.body).foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 0) {
                ForEach(dry.changes) { change in
                    Toggle(isOn: Binding(
                        get: { model.picked?.contains(change.id) ?? change.picked },
                        set: { on in Task { await model.toggle(change.id, on: on) } })) {
                        Text(change.text).typeStyle(TypeScale.body).foregroundStyle(.text)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .tint(.sky)
                    .disabled(model.phase == .sending)
                    .padding(.horizontal, Spacing.xl)
                    .padding(.vertical, Spacing.lg)
                    .accessibilityIdentifier("change-\(change.id)")
                    if change.id != dry.changes.last?.id { Divider().overlay(.rowLine) }
                }
            }
            .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
            .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(.line))

            if !dry.problems.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    ForEach(dry.problems, id: \.self) { problem in
                        Label(problem, systemImage: "exclamationmark.triangle.fill")
                            .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.warnInk)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityIdentifier("save-problems")
            }

            Button {
                Task { await model.send() }
            } label: {
                HStack(spacing: Spacing.md) {
                    if busy { ProgressView().tint(.sky) }
                    Text(model.phase == .sending ? "Setting your lineup…" : "Apply to ESPN")
                }
            }
            .buttonStyle(ProviderButtonStyle(prominent: true))
            .disabled(busy || picked.isEmpty || !dry.problems.isEmpty)
            .accessibilityIdentifier("apply-lineup")
        }
    }

    private func question(_ count: Int) -> String {
        guard let week = model.store.season?.view.currentWeek else { return "" }
        if count == 0 { return "Every change is left out. Tick one to apply it." }
        return "Apply \(count == 1 ? "this change" : "these \(count) changes") to your team on ESPN for week \(week)?"
    }
}

struct FailedStep: View {
    let message: String
    let details: [String]
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .typeStyle(TypeScale.body).foregroundStyle(.reachInk)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(details, id: \.self) { line in
                Text(line).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button("Try again", action: retry).buttonStyle(ProviderButtonStyle())
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("save-failed")
    }
}

// MARK: - After the save

/// What the last save did, when something didn't land: each change in the server's words.
struct SaveResults: View {
    let save: LineupApplied

    var body: some View {
        if save.allLanded {
            Label("Done. ESPN has your new lineup.", systemImage: "checkmark.circle.fill")
                .typeStyle(TypeScale.title).foregroundStyle(.valueInk)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("lineup-done")
        } else {
            SeasonCard(title: "Some moves didn't land on ESPN", tint: Color.reach.opacity(0.4)) {
                VStack(alignment: .leading, spacing: Spacing.lg) {
                    ForEach(save.changes) { change in
                        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                            Image(systemName: change.landed ? "checkmark" : "xmark")
                                .foregroundStyle(change.landed ? Color.valueInk : Color.reachInk)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(change.text).typeStyle(TypeScale.body).foregroundStyle(.text)
                                Text(change.result).typeStyle(TypeScale.label).foregroundStyle(change.landed ? Color.muted : Color.reachInk)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    Text("Draft Room has been alerted.").typeStyle(TypeScale.label).foregroundStyle(.muted)
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.bottom, Spacing.xl)
            }
            .accessibilityIdentifier("lineup-results")
        }
    }
}

/// The lineup locked in (the web's LockIn.tsx), native: the ✓ stamps in on a spring with a success
/// haptic, the banked points count up, and ESPN's total moves from before to after. It plays once per
/// league and week; after that, and with Reduce Motion on, it simply fades in.
struct LockInCard: View {
    let moment: LockInMoment
    let playing: Bool
    let week: Int
    /// War Room's swaps still to make, now ESPN has been read back.
    var left = 0
    /// Stages the rest of War Room's lineup and opens the review.
    var onFinish: () -> Void = {}

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        let animate = playing && !reduceMotion
        VStack(alignment: .leading, spacing: Spacing.lg) {
            summary(animate: animate)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(spoken)
                .accessibilityAddTraits(.updatesFrequently)
                .accessibilityIdentifier("lock-in")
            if moment.leftover >= 0.05, left > 0 {
                Button(left == 1 ? "Make the last move" : "Make these \(left) moves", action: onFinish)
                    .buttonStyle(ProviderButtonStyle(prominent: true))
                    .accessibilityIdentifier("lock-in-finish")
            }
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.value.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(Color.value.opacity(0.45)))
        .scaleEffect(shown || !animate ? 1 : 0.94)
        .opacity(shown ? 1 : 0)
        .sensoryFeedback(Haptic.success, trigger: shown) { _, now in now && playing }
        .onAppear {
            withAnimation(animate ? .spring(duration: 0.7, bounce: 0.35).delay(0.1) : Motion.fade) { shown = true }
        }
    }

    private func summary(animate: Bool) -> some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Text("+" + SeasonFormat.points(shown ? moment.banked : 0))
                    .typeStyle(TypeScale.display).monospacedDigit().foregroundStyle(.valueInk)
                    .contentTransition(.numericText(value: shown ? moment.banked : 0))
                Text("pts").typeStyle(TypeScale.title).foregroundStyle(.valueInk)
            }
            HStack(spacing: Spacing.sm) {
                Text(SeasonFormat.points(moment.before)).strikethrough().foregroundStyle(.dim)
                Image(systemName: "arrow.right").font(.system(size: 10, weight: .bold)).foregroundStyle(.dim)
                Text(SeasonFormat.points(shown ? moment.after : moment.before)).foregroundStyle(.text)
                    .contentTransition(.numericText(value: shown ? moment.after : moment.before))
                Text("on ESPN · week \(week)").foregroundStyle(.muted)
            }
            .typeStyle(TypeScale.label).monospacedDigit()
            HStack(spacing: Spacing.md) {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(.value)
                    .scaleEffect(shown ? 1 : (animate ? 0.3 : 1))
                Text(moment.headline).typeStyle(TypeScale.title).foregroundStyle(.text)
            }
            VStack(spacing: Spacing.sm) {
                ForEach(moment.moves) { move in
                    HStack {
                        Text(move.text).typeStyle(TypeScale.body).foregroundStyle(.text)
                        if move.own { Text("Your call").typeStyle(TypeScale.micro).foregroundStyle(.muted) }
                        Spacer()
                        Text(SeasonFormat.signed(move.gain)).typeStyle(TypeScale.body).monospacedDigit()
                            .foregroundStyle(move.gain < 0 ? Color.reachInk : Color.valueInk)
                    }
                }
            }
            if moment.leftover >= 0.05 {
                Text("\(SeasonFormat.points(moment.leftover)) more points are still on your bench.")
                    .typeStyle(TypeScale.label).foregroundStyle(.warnInk)
            }
        }
    }

    private var spoken: String {
        var parts = ["Lineup set on ESPN.", "Draft Room's moves add \(SeasonFormat.points(moment.banked)) projected points."]
        if moment.leftover >= 0.05 { parts.append("\(SeasonFormat.points(moment.leftover)) more points are still on your bench.") }
        return parts.joined(separator: " ")
    }
}
