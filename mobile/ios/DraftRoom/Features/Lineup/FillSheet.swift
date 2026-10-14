import SwiftUI

/// Filling a hole (APE-404), after the web's hole card: the ranked ways to fill it, then the consent
/// the first time, then the server's steps (IR, add, start) to confirm, then what ESPN shows for each.
/// Nothing is written until the user confirms, and nothing is ever queued.
struct FillSheet: View {
    let model: FillModel
    /// Opens the Waivers tab, for a claim that clears in time.
    let onWaivers: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    switch model.phase {
                    case .picking:
                        PickStep(model: model) {
                            model.dismiss()
                            onWaivers()
                        }
                    case let .consent(version, lines):
                        ConsentStep(lines: lines) { Task { await model.agree(version: version) } }
                    case .checking, .review, .sending:
                        ConfirmStep(model: model)
                    case let .done(applied):
                        DoneStep(applied: applied)
                    case let .failed(message, details):
                        FailedStep(message: message, details: details) { Task { await model.retry() } }
                    }
                }
                .padding(Spacing.xl + Spacing.xs)
                .animation(Motion.respond, value: model.phase)
                .animation(Motion.respond, value: model.load)
            }
            .background(.bg)
            .safeAreaInset(edge: .bottom) { bar }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if isDone {
                        EmptyView()
                    } else if model.chosen != nil, !isConsent {
                        Button("Back") { model.back() }.disabled(model.phase == .sending)
                    } else {
                        Button("Cancel") { model.dismiss() }
                    }
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(model.phase == .sending)
        .sensoryFeedback(trigger: model.phase) { _, phase in
            if case let .done(applied) = phase { return applied.landed ? Haptic.success : Haptic.failure }
            return nil
        }
        .accessibilityIdentifier("fill-sheet")
    }

    @ViewBuilder private var bar: some View {
        switch model.phase {
        case .checking, .review, .sending:
            SendBar(model: model)
        case .done:
            Button("Done") { model.dismiss() }
                .buttonStyle(ProviderButtonStyle(prominent: true))
                .padding(.horizontal, Spacing.xl + Spacing.xs)
                .padding(.vertical, Spacing.lg)
                .background(.bar)
                .accessibilityIdentifier("fill-done")
        default:
            EmptyView()
        }
    }

    private var isConsent: Bool { if case .consent = model.phase { true } else { false } }
    private var isDone: Bool { if case .done = model.phase { true } else { false } }

    private var title: String {
        if isConsent { return "Before Draft Room changes your team" }
        return model.hole.map { "Fill your \(SlotLabel.of($0.key)) hole" } ?? "Fill the hole"
    }
}

/// The ways to fill the hole, best first, as team/fills ranks them; a claim that clears in time
/// points to Waivers, where claims are placed.
private struct PickStep: View {
    let model: FillModel
    let onClaim: () -> Void

    var body: some View {
        let slot = model.hole.map { SlotLabel.of($0.key) } ?? ""
        VStack(alignment: .leading, spacing: Spacing.xl) {
            if let hole = model.hole {
                Text(HoleText.why(hole, holder: model.hole?.playerId.flatMap { model.store.season?.view.player($0) }))
                    .typeStyle(TypeScale.body).foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            switch model.load {
            case .loading:
                HStack(spacing: Spacing.md) {
                    ProgressView().tint(.muted)
                    Text("Looking for a \(slot) on the wire…").typeStyle(TypeScale.label).foregroundStyle(.muted)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.xl * 2)
            case let .problem(message), let .failed(message):
                FailedStep(message: message, details: []) { Task { await model.reload() } }
            case let .ready(options):
                let fills = options?.fills ?? []
                if fills.isEmpty {
                    Text("No one left to add at \(slot) this week. It scores 0.")
                        .typeStyle(TypeScale.body).foregroundStyle(.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("fill-none")
                } else {
                    VStack(spacing: 0) {
                        ForEach(fills) { fill in
                            FillRow(model: model, fill: fill, lead: fill.id == fills.first?.id)
                            if fill.id != fills.last?.id { Divider().overlay(.rowLine) }
                        }
                    }
                    .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
                    .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(.line))
                    Text("Ranked by what each scores at \(slot) this week, from ESPN's projections.")
                        .typeStyle(TypeScale.label).fontWeight(.regular).foregroundStyle(.dim)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let claim = options?.claims.first {
                    Button(action: onClaim) {
                        Label("\(fills.isEmpty ? "Claim" : "Or claim") \(claim.player.name) on Waivers", systemImage: "arrow.right")
                            .labelStyle(TrailingIconLabelStyle())
                    }
                    .typeStyle(TypeScale.body)
                    .foregroundStyle(.sky)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("fill-claim")
                }
            }
        }
    }
}

/// A way to fill the hole: who, how the roster makes room, and what he scores this week. The best
/// one leads in sky, like the hero's primary.
private struct FillRow: View {
    let model: FillModel
    let fill: HoleFill
    let lead: Bool

    var body: some View {
        Button {
            Task { await model.choose(fill) }
        } label: {
            HStack(alignment: .center, spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    PlayerLine(player: fill.player)
                    Text(model.room(fill)).typeStyle(TypeScale.label).foregroundStyle(.muted)
                }
                Spacer(minLength: Spacing.md)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(SeasonFormat.points(fill.player.points)).typeStyle(TypeScale.title).monospacedDigit().foregroundStyle(lead ? .sky : .text)
                    Text("this week").typeStyle(TypeScale.label).foregroundStyle(.dim)
                }
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.dim)
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.lg)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("fill-\(fill.player.playerId)")
    }
}

/// The fill picked and its steps, in the server's words, numbered in the order they go to ESPN.
private struct ConfirmStep: View {
    let model: FillModel

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            if let fill = model.chosen {
                HStack(alignment: .top, spacing: Spacing.md) {
                    PlayerLine(player: fill.player)
                    Spacer(minLength: Spacing.md)
                    Text(SeasonFormat.points(fill.player.points)).typeStyle(TypeScale.title).monospacedDigit().foregroundStyle(.text)
                }
                .padding(Spacing.xl)
                .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
                .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(.line))
            }
            if case let .review(dry) = model.phase {
                StepList(steps: dry.steps.map { ($0, nil) })
                ForEach(dry.problems, id: \.self) { problem in
                    Label(problem, systemImage: "exclamationmark.triangle.fill")
                        .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.warnInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                ProgressView().tint(.muted).frame(maxWidth: .infinity)
            }
            Text("Each step goes to ESPN in turn. If one doesn't go through, Draft Room stops there and says which went.")
                .typeStyle(TypeScale.label).fontWeight(.regular).foregroundStyle(.dim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// What ESPN shows for each step: done, didn't go, or never sent.
private struct DoneStep: View {
    let applied: FillApplied

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            Label(applied.result, systemImage: applied.landed ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .typeStyle(TypeScale.title)
                .foregroundStyle(applied.landed ? .valueInk : .reachInk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("fill-result")
            StepList(steps: applied.steps.map { ($0.text, $0.landed) })
            ForEach(applied.details, id: \.self) { line in
                Text(line).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// The steps in order. `landed` is nil before the send, and for a step never sent after it.
private struct StepList: View {
    let steps: [(text: String, landed: Bool?)]
    var sent: Bool { steps.contains { $0.landed != nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                    mark(index, step.landed)
                        .frame(width: 22, alignment: .center)
                    Text(step.text).typeStyle(TypeScale.body)
                        .foregroundStyle(sent && step.landed == nil ? .dim : .text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, Spacing.xl)
                .padding(.vertical, Spacing.lg)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(label(index, step))
                if index < steps.count - 1 { Divider().overlay(.rowLine) }
            }
        }
        .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(.line))
        .accessibilityIdentifier("fill-steps")
    }

    @ViewBuilder private func mark(_ index: Int, _ landed: Bool?) -> some View {
        switch landed {
        case true?: Image(systemName: "checkmark").fontWeight(.bold).foregroundStyle(.valueInk)
        case false?: Image(systemName: "xmark").fontWeight(.bold).foregroundStyle(.reachInk)
        case nil where sent: Image(systemName: "minus").foregroundStyle(.dim)
        case nil: Text("\(index + 1)").typeStyle(TypeScale.label).monospacedDigit().foregroundStyle(.muted)
        }
    }

    private func label(_ index: Int, _ step: (text: String, landed: Bool?)) -> String {
        switch step.landed {
        case true?: "\(step.text): done"
        case false?: "\(step.text): didn't go through"
        case nil where sent: "\(step.text): not sent"
        case nil: "Step \(index + 1): \(step.text)"
        }
    }
}

/// The send under the thumb, once the server has checked the steps.
private struct SendBar: View {
    let model: FillModel

    var body: some View {
        let busy = model.phase == .checking || model.phase == .sending
        let ready = if case let .review(dry) = model.phase { dry.problems.isEmpty } else { false }
        VStack(alignment: .leading, spacing: Spacing.md) {
            if case let .review(dry) = model.phase {
                Text(dry.text).typeStyle(TypeScale.body).foregroundStyle(.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("fill-text")
            }
            Button {
                Task { await model.send() }
            } label: {
                HStack(spacing: Spacing.md) {
                    if busy { ProgressView().tint(.sky) }
                    Text(model.phase == .sending ? "Filling…" : "Fill on ESPN")
                }
            }
            .buttonStyle(ProviderButtonStyle(prominent: true))
            .disabled(busy || !ready)
            .accessibilityIdentifier("fill-send")
        }
        .padding(.horizontal, Spacing.xl + Spacing.xs)
        .padding(.vertical, Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
    }
}

/// Title, then the icon after it: "Or claim X on Waivers →".
private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: Spacing.sm) {
            configuration.title
            configuration.icon
        }
    }
}
