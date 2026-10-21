import SwiftUI

/// The Waivers tab, after the web's WaiverPanel: the user's pending claims (APE-389), next week's
/// holes with who'd fill them, then the pickups ranked by what they add to the user's best lineup for
/// the rest of the season, each with who to drop (APE-388), then every other available player to
/// search (APE-411). Add on a free agent, or Claim on a player
/// on waivers, opens the confirm; nothing is written before it.
struct WaiversView: View {
    let model: WaiversModel
    /// Opens ESPN's sign-in again, when the league's ESPN login has lapsed.
    let onReconnect: () -> Void
    /// Opens the Trades tab's builder on a trade for a rostered player the search found (APE-413).
    var onTrade: (Int, Int) -> Void = { _, _ in }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                if let notice = model.notice { NoticeLine(notice: notice) }
                if !model.claims.isEmpty { ClaimsCard(model: model).jumpSection("Your claims") }
                switch model.load {
                case .loading:
                    VStack(spacing: Spacing.lg) {
                        ProgressView().tint(.muted)
                        Text("Reading ESPN's waiver wire…").typeStyle(TypeScale.label).foregroundStyle(.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.xl * 3)
                case let .problem(message, reconnect):
                    ProblemNote(message: message, reconnect: reconnect, onReconnect: onReconnect) { Task { await model.refresh(force: true) } }
                case let .failed(message):
                    FailedView(message: message) { Task { await model.refresh(force: true) } }
                case let .ready(wire):
                    ForEach(wire.ahead) { ahead in AheadCard(model: model, ahead: ahead).jumpSection(AheadCard.title(ahead.hole)) }
                    PickupsCard(model: model, wire: wire)
                        .jumpSection("Pickups worth a claim")
                    Text("Ranked by what each adds to your best lineup for the rest of the season, from ESPN's projections. Find anyone else under Free agents.")
                        .typeStyle(TypeScale.label).fontWeight(.regular).foregroundStyle(.dim)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                FreeAgentsCard(model: model, onTrade: onTrade)
                    .jumpSection("Free agents")
            }
            .padding(.horizontal, Spacing.xl + Spacing.xs)
            .padding(.vertical, Spacing.xl)
            .animation(Motion.respond, value: model.notice)
            .animation(Motion.respond, value: model.claims)
        }
        .sectionJump()
        .refreshable {
            await model.store.refresh(force: true)
            await model.refresh(force: true)
            await model.freeAgents.reload()
        }
        .background(.bg)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("section-waivers")
        .task { await model.start() }
        .sensoryFeedback(trigger: model.notice) { _, notice in
            notice.map { $0.landed ? Haptic.success : Haptic.failure }
        }
        .sheet(isPresented: confirming) { AcquireSheet(model: model) }
    }

    /// The confirm sheet is up from the tap until ESPN has answered.
    private var confirming: Binding<Bool> {
        Binding { model.action != nil } set: { shown in
            if !shown { model.dismiss() }
        }
    }
}

/// The user's pending claims (the web's ClaimList): who, who goes, when ESPN processes it, and a
/// cancel. Claims can't be reordered here, as on the web.
private struct ClaimsCard: View {
    let model: WaiversModel

    var body: some View {
        let claims = model.claims
        SeasonCard(title: "Your claims", note: claims.count == 1 ? "1 pending" : "\(claims.count) pending") {
            VStack(alignment: .leading, spacing: 0) {
                if let soon = model.processingSoon() {
                    Label("Your claims process \(soon.formatted(.relative(presentation: .named))).", systemImage: "clock.fill")
                        .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.warnInk)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.bottom, Spacing.lg)
                        .accessibilityIdentifier("claims-soon")
                }
                ForEach(claims) { claim in
                    Divider().overlay(.rowLine)
                    ClaimRow(model: model, claim: claim)
                }
            }
        }
    }
}

/// A pending claim. Swiping it left opens the same cancel confirm as its Cancel; the row always
/// springs back, since nothing is cancelled until the sheet's confirm.
private struct ClaimRow: View {
    let model: WaiversModel
    let claim: PendingClaim
    /// How far the row has been dragged left, as a negative offset.
    @State private var offset: CGFloat = 0

    /// Past this, letting go opens the cancel.
    private static let threshold: CGFloat = 96

    private var armed: Bool { -offset >= Self.threshold }

    var body: some View {
        row
            .background(.panel)
            .offset(x: offset)
            .background(alignment: .trailing) {
                Label("Cancel", systemImage: "xmark")
                    .labelStyle(.titleAndIcon)
                    .typeStyle(TypeScale.label)
                    .foregroundStyle(.text)
                    .padding(.horizontal, Spacing.xl)
                    .frame(maxHeight: .infinity)
                    .frame(width: max(-offset, 0), alignment: .trailing)
                    .background(armed ? Color.reach : Color.reach.opacity(0.55))
                    .clipped()
                    .accessibilityHidden(true)
            }
            .clipped()
            .contentShape(Rectangle())
            .simultaneousGesture(
                DragGesture(minimumDistance: 20)
                    .onChanged { drag in
                        // Leave vertical drags to the scroll view.
                        guard abs(drag.translation.width) > abs(drag.translation.height) else { return }
                        offset = min(0, drag.translation.width)
                    }
                    .onEnded { drag in
                        let go = -min(drag.translation.width, drag.predictedEndTranslation.width) >= Self.threshold && offset < 0
                        withAnimation(Motion.respond) { offset = 0 }
                        if go { Task { await model.cancel(claim) } }
                    })
            .sensoryFeedback(.impact(weight: .light), trigger: armed) { _, now in now }
            .accessibilityAction(named: "Cancel claim") { Task { await model.cancel(claim) } }
    }

    @ViewBuilder private var row: some View {
        let facts = [claim.drop.map { "Drop \(model.name($0) ?? "a player")" }, claim.processesAt.map { "Processes \($0.formatted(.dateTime.weekday(.abbreviated).hour().minute()))" }].compactMap(\.self)
        HStack(alignment: .center, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.xs) {
                    Text(claim.add.name).typeStyle(TypeScale.body).foregroundStyle(.text)
                    if let pos = claim.add.pos { Text(SlotLabel.of(pos)).typeStyle(TypeScale.label).foregroundStyle(.muted) }
                }
                ForEach(facts, id: \.self) { Text($0).typeStyle(TypeScale.label).foregroundStyle(.muted) }
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: Spacing.md)
            Button("Cancel") { Task { await model.cancel(claim) } }
                .typeStyle(TypeScale.label)
                .foregroundStyle(.reachInk)
                .frame(minHeight: 44)
                .accessibilityLabel("Cancel claim for \(claim.add.name)")
                .accessibilityIdentifier("cancel-claim-\(claim.id)")
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
    }
}

/// What the last change did, in the server's words.
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
                if let reason = wire.claims.reason, !wire.claims.allowed, wire.pickups.contains(where: { $0.player.status == "WAIVERS" }) {
                    Label(reason, systemImage: "info.circle")
                        .typeStyle(TypeScale.label).fontWeight(.regular).foregroundStyle(.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.bottom, Spacing.lg)
                        .accessibilityIdentifier("claims-faab")
                }
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
                        waivers: WireRow.waiversLine(pickup.player)
                    ) { Task { await model.acquire(pickup) } }
                }
            }
        }
    }
}

/// Next week's hole: the slot, why, and the players who'd fill it that week.
private struct AheadCard: View {
    let model: WaiversModel
    let ahead: Ahead

    static func title(_ hole: Ahead.Hole) -> String { "Week \(hole.week): hole at \(SlotLabel.of(hole.key))" }

    var body: some View {
        let hole = ahead.hole
        SeasonCard(title: Self.title(hole), tint: Color.warn.opacity(0.45)) {
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
                    ) { Task { await model.acquire(fill) } }
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

/// A player on the wire: who he is and what he adds, then who goes and the Add, or the Claim for a
/// player still on waivers, with when he clears. A league that bids FAAB claims on ESPN for now. The
/// pickups, next week's fills and the free-agent search all list players this way.
struct WireRow: View {
    let model: WaiversModel
    let player: ViewPlayer
    let drop: Int?
    let gain: String
    let unit: String
    let detail: String?
    let waivers: String
    /// He'd add nothing to the lineup: the gain steps back to muted.
    var flat = false
    let onAct: () -> Void

    /// "On waivers · clears Wed 3:00 AM", for a player still on waivers.
    static func waiversLine(_ player: ViewPlayer) -> String {
        guard let clears = player.waiverClears else { return "On waivers" }
        return "On waivers · clears \(clears.formatted(.dateTime.weekday(.abbreviated).hour().minute()))"
    }

    var body: some View {
        let free = player.status != "WAIVERS"
        let dropName = drop.flatMap(model.name) ?? (drop == nil ? nil : "your weakest player")
        let facts = [detail, dropName.map { "Drop \($0)" }].compactMap(\.self)
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .top, spacing: Spacing.md) {
                PlayerLine(player: player)
                Spacer(minLength: Spacing.md)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(gain).typeStyle(TypeScale.title).monospacedDigit().foregroundStyle(flat ? Color.muted : Color.valueInk)
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
                if free || model.canClaim {
                    Button(action: onAct) {
                        Label(free ? "Add" : "Claim", systemImage: free ? "plus" : "clock").labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(AddButtonStyle())
                    .accessibilityLabel("\(free ? "Add" : "Claim") \(player.name)")
                    .accessibilityIdentifier("\(free ? "add" : "claim")-\(player.playerId)")
                }
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.lg)
    }
}

/// The row's Add or Claim: small, outlined in sky like the app's primary, sized for a thumb.
struct AddButtonStyle: ButtonStyle {
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
