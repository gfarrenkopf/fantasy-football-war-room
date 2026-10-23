import SwiftUI

/// One week's recap (APE-384), pushed from the archive: the web's RecapArchive week in its reading
/// order as one column. The user's result and its story lead with the card to share, then how the
/// week swung, the standings, the top scorers, the game changer, the most valuable benchwarmers and
/// the false starters. Every word and number comes from the recap route.
///
/// The first time a week is opened on this phone it gets a moment: the week's number rises behind
/// the hero, the result stamps down with a tap, the score counts up and the story and panels follow.
/// With Reduce Motion or VoiceOver on it fades in, still. Any later visit opens on the finished page.
struct RecapReaderView: View {
    let store: RecapsStore
    let key: RecapKey
    var moments = MomentStore()

    /// Whether this is the week's first opening on this phone: claimed once, as the recap first shows.
    @State private var firstOpen: Bool?

    var body: some View {
        Group {
            switch store.weeks[key] {
            case let .ready(recap):
                if let firstOpen {
                    RecapPage(recap: recap, link: store.link(for: key), offline: store.offline, firstOpen: firstOpen)
                } else {
                    Color.clear.onAppear { firstOpen = moments.claimRecap(leagueId: store.leagueId, key) }
                }
            case let .failed(message):
                FailedView(message: message) { Task { await store.open(key) } }
            case .loading, nil:
                ReaderSkeleton()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.bg)
        .navigationTitle("Week \(key.week)")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: key) { await store.open(key) }
        .accessibilityIdentifier("recap-reader")
    }
}

/// The recap itself. A first opening starts dark and plays its beats once; a refresh mid-moment
/// doesn't restart it.
private struct RecapPage: View {
    let recap: RecapResponse
    let link: URL
    let offline: Bool
    let firstOpen: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var played = false
    /// The moment's beats: 0 dark, 1 the numeral, 2 the stamp, 3 the score and story, 4 the panels.
    @State private var beat: Int

    static let finalBeat = 4

    init(recap: RecapResponse, link: URL, offline: Bool, firstOpen: Bool) {
        self.recap = recap
        self.link = link
        self.offline = offline
        self.firstOpen = firstOpen
        _beat = State(initialValue: firstOpen ? 0 : Self.finalBeat)
    }

    private var still: Bool { reduceMotion || voiceOver }
    private var league: LeagueRecap { recap.recap }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                if offline {
                    Label("Offline · showing the recap kept on this phone", systemImage: "wifi.slash")
                        .typeStyle(TypeScale.label).foregroundStyle(.warnInk)
                }
                RecapHero(recap: recap, link: link, beat: beat)
                Group {
                    if let mine = league.mine, let swing = recap.swing {
                        WeekSwingView(swing: swing, result: mine.result)
                            .padding(.horizontal, Spacing.xl).padding(.bottom, Spacing.xl)
                            .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
                            .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(.line))
                    }
                    StandingsCard(week: league.week, rows: league.standings)
                    if !league.topScorers.isEmpty {
                        PlayersCard(title: "Top scorers", note: nil, players: league.topScorers, ranked: true, gap: false)
                    }
                    if let changer = league.gameChanger { GameChangerCard(changer: changer) }
                    if !league.benchwarmers.isEmpty {
                        PlayersCard(title: "Most valuable benchwarmers", note: "Points left on the bench", players: league.benchwarmers, ranked: false, gap: false)
                    }
                    if !league.falseStarters.isEmpty {
                        PlayersCard(title: "False starters", note: "Should have sat", players: league.falseStarters, ranked: false, gap: true)
                    }
                }
                .opacity(beat >= 4 ? 1 : 0)
                .offset(y: beat >= 4 || still ? 0 : 16)
            }
            .padding(.horizontal, Spacing.xl + Spacing.xs)
            .padding(.vertical, Spacing.xl)
            .tabWidth()
        }
        .onAppear(perform: play)
    }

    private func play() {
        guard firstOpen, !played else { return }
        played = true
        if still {
            withAnimation(.easeOut(duration: 0.45)) { beat = Self.finalBeat }
            return
        }
        let times: [Double] = [0.05, 0.42, 0.7, 1.05]
        for (i, t) in times.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + t) {
                withAnimation(i == 1 ? .spring(duration: 0.38, bounce: 0.35) : Motion.settle) { beat = i + 1 }
            }
        }
    }
}

/// The week's result: its number huge and faint behind it, the result in the stage face, the score
/// against the opponent, the story, and the card to share.
private struct RecapHero: View {
    let recap: RecapResponse
    let link: URL
    let beat: Int

    @State private var card: RecapCardImage?
    @ScaledMetric(relativeTo: .largeTitle) private var wordSize: CGFloat = 48
    @ScaledMetric(relativeTo: .largeTitle) private var scoreSize: CGFloat = 32

    private var mine: LeagueRecap.MyWeek? { recap.recap.mine }
    private var win: Bool { mine?.result == .win }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text("Week \(recap.week) · Final")
                    .typeStyle(TypeScale.label).fontWeight(.semibold).textCase(.uppercase).tracking(1.2)
                    .foregroundStyle(win ? Color.sky : Color.muted)
                Text(RecapWords.word(mine?.result))
                    .font(.system(size: wordSize, weight: .black).width(.compressed)).textCase(.uppercase)
                    .foregroundStyle(win ? Color.valueInk : Color.muted)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .scaleEffect(beat >= 2 ? 1 : 1.6, anchor: .leading)
                    .opacity(beat >= 2 ? 1 : 0)
                    .sensoryFeedback(win ? .impact(weight: .heavy) : .impact(weight: .light), trigger: beat >= 2) { _, stamped in stamped }
                if let mine {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: Spacing.md) { score(mine); opponent(mine) }
                        VStack(alignment: .leading, spacing: Spacing.xs) { score(mine); opponent(mine) }
                    }
                    .opacity(beat >= 3 ? 1 : 0)
                }
                if !recap.recap.story.isEmpty {
                    Text(recap.recap.story)
                        .typeStyle(TypeScale.title).fontWeight(.regular).foregroundStyle(.text)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, Spacing.xs)
                        .opacity(beat >= 3 ? 1 : 0)
                }
                if !recap.settled {
                    Text("ESPN's stat corrections land Wednesday, so these numbers may still move.")
                        .typeStyle(TypeScale.label).foregroundStyle(.dim)
                        .fixedSize(horizontal: false, vertical: true)
                        .opacity(beat >= 3 ? 1 : 0)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("recap-hero-text")

            share
                .padding(.top, Spacing.sm)
                .opacity(beat >= 3 ? 1 : 0)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .topTrailing) {
            WeekNumeral(week: recap.week)
                .offset(x: -8, y: beat >= 1 ? -26 : 40)
                .opacity(beat >= 1 ? 1 : 0)
                .blur(radius: beat >= 1 ? 0 : 10)
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.dialog))
        .background(win ? Color.value.opacity(0.08) : Color.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(win ? Color.value.opacity(0.45) : Color.line))
        .task(id: recap.key) { card = recap.card.flatMap { RecapCardImage(recap: $0, league: recap.league.name) } }
    }

    private func score(_ mine: LeagueRecap.MyWeek) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            Text(SeasonFormat.points(beat >= 3 ? mine.me : 0)).foregroundStyle(win ? Color.valueInk : Color.text)
                .contentTransition(.numericText(value: beat >= 3 ? mine.me : 0))
            Text("–").foregroundStyle(.dim)
            Text(SeasonFormat.points(beat >= 3 ? mine.them : 0)).foregroundStyle(.muted)
                .contentTransition(.numericText(value: beat >= 3 ? mine.them : 0))
        }
        .font(.system(size: scoreSize, weight: .bold).width(.compressed).monospacedDigit())
    }

    private func opponent(_ mine: LeagueRecap.MyWeek) -> some View {
        Text("vs \(mine.opponent)").typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
    }

    @ViewBuilder
    private var share: some View {
        if let card {
            ShareLink(item: card, subject: Text("Week \(recap.week) recap"), message: Text(link.absoluteString), preview: SharePreview(card.title, image: Image(uiImage: card.image))) {
                Label(win ? "Share win card" : "Share recap card", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(ProviderButtonStyle())
            .accessibilityIdentifier("share-recap")
        } else if mine == nil {
            ShareLink(item: link, subject: Text("Week \(recap.week) recap")) {
                Label("Share recap link", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(ProviderButtonStyle())
            .accessibilityIdentifier("share-recap")
        }
    }

    private var spoken: String {
        var parts: [String]
        if let mine {
            let score = "\(SeasonFormat.points(mine.me)) to \(SeasonFormat.points(mine.them))"
            let result = switch mine.result {
            case .win: "Week \(recap.week) final: you won, \(score), against \(mine.opponent)."
            case .loss: "Week \(recap.week) final: you lost, \(score), to \(mine.opponent)."
            case .tie: "Week \(recap.week) final: a tie with \(mine.opponent), \(score)."
            }
            parts = [result, recap.recap.story]
        } else {
            parts = ["Week \(recap.week): bye week."]
        }
        if !recap.settled { parts.append("ESPN's stat corrections land Wednesday, so these numbers may still move.") }
        return parts.joined(separator: " ")
    }
}

// MARK: - The league's week

/// The standings after the week; the user's team on a faint green wash, named as theirs.
private struct StandingsCard: View {
    let week: Int
    let rows: [StandingRow]

    var body: some View {
        SeasonCard(title: "Standings", note: "After week \(week)") {
            VStack(spacing: 0) {
                ForEach(rows) { row in
                    Divider().overlay(.rowLine)
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                        Text("\(row.rank)").typeStyle(TypeScale.micro).foregroundStyle(.muted).monospacedDigit()
                            .frame(minWidth: 22, alignment: .leading)
                        Text(row.name).typeStyle(TypeScale.body).foregroundStyle(row.mine ? Color.mine : Color.text)
                            .fixedSize(horizontal: false, vertical: true)
                        if row.mine { Text("You").typeStyle(TypeScale.micro).foregroundStyle(.mine) }
                        Spacer(minLength: Spacing.md)
                        Text(row.record).typeStyle(TypeScale.body).foregroundStyle(.text).monospacedDigit()
                    }
                    .padding(.horizontal, Spacing.xl).padding(.vertical, Spacing.lg)
                    .background(row.mine ? Color.mine.opacity(0.07) : .clear)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(RecapWords.ordinal(row.rank)), \(row.name)\(row.mine ? ", your team" : ""), \(row.wins) and \(row.losses)\(row.ties > 0 ? " and \(row.ties)" : "")")
                }
            }
        }
    }
}

/// A list of players: name over position and fantasy team, points on the right; with `gap`, how far
/// under ESPN's call he fell.
private struct PlayersCard: View {
    let title: String
    let note: String?
    let players: [RecapPlayer]
    let ranked: Bool
    let gap: Bool

    var body: some View {
        SeasonCard(title: title, note: note) {
            VStack(spacing: 0) {
                ForEach(Array(players.enumerated()), id: \.element.id) { i, p in
                    Divider().overlay(.rowLine)
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                        Text(ranked ? "\(i + 1)" : SlotLabel.of(p.pos))
                            .typeStyle(TypeScale.micro).foregroundStyle(ranked ? Color.muted : Color.position(p.pos)).monospacedDigit()
                            .frame(minWidth: 30, alignment: .leading)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(p.name).typeStyle(TypeScale.body).foregroundStyle(.text).fixedSize(horizontal: false, vertical: true)
                            Text(ranked ? "\(SlotLabel.of(p.pos)) · \(p.teamName)" : p.teamName)
                                .typeStyle(TypeScale.label).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: Spacing.md)
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(SeasonFormat.points(p.points)).typeStyle(TypeScale.title).foregroundStyle(.text)
                            if gap { Text(SeasonFormat.signed(p.gap)).typeStyle(TypeScale.label).foregroundStyle(.reachInk) }
                        }
                        .monospacedDigit()
                    }
                    .padding(.horizontal, Spacing.xl).padding(.vertical, Spacing.lg)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(spoken(p, rank: i + 1))
                }
            }
        }
    }

    private func spoken(_ p: RecapPlayer, rank: Int) -> String {
        let lead = ranked ? "\(rank). " : ""
        let under = gap ? ", \(SeasonFormat.points(abs(p.gap))) under ESPN's call" : ""
        return "\(lead)\(p.name), \(SlotLabel.of(p.pos)), \(p.teamName): \(SeasonFormat.points(p.points)) points\(under)"
    }
}

/// The one performance that decided a matchup: the player, his points and how far over ESPN's call,
/// and the sentence that says why it mattered.
private struct GameChangerCard: View {
    let changer: GameChanger
    @ScaledMetric(relativeTo: .title) private var pointsSize: CGFloat = 30

    var body: some View {
        let p = changer.player
        SeasonCard(title: "Game changer", note: "Decided a matchup") {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(p.name).typeStyle(TypeScale.title).foregroundStyle(.text).fixedSize(horizontal: false, vertical: true)
                        Text("\(SlotLabel.of(p.pos)) · \(p.teamName)").typeStyle(TypeScale.label).foregroundStyle(.muted)
                    }
                    Spacer(minLength: Spacing.md)
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
                        Text(SeasonFormat.points(p.points)).font(.system(size: pointsSize, weight: .black).width(.compressed)).foregroundStyle(.text)
                        Text(SeasonFormat.signed(p.gap)).typeStyle(TypeScale.body).foregroundStyle(.valueInk)
                    }
                    .monospacedDigit()
                }
                Text("Won \(Text("\(SeasonFormat.points(changer.score.his))–\(SeasonFormat.points(changer.score.theirs))").bold()) against \(changer.opponent): by less than his \(Text(SeasonFormat.points(p.gap)).bold()) over ESPN's call.")
                    .typeStyle(TypeScale.label).foregroundStyle(.muted).monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, Spacing.xl).padding(.bottom, Spacing.xl)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(p.name), \(SlotLabel.of(p.pos)), \(p.teamName): \(SeasonFormat.points(p.points)) points, \(SeasonFormat.points(p.gap)) over ESPN's call. \(p.teamName) won \(SeasonFormat.points(changer.score.his)) to \(SeasonFormat.points(changer.score.theirs)) against \(changer.opponent), by less than that.")
        }
    }
}

/// The reader's shape while a week loads: the hero and a panel, still.
private struct ReaderSkeleton: View {
    var body: some View {
        VStack(spacing: Spacing.xl) {
            RoundedRectangle(cornerRadius: Radius.dialog).fill(.panel).frame(height: 240)
            RoundedRectangle(cornerRadius: Radius.dialog).fill(.panel).frame(height: 180)
            Spacer()
        }
        .padding(Spacing.xl + Spacing.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading the recap")
    }
}
