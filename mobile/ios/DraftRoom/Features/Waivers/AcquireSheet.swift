import SwiftUI

/// Adding a free agent on ESPN (APE-388), after the web's AcquireReview: the write consent the first
/// time, then who goes to make room (the suggested drop first) and the server's "Add X and drop Y."
/// Nothing is written until the user taps Add on ESPN, and nothing is ever queued.
struct AcquireSheet: View {
    let model: WaiversModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    switch model.phase {
                    case let .consent(version, lines):
                        ConsentStep(lines: lines) { Task { await model.agree(version: version) } }
                    case let .failed(message, details):
                        FailedStep(message: message, details: details) { Task { await model.retry() } }
                    case .review, .checking, .sending:
                        if let pickup = model.acting { DropStep(model: model, pickup: pickup) }
                    case .idle:
                        EmptyView()
                    }
                }
                .padding(Spacing.xl + Spacing.xs)
                .animation(Motion.respond, value: model.phase)
            }
            .background(.bg)
            .safeAreaInset(edge: .bottom) {
                if model.phase != .idle, !isConsent, !isFailed { ConfirmBar(model: model) }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { model.cancel() }.disabled(model.phase == .sending)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(model.phase == .sending)
        .accessibilityIdentifier("acquire-sheet")
    }

    private var isConsent: Bool { if case .consent = model.phase { true } else { false } }
    private var isFailed: Bool { if case .failed = model.phase { true } else { false } }

    private var title: String {
        if isConsent { return "Before Draft Room changes your team" }
        return model.acting.map { "Add \(SeasonFormat.shortName($0.player))" } ?? "Add"
    }
}

/// Who's coming, then who goes: the roster's drop candidates, weakest first, one of them ticked.
private struct DropStep: View {
    let model: WaiversModel
    let pickup: Pickup

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            HStack(alignment: .top, spacing: Spacing.md) {
                PlayerLine(player: pickup.player)
                Spacer(minLength: Spacing.md)
                if pickup.perWeek != 0 {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(SeasonFormat.signed(pickup.perWeek)).typeStyle(TypeScale.title).monospacedDigit().foregroundStyle(.valueInk)
                        Text("a week").typeStyle(TypeScale.label).foregroundStyle(.dim)
                    }
                }
            }
            .padding(Spacing.xl)
            .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
            .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(.line))
            .accessibilityElement(children: .combine)

            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(model.hasRoom ? "Drop someone? You have room." : "Your roster is full. Who goes?")
                    .typeStyle(TypeScale.title).foregroundStyle(.text)
                    .accessibilityAddTraits(.isHeader)
                VStack(spacing: 0) {
                    if model.hasRoom {
                        DropOption(title: "No one", detail: "Keep everyone", chosen: model.drop == nil, suggested: pickup.drop == nil) {
                            Task { await model.choose(drop: nil) }
                        }
                        .accessibilityIdentifier("drop-none")
                    }
                    ForEach(model.dropChoices) { player in
                        if model.hasRoom || player.playerId != model.dropChoices.first?.playerId { Divider().overlay(.rowLine) }
                        DropOption(title: player.name, detail: facts(player), chosen: model.drop == player.playerId, suggested: player.playerId == pickup.drop) {
                            Task { await model.choose(drop: player.playerId) }
                        }
                        .accessibilityIdentifier("drop-\(player.playerId)")
                    }
                }
                .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
                .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(.line))
                .disabled(model.phase == .sending)
                if model.drop != nil {
                    Text("A dropped player goes on waivers, so getting him back takes a claim.")
                        .typeStyle(TypeScale.label).fontWeight(.regular).foregroundStyle(.dim)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    /// "RB · Bench · 112.4 rest of season", after the web's option text.
    private func facts(_ player: ViewPlayer) -> String {
        let season = player.ros.map { "\(SeasonFormat.points($0)) rest of season" } ?? "\(SeasonFormat.points(player.points)) proj"
        let place = switch player.slot {
        case "BN": "Bench"
        case "IR": "IR"
        default: "Starting"
        }
        return [SlotLabel.of(player.pos), place, season].joined(separator: " · ")
    }
}

private struct DropOption: View {
    let title: String
    let detail: String
    let chosen: Bool
    let suggested: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: Spacing.sm) {
                        Text(title).typeStyle(TypeScale.body).foregroundStyle(.text)
                        if suggested { Text("Suggested").typeStyle(TypeScale.micro).foregroundStyle(.valueInk) }
                    }
                    Text(detail).typeStyle(TypeScale.label).monospacedDigit().foregroundStyle(.muted)
                }
                Spacer(minLength: Spacing.md)
                Image(systemName: chosen ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(chosen ? Color.sky : Color.dim)
                    .contentTransition(.symbolEffect(.replace))
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.lg)
            .background(chosen ? Color.sky.opacity(0.06) : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(chosen ? [.isButton, .isSelected] : .isButton)
    }
}

/// The confirm under the thumb: the server's words for the add, any reason it can't go, and the send.
private struct ConfirmBar: View {
    let model: WaiversModel

    var body: some View {
        let busy = model.phase == .checking || model.phase == .sending
        VStack(alignment: .leading, spacing: Spacing.md) {
            if let dry = model.dry {
                Text(dry.text).typeStyle(TypeScale.body).foregroundStyle(.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentTransition(.opacity)
                    .accessibilityIdentifier("acquire-text")
                ForEach(dry.problems, id: \.self) { problem in
                    Label(problem, systemImage: "exclamationmark.triangle.fill")
                        .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.warnInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Button {
                Task { await model.send() }
            } label: {
                HStack(spacing: Spacing.md) {
                    if busy { ProgressView().tint(.sky) }
                    Text(model.phase == .sending ? "Adding…" : "Add on ESPN")
                }
            }
            .buttonStyle(ProviderButtonStyle(prominent: true))
            .disabled(busy || model.dry?.problems.isEmpty != true)
            .accessibilityIdentifier("acquire-send")
        }
        .padding(.horizontal, Spacing.xl + Spacing.xs)
        .padding(.vertical, Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.bar)
    }
}
