import SwiftUI

/// The Trades tab (APE-405), after the web's TradePanel: the user's trades pending on ESPN, each
/// graded, with Accept and Decline on offers to the user and Withdraw on their own; then a builder
/// that grades a trade as players are picked and offers it on ESPN. The AI's trade ideas lead, and
/// the builder offers the AI's write-up of its trade (APE-392).
struct TradesView: View {
    let model: TradesModel
    let ai: AiModel
    /// Opens ESPN's sign-in again, when the league's ESPN login has lapsed.
    let onReconnect: () -> Void
    /// Starting slots nobody can play this week, and the fill sheet for one (APE-418).
    var holes: [Hole] = []
    var onFill: (Hole) -> Void = { _ in }

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                VStack(spacing: Spacing.xl) {
                    if !holes.isEmpty { HoleBanner(holes: holes, onFill: onFill) }
                    if let notice = model.notice { TradeNotice(notice: notice) }
                    switch model.load {
                    case .loading:
                        VStack(spacing: Spacing.lg) {
                            ProgressView().tint(.muted)
                            Text("Reading your trades on ESPN…").typeStyle(TypeScale.label).foregroundStyle(.muted)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.xl * 3)
                    case let .problem(message, reconnect):
                        ProblemNote(message: message, reconnect: reconnect, onReconnect: onReconnect) { Task { await model.refresh() } }
                    case let .failed(message):
                        FailedView(message: message) { Task { await model.refresh() } }
                    case let .ready(trades):
                        if trades.deadline.passed, let at = trades.deadline.at {
                            Label("The trade deadline passed \(at.formatted(.dateTime.weekday(.abbreviated).month().day().hour().minute())). Trades here are what-ifs now: ESPN won't process new ones this season.", systemImage: "clock")
                                .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.warnInk)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        TradeIdeasCard(ai: ai, trades: model)
                            .jumpSection("Trade ideas")
                        PendingCard(model: model, trades: trades)
                            .jumpSection("Pending on ESPN")
                        BuilderCard(model: model, ai: ai).id("builder")
                            .jumpSection("Check a trade")
                    }
                }
                .padding(.horizontal, Spacing.xl + Spacing.xs)
                .padding(.vertical, Spacing.xl)
                .animation(Motion.respond, value: model.notice)
                .animation(Motion.respond, value: model.grade)
            }
            .sectionJump()
            .hidesStandingOnScroll()
            .refreshable {
                await model.store.refresh(force: true)
                await model.refresh()
                await ai.refresh()
            }
            // An idea or a counter opened in the builder: show it there.
            .onChange(of: model.loads) { withAnimation(Motion.settle) { scroll.scrollTo("builder", anchor: .top) } }
        }
        .background(.bg)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("section-trade")
        .task {
            await model.start()
            await ai.start()
        }
        .sensoryFeedback(trigger: model.notice) { _, notice in
            notice.map { $0.landed ? Haptic.success : Haptic.failure }
        }
        .sheet(isPresented: confirming) { TradeSheet(model: model) }
    }

    /// The confirm sheet is up from the tap until ESPN has answered.
    private var confirming: Binding<Bool> {
        Binding { model.action != nil } set: { shown in
            if !shown { model.dismiss() }
        }
    }
}

/// What the last write did, in the server's words.
private struct TradeNotice: View {
    let notice: TradesModel.Notice

    var body: some View {
        Label(notice.text, systemImage: notice.landed ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            .typeStyle(TypeScale.body)
            .foregroundStyle(notice.landed ? .valueInk : .warnInk)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("trades-notice")
    }
}

// MARK: - Pending on ESPN

private struct PendingCard: View {
    let model: TradesModel
    let trades: TradesResponse

    var body: some View {
        SeasonCard(title: "Pending on ESPN", note: "Answer here or on ESPN") {
            VStack(alignment: .leading, spacing: 0) {
                if let at = trades.deadline.at, !trades.deadline.passed {
                    Text("Trade deadline \(Text(at.formatted(.dateTime.weekday(.abbreviated).month().day().hour().minute())).fontWeight(.semibold))")
                        .typeStyle(TypeScale.label).foregroundStyle(.muted)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.bottom, Spacing.lg)
                }
                if trades.offers.isEmpty {
                    Text("No trade offers waiting on ESPN. Build one below to see how it would land for both teams.")
                        .typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, Spacing.xl)
                        .padding(.bottom, Spacing.xl)
                } else {
                    ForEach(trades.offers) { offer in
                        Divider().overlay(.rowLine)
                        OfferRow(model: model, offer: offer)
                    }
                }
            }
        }
    }
}

/// An offer (the web's Offer): which way, with whom, until when, both sides, the grade, and the answers.
private struct OfferRow: View {
    let model: TradesModel
    let offer: TradeOffer

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                Text(badge).typeStyle(TypeScale.label).fontWeight(.semibold)
                    .foregroundStyle(offer.kind == "theirs" ? Color.sky : offer.kind == "accepted" ? Color.valueInk : Color.muted)
                Text(offer.partner.name).typeStyle(TypeScale.body).fontWeight(.semibold).foregroundStyle(.text)
                Spacer(minLength: Spacing.md)
                if let when = offer.when {
                    Text("\(when.label) \(when.at.formatted(.dateTime.weekday(.abbreviated).hour().minute()))")
                        .typeStyle(TypeScale.label).foregroundStyle(.dim)
                }
            }
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: Spacing.md, verticalSpacing: Spacing.xs) {
                GridRow {
                    Text("You get").typeStyle(TypeScale.label).foregroundStyle(.muted)
                    Text(model.names(offer.gets)).typeStyle(TypeScale.body).foregroundStyle(.text)
                }
                GridRow {
                    Text("You send").typeStyle(TypeScale.label).foregroundStyle(.muted)
                    Text(model.names(offer.gives)).typeStyle(TypeScale.body).foregroundStyle(.text)
                }
            }
            if let grade = offer.grade {
                GradeLine(grade: grade, partner: offer.partner.name)
            } else {
                Text("Can't grade this one: a player in it is no longer on those rosters.")
                    .typeStyle(TypeScale.label).fontWeight(.regular).foregroundStyle(.dim)
            }
            if offer.kind == "accepted" {
                Text("Already agreed; it goes through unless the league stops it.")
                    .typeStyle(TypeScale.label).fontWeight(.regular).foregroundStyle(.dim)
            }
            if !offer.actions.isEmpty {
                HStack(spacing: Spacing.md) {
                    ForEach(offer.actions, id: \.self) { action in
                        Button(title(action)) {
                            if let kind = TradeRequest.Kind(rawValue: action) { Task { await model.respond(offer, kind) } }
                        }
                        .buttonStyle(ProviderButtonStyle(prominent: action == "accept"))
                        .accessibilityIdentifier("\(action)-\(offer.id)")
                    }
                }
            }
        }
        .padding(Spacing.xl)
        .accessibilityElement(children: .contain)
    }

    private var badge: String {
        switch offer.kind {
        case "accepted": "Accepted"
        case "mine": "Your offer"
        default: "Offer"
        }
    }

    private func title(_ action: String) -> String {
        switch action {
        case "accept": "Accept"
        case "decline": "Decline"
        default: "Withdraw"
        }
    }
}

/// A grade in a line or two (the web's compact TradeGain): what it does a week for the user, in words,
/// then what it does for them and over the season.
struct GradeLine: View {
    let grade: TradeGrade
    let partner: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                if grade.level != "rest" {
                    Text("\(Text(SeasonFormat.signed(grade.perWeek)).monospacedDigit())\(Text(" a week").font(.footnote))")
                        .typeStyle(TypeScale.title)
                        .foregroundStyle(tone)
                }
                Text(grade.headline).typeStyle(TypeScale.body).fontWeight(.semibold).foregroundStyle(grade.level == "rest" ? Color.text : tone)
            }
            Text("\(partner) \(SeasonFormat.signed(grade.theirs)) a week · you \(SeasonFormat.signed(grade.delta)) over the \(grade.weeks) weeks left")
                .typeStyle(TypeScale.label).foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("trade-grade")
    }

    private var tone: Color { grade.perWeek >= 0 ? .valueInk : .reachInk }
}

// MARK: - The builder

/// The web's "Check a trade": pick a team, who you'd send and who you'd get; the server grades it, and
/// it can go to ESPN as an offer.
private struct BuilderCard: View {
    let model: TradesModel
    let ai: AiModel

    var body: some View {
        SeasonCard(title: "Check a trade") {
            if !(model.gives.isEmpty && model.gets.isEmpty) {
                Button("Clear") { model.clear() }.typeStyle(TypeScale.label).foregroundStyle(.sky)
            }
        } content: {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                if let partner = model.partner {
                    Menu {
                        ForEach(model.others) { team in
                            Button(team.name) { Task { await model.choose(partner: team.id) } }
                        }
                    } label: {
                        HStack(spacing: Spacing.sm) {
                            Text("Trade with").foregroundStyle(.muted)
                            Text(partner.name).fontWeight(.semibold).foregroundStyle(.text)
                            Image(systemName: "chevron.up.chevron.down").font(.footnote).foregroundStyle(.dim)
                        }
                        .typeStyle(TypeScale.body)
                        .frame(minHeight: 44)
                    }
                    .accessibilityIdentifier("trade-partner")

                    verdict(partner: partner.name)

                    if model.grade != nil, !model.deadlinePassed {
                        Button("Offer this on ESPN") { Task { await model.propose() } }
                            .buttonStyle(ProviderButtonStyle(prominent: true))
                            .accessibilityIdentifier("trade-propose")
                    }

                    TradeWriteupSection(ai: ai, trades: model)

                    Picker("Which roster", selection: Binding(get: { model.side }, set: { model.side = $0 })) {
                        Text(model.gives.isEmpty ? "You send" : "You send · \(model.gives.count)").tag(TradesModel.Side.send)
                        Text(model.gets.isEmpty ? "You get" : "You get · \(model.gets.count)").tag(TradesModel.Side.get)
                    }
                    .pickerStyle(.segmented)

                    RosterPicker(model: model, roster: model.side == .send ? model.mine?.roster ?? [] : partner.roster)
                } else {
                    Text("There's no one in this league to trade with.").typeStyle(TypeScale.body).foregroundStyle(.muted)
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.xl)
        }
    }

    @ViewBuilder private func verdict(partner: String) -> some View {
        if let grade = model.grade {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                GradeLine(grade: grade, partner: partner)
                let lines = grade.slots.map { "\(SlotLabel.of($0.key)) \(SeasonFormat.signed($0.change))" } + grade.dropLines
                if !lines.isEmpty {
                    Text(lines.joined(separator: " · ")).typeStyle(TypeScale.label).foregroundStyle(.dim)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.bg.opacity(0.35), in: RoundedRectangle(cornerRadius: Radius.lg))
            .opacity(model.grading ? 0.6 : 1)
        } else if model.grading {
            ProgressView().tint(.muted).frame(maxWidth: .infinity)
        } else {
            Text("Pick who you'd send and who you'd get. The verdict compares both starting lineups for the rest of the season.")
                .typeStyle(TypeScale.label).fontWeight(.regular).foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// One side's roster, picked players first, then by rest-of-season points, each a toggle.
private struct RosterPicker: View {
    let model: TradesModel
    let roster: [ViewPlayer]

    var body: some View {
        let sorted = roster.sorted { a, b in
            let (pa, pb) = (model.isPicked(a.playerId), model.isPicked(b.playerId))
            return pa != pb ? pa : (a.ros ?? 0) > (b.ros ?? 0)
        }
        VStack(spacing: 0) {
            ForEach(sorted) { player in
                let on = model.isPicked(player.playerId)
                Button {
                    Task { await model.toggle(player.playerId) }
                } label: {
                    HStack(spacing: Spacing.md) {
                        Image(systemName: on ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(on ? Color.sky : Color.dim)
                        PlayerLine(player: player)
                        Spacer(minLength: Spacing.md)
                        Text("\(Int((player.ros ?? 0).rounded())) pts").typeStyle(TypeScale.label).monospacedDigit().foregroundStyle(.muted)
                    }
                    .padding(.vertical, Spacing.md)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
                .accessibilityIdentifier("pick-player-\(player.playerId)")
                if player.id != sorted.last?.id { Divider().overlay(.rowLine) }
            }
        }
    }
}
