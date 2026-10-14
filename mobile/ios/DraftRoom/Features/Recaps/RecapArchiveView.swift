import SwiftUI

/// The recap archive on Game day (APE-384), shown whenever no game is on, like the web's
/// RecapArchive under GameDayPanel. The newest week leads as a hero in the stage face, its number
/// set huge and faint behind it; the weeks before it follow as rows, each opening the recap reader.
/// A season menu appears only once there's a second season to pick.
struct RecapArchiveView: View {
    let store: RecapsStore
    /// The week Game day already shows as its result, kept out of the list so it isn't told twice.
    var hiding: RecapKey? = nil
    /// The week whose recap comes first, for the empty state.
    let firstWeek: Int

    @State private var season: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            header
            switch store.load {
            case .loading where store.archive == nil:
                ArchiveSkeleton()
            case let .failed(message) where store.archive == nil:
                ArchiveNote(icon: "wifi.slash", text: message, action: ("Try again", { Task { await store.refresh() } }))
            default:
                if store.offline {
                    Label("Offline · showing the recaps kept on this phone", systemImage: "wifi.slash")
                        .typeStyle(TypeScale.label).foregroundStyle(.warnInk)
                }
                if let first = shown.first {
                    NavigationLink(value: first.key) { RecapHeroRow(summary: first) }
                        .buttonStyle(PressStyle())
                        .accessibilityIdentifier("recap-hero")
                    if shown.count > 1 {
                        VStack(spacing: 0) {
                            ForEach(Array(shown.dropFirst().enumerated()), id: \.element.id) { i, summary in
                                if i > 0 { Divider().overlay(.rowLine) }
                                NavigationLink(value: summary.key) { RecapRow(summary: summary) }
                                    .buttonStyle(PressStyle())
                                    .accessibilityIdentifier("recap-week-\(summary.week)")
                            }
                        }
                        .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
                        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(.line))
                    }
                } else {
                    ArchiveNote(
                        icon: "newspaper",
                        text: "Your first recap lands after week \(firstWeek): your result and the story of it, the standings, the week's top scorers and the game changer.")
                        .accessibilityIdentifier("recaps-empty")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("recaps")
    }

    private var seasons: [Int] { store.archive?.seasons ?? [] }
    private var picked: Int? { season.flatMap { seasons.contains($0) ? $0 : nil } ?? seasons.first }

    /// The picked season's weeks, newest first, less the one Game day already shows.
    private var shown: [RecapSummary] {
        guard let archive = store.archive, let picked else { return [] }
        return archive.weeks(in: picked).filter { $0.key != hiding }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Recaps").typeStyle(TypeScale.title).foregroundStyle(.text).accessibilityAddTraits(.isHeader)
            Spacer(minLength: Spacing.md)
            if seasons.count > 1, let picked {
                Menu {
                    Picker("Season", selection: Binding { picked } set: { season = $0 }) {
                        ForEach(seasons, id: \.self) { Text("\(String($0)) season").tag($0) }
                    }
                } label: {
                    HStack(spacing: Spacing.xs) {
                        Text("\(String(picked)) season")
                        Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
                    }
                    .typeStyle(TypeScale.label).foregroundStyle(.muted)
                    .frame(minHeight: 44)
                }
                .accessibilityLabel("Season, \(String(picked))")
                .accessibilityIdentifier("recap-season")
            }
        }
    }
}

/// The newest week, as the archive's hero: the week's number huge and faint behind the result, the
/// score, and the week in a line. A win wears the green wash; anything else stays on the panel.
private struct RecapHeroRow: View {
    let summary: RecapSummary
    @ScaledMetric(relativeTo: .largeTitle) private var wordSize: CGFloat = 40
    @ScaledMetric(relativeTo: .title) private var scoreSize: CGFloat = 26

    private var outcome: WeekRecap.Outcome? { summary.mine?.result }
    private var win: Bool { outcome == .win }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Week \(summary.week) · Final")
                .typeStyle(TypeScale.label).fontWeight(.semibold).textCase(.uppercase).tracking(1.2)
                .foregroundStyle(win ? Color.sky : Color.muted)
            Text(RecapWords.word(outcome))
                .font(.system(size: wordSize, weight: .black).width(.compressed)).textCase(.uppercase)
                .foregroundStyle(win ? Color.valueInk : Color.muted)
                .lineLimit(1).minimumScaleFactor(0.7)
            if let mine = summary.mine {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.md) { score(mine); opponent(mine) }
                    VStack(alignment: .leading, spacing: Spacing.xs) { score(mine); opponent(mine) }
                }
            }
            Text(summary.headline).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.text)
                .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Spacing.xs) {
                Text("Read the recap")
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
            }
            .typeStyle(TypeScale.body).foregroundStyle(.sky)
            .padding(.top, Spacing.xs)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .topTrailing) { WeekNumeral(week: summary.week, size: 150).offset(x: -6, y: -22) }
        .clipShape(RoundedRectangle(cornerRadius: Radius.dialog))
        .background(win ? Color.value.opacity(0.08) : Color.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(win ? Color.value.opacity(0.45) : Color.line))
        .contentShape(RoundedRectangle(cornerRadius: Radius.dialog))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(RecapWords.spoken(summary))
        .accessibilityHint("Opens the recap")
    }

    private func score(_ mine: RecapResult) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.sm) {
            Text(SeasonFormat.points(mine.me)).foregroundStyle(win ? Color.valueInk : Color.text)
            Text("–").foregroundStyle(.dim)
            Text(SeasonFormat.points(mine.them)).foregroundStyle(.muted)
        }
        .font(.system(size: scoreSize, weight: .bold).width(.compressed).monospacedDigit())
    }

    private func opponent(_ mine: RecapResult) -> some View {
        Text("vs \(mine.opponent)").typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted).lineLimit(1)
    }
}

/// An older week: the result as a letter in its tone, the week and its line, the score.
private struct RecapRow: View {
    let summary: RecapSummary
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            ResultMark(outcome: summary.mine?.result)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Week \(summary.week)").typeStyle(TypeScale.body).foregroundStyle(.text)
                    Spacer(minLength: Spacing.md)
                    if !typeSize.isAccessibilitySize, let mine = summary.mine { score(mine) }
                }
                Text(summary.headline).typeStyle(TypeScale.label).foregroundStyle(.muted)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                if typeSize.isAccessibilitySize, let mine = summary.mine { score(mine) }
            }
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(.dim)
                .padding(.top, Spacing.xs)
        }
        .padding(.horizontal, Spacing.xl).padding(.vertical, Spacing.lg)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(RecapWords.spoken(summary))
        .accessibilityHint("Opens the recap")
    }

    private func score(_ mine: RecapResult) -> some View {
        Text("\(SeasonFormat.points(mine.me))–\(SeasonFormat.points(mine.them))")
            .typeStyle(TypeScale.label).monospacedDigit().foregroundStyle(.muted)
    }
}

/// The result as a letter on a small tile: W on the green wash, L and T quiet, a dash for a bye. The
/// letter carries the meaning, so the color is never the only cue.
struct ResultMark: View {
    let outcome: WeekRecap.Outcome?
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 30

    var body: some View {
        Text(letter)
            .font(.system(size: side * 0.55, weight: .black).width(.compressed))
            .foregroundStyle(outcome == .win ? Color.valueInk : outcome == nil ? Color.dim : Color.muted)
            .frame(width: side, height: side)
            .background(outcome == .win ? Color.value.opacity(0.14) : Color.chip, in: RoundedRectangle(cornerRadius: Radius.md))
            .accessibilityHidden(true)
    }

    private var letter: String {
        switch outcome {
        case .win: "W"
        case .loss: "L"
        case .tie: "T"
        case nil: "–"
        }
    }
}

/// The week's number, set huge and faint behind its result (the web's recapNumeral).
struct WeekNumeral: View {
    let week: Int
    var size: CGFloat = 168

    var body: some View {
        Text("\(week)")
            .font(.system(size: size, weight: .black).width(.compressed))
            .foregroundStyle(Color.text.opacity(0.06))
            .accessibilityHidden(true)
    }
}

/// A recap's words, shared by the archive, the reader and VoiceOver.
enum RecapWords {
    static func word(_ outcome: WeekRecap.Outcome?) -> String {
        switch outcome {
        case .win: "Won"
        case .loss: "Lost"
        case .tie: "Tied"
        case nil: "Bye week"
        }
    }

    /// "Week 3: lost 101.7 to 102.9 against Gridiron Gang. Brutal. Gridiron Gang got you by 1.2."
    static func spoken(_ summary: RecapSummary) -> String {
        guard let mine = summary.mine else { return "Week \(summary.week): bye week." }
        let score = "\(SeasonFormat.points(mine.me)) to \(SeasonFormat.points(mine.them))"
        let verb = switch mine.result {
        case .win: "won"
        case .loss: "lost"
        case .tie: "tied"
        }
        return "Week \(summary.week): \(verb) \(score) against \(mine.opponent). \(summary.headline)"
    }

    /// "1st", "2nd", "11th".
    static func ordinal(_ n: Int) -> String {
        let tens = n % 100
        if (11 ... 13).contains(tens) { return "\(n)th" }
        let suffixes = ["th", "st", "nd", "rd"]
        return "\(n)\(n % 10 < suffixes.count ? suffixes[n % 10] : "th")"
    }
}

/// A row pressed under the finger: a quick dip, no color change.
private struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.7 : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

/// A quiet panel for the archive's empty and failed states.
private struct ArchiveNote: View {
    let icon: String
    let text: String
    var action: (String, () -> Void)? = nil

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.lg) {
            Image(systemName: icon).foregroundStyle(.muted).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.md) {
                Text(text).typeStyle(TypeScale.body).fontWeight(.regular).foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
                if let action {
                    Button(action.0, action: action.1).buttonStyle(ProviderButtonStyle())
                }
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.xl)
        .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(.line))
    }
}

/// The archive's shape while it loads: a hero and two rows, still.
private struct ArchiveSkeleton: View {
    var body: some View {
        VStack(spacing: Spacing.lg) {
            RoundedRectangle(cornerRadius: Radius.dialog).fill(.panel).frame(height: 168)
            RoundedRectangle(cornerRadius: Radius.dialog).fill(.panel).frame(height: 104)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading recaps")
    }
}
