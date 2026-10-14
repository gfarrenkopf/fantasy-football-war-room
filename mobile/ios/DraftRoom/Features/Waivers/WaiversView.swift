import SwiftUI

/// The Waivers tab (APE-388), after the web's WaiverPanel: next week's holes with who'd fill them,
/// then the pickups ranked by what they add to the user's best lineup for the rest of the season,
/// each with who to drop. Add on a free agent opens the confirm; nothing is written before it.
struct WaiversView: View {
    let model: WaiversModel
    /// Opens ESPN's sign-in again, when the league's ESPN login has lapsed.
    let onReconnect: () -> Void

    var body: some View {
        Group {
            switch model.load {
            case .loading:
                VStack(spacing: Spacing.lg) {
                    ProgressView().tint(.muted)
                    Text("Reading ESPN's waiver wire…").typeStyle(TypeScale.label).foregroundStyle(.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .problem(message, reconnect):
                ProblemNote(message: message, reconnect: reconnect, onReconnect: onReconnect) { Task { await model.refresh(force: true) } }
                    .padding(Spacing.xl * 2)
            case let .failed(message):
                FailedView(message: message) { Task { await model.refresh(force: true) } }
            case let .ready(wire):
                ScrollView {
                    VStack(spacing: Spacing.xl) {
                        if let notice = model.notice { NoticeLine(notice: notice) }
                        ForEach(wire.ahead) { ahead in AheadCard(model: model, ahead: ahead) }
                        PickupsCard(model: model, wire: wire)
                        Text("Ranked by what each adds to your best lineup for the rest of the season, from ESPN's projections.")
                            .typeStyle(TypeScale.label).fontWeight(.regular).foregroundStyle(.dim)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, Spacing.xl + Spacing.xs)
                    .padding(.vertical, Spacing.xl)
                    .animation(Motion.respond, value: model.notice)
                }
                .refreshable { await model.refresh(force: true) }
            }
        }
        .background(.bg)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("section-waivers")
        .task { await model.start() }
        .sensoryFeedback(trigger: model.notice) { _, notice in
            notice.map { $0.landed ? Haptic.success : Haptic.failure }
        }
        .sheet(isPresented: adding) { AcquireSheet(model: model) }
    }

    /// The add sheet is up from Add until ESPN has answered.
    private var adding: Binding<Bool> {
        Binding { model.acting != nil } set: { shown in
            if !shown { model.cancel() }
        }
    }
}

/// What the last add did, in the server's words.
private struct NoticeLine: View {
    let notice: WaiversModel.Notice

    var body: some View {
        Label(notice.text, systemImage: notice.landed ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            .typeStyle(TypeScale.body)
            .foregroundStyle(notice.landed ? Color.valueInk : Color.reachInk)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .transition(.opacity.combined(with: .move(edge: .top)))
            .accessibilityIdentifier("waivers-notice")
    }
}

// MARK: - The wire

private struct PickupsCard: View {
    let model: WaiversModel
    let wire: WaiversResponse

    var body: some View {
        SeasonCard(title: "Pickups worth a claim", note: wire.note) {
            VStack(spacing: 0) {
                if wire.pickups.isEmpty {
                    Text("None of the \(wire.considered) most-rostered players on the wire would improve your lineup. Check back after waivers clear.")
                        .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.bottom, Spacing.xl)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(wire.pickups) { pickup in
                    Divider().overlay(.rowLine)
                    WireRow(
                        model: model, player: pickup.player, drop: pickup.drop,
                        gain: SeasonFormat.signed(pickup.perWeek), unit: "a week",
                        detail: "\(SeasonFormat.signed(pickup.delta)) rest of season",
                        waivers: waiversLine(pickup.player)
                    ) { Task { await model.add(pickup) } }
                }
            }
        }
    }

    private func waiversLine(_ player: ViewPlayer) -> String {
        guard let clears = player.waiverClears else { return "On waivers" }
        return "On waivers · clears \(clears.formatted(.dateTime.weekday(.abbreviated).hour().minute()))"
    }
}

/// Next week's hole: the slot, why, and the players who'd fill it that week.
private struct AheadCard: View {
    let model: WaiversModel
    let ahead: Ahead

    var body: some View {
        let hole = ahead.hole
        SeasonCard(title: "Week \(hole.week): hole at \(SlotLabel.of(hole.key))", tint: Color.warn.opacity(0.45)) {
            VStack(alignment: .leading, spacing: 0) {
                Label(why, systemImage: "exclamationmark.triangle.fill")
                    .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.warnInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, Spacing.xl)
                    .padding(.bottom, Spacing.lg)
                if ahead.fills.isEmpty {
                    Text("Nobody on the wire projects for week \(hole.week) at \(SlotLabel.of(hole.key)) yet. Check back after waivers clear.")
                        .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.bottom, Spacing.xl)
                }
                ForEach(ahead.fills) { fill in
                    Divider().overlay(.rowLine)
                    WireRow(
                        model: model, player: fill.player, drop: fill.drop,
                        gain: SeasonFormat.points(fill.player.weekly?[String(hole.week)] ?? 0), unit: "in week \(hole.week)",
                        detail: nil,
                        waivers: "On waivers: claim now to have him in time"
                    ) { Task { await model.add(fill) } }
                }
            }
        }
    }

    /// The web's aheadWhy(): "Kincaid projects 0 that week, with nobody behind him."
    private var why: String {
        let hole = ahead.hole
        guard let who = hole.playerId.flatMap(model.name) else { return "Nobody on your team can play \(SlotLabel.of(hole.key))." }
        return hole.reason == "out" ? "\(who) is out, with nobody behind him." : "\(who) projects 0 that week, with nobody behind him."
    }
}

/// A player on the wire: who he is and what he adds, then who goes and the Add. A player still on
/// waivers shows when he clears; claiming him is 19.4's.
private struct WireRow: View {
    let model: WaiversModel
    let player: ViewPlayer
    let drop: Int?
    let gain: String
    let unit: String
    let detail: String?
    let waivers: String
    let onAdd: () -> Void

    var body: some View {
        let free = player.status != "WAIVERS"
        let dropName = drop.flatMap(model.name) ?? (drop == nil ? nil : "your weakest player")
        let facts = [detail, dropName.map { "Drop \($0)" }].compactMap(\.self)
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .top, spacing: Spacing.md) {
                PlayerLine(player: player)
                Spacer(minLength: Spacing.md)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(gain).typeStyle(TypeScale.title).monospacedDigit().foregroundStyle(.valueInk)
                    Text(unit).typeStyle(TypeScale.label).foregroundStyle(.dim)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(([player.name, SeasonFormat.injuryTag(player.injuryStatus), "\(gain) \(unit)"] as [String?]).compactMap(\.self).joined(separator: ", "))
            HStack(alignment: .center, spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(facts, id: \.self) { Text($0).typeStyle(TypeScale.label).foregroundStyle(.muted) }
                    if !free { Text(waivers).typeStyle(TypeScale.label).foregroundStyle(.warnInk) }
                }
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .combine)
                Spacer(minLength: Spacing.md)
                if free {
                    Button(action: onAdd) {
                        Label("Add", systemImage: "plus").labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(AddButtonStyle())
                    .accessibilityLabel("Add \(player.name)")
                    .accessibilityIdentifier("add-\(player.playerId)")
                }
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.lg)
    }
}

/// The row's Add: small, outlined in sky like the app's primary, sized for a thumb.
private struct AddButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .typeStyle(TypeScale.label)
            .foregroundStyle(.sky)
            .padding(.horizontal, Spacing.lg)
            .frame(minHeight: 36)
            .background(configuration.isPressed ? Color.sky.opacity(0.16) : Color.sky.opacity(0.08), in: Capsule())
            .overlay(Capsule().stroke(.skyLine))
            .contentShape(Capsule())
            .animation(Motion.press, value: configuration.isPressed)
    }
}

#Preview {
    let api = APIClient(baseURL: URL(string: "http://localhost:3000")!)
    let store = SeasonStore(api: api, leagueId: "lg-1")
    WaiversView(model: WaiversModel(api: api, store: store), onReconnect: {})
}
