import SwiftUI

// Pieces the season's tabs share, after the web's parts.tsx: a panel, a player's name and game,
// and his points against his projection. Text only: every number comes from the season route.

/// A season panel: a titled card on the panel tone, the web's `.panel` with its head band.
struct SeasonCard<Content: View, Accessory: View>: View {
    let title: String
    var note: String? = nil
    var tint: Color? = nil
    @ViewBuilder var accessory: () -> Accessory
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                Text(title).typeStyle(TypeScale.title).foregroundStyle(.text)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: Spacing.md)
                accessory()
                if let note { Text(note).typeStyle(TypeScale.label).foregroundStyle(.muted) }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.lg)
            content()
        }
        .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
        .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(tint ?? Color.line))
    }
}

extension SeasonCard where Accessory == EmptyView {
    init(title: String, note: String? = nil, tint: Color? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, note: note, tint: tint, accessory: { EmptyView() }, content: content)
    }
}

enum SeasonFormat {
    /// Points as the web shows them: one decimal.
    static func points(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(1))) }

    /// A signed gain: "+4.2", "−1.5" (a true minus, like the web's `signed()`).
    static func signed(_ value: Double) -> String { (value >= 0 ? "+" : "−") + points(abs(value)) }

    /// "J. Gibbs": the web's shortName(); a D/ST keeps its name.
    static func shortName(_ player: ViewPlayer) -> String {
        guard player.pos != "DST", let space = player.name.firstIndex(of: " "), space != player.name.startIndex else { return player.name }
        return "\(player.name.prefix(1)). \(player.name[player.name.index(after: space)...])"
    }

    /// ESPN's injury designations as its short tags (the web's INJURY_TAG).
    static func injuryTag(_ status: String) -> String? {
        switch status {
        case "QUESTIONABLE": "Q"
        case "DOUBTFUL": "D"
        case "OUT": "OUT"
        case "INJURY_RESERVE": "IR"
        case "SUSPENSION": "SSPD"
        default: nil
        }
    }

    /// "QB", "QB and TE", "QB, RB and TE": the web's holeSlots().
    static func slots(_ keys: [String]) -> String {
        var names: [String] = []
        for key in keys.map(SlotLabel.of) where !names.contains(key) { names.append(key) }
        guard names.count > 1 else { return names.first ?? "" }
        return names.dropLast().joined(separator: ", ") + " and " + names.last!
    }

    /// His NFL game, as the web's GameStatus: "vs NYJ · Sun 1:00 PM", "@ NYJ · 17–10 · 8:12 - 2nd", "vs NYJ · W 17–10 · Final".
    static func game(_ game: GameState) -> String {
        let opponent = game.opponent.isEmpty ? nil : "\(game.home ? "vs" : "@") \(game.opponent)"
        let score = game.score.map { "\($0.team)–\($0.opponent)" }
        switch game.state {
        case "in":
            return [opponent, score, game.detail.isEmpty ? "Live" : game.detail].compactMap(\.self).joined(separator: " · ")
        case "post":
            let result = game.score.map { s in "\(s.team > s.opponent ? "W" : s.team < s.opponent ? "L" : "T") \(score ?? "")" }
            return [opponent, result, "Final"].compactMap(\.self).joined(separator: " · ")
        default:
            return [opponent, game.kickoff.map(kickoff)].compactMap(\.self).joined(separator: " · ")
        }
    }

    /// Just where the game stands, for a narrow column: the clock, "Final", or the kickoff.
    static func gameWhen(_ game: GameState) -> String {
        switch game.state {
        case "in": game.detail.isEmpty ? "Live" : game.detail
        case "post": "Final"
        default: game.kickoff.map(kickoff) ?? game.opponent
        }
    }

    static func kickoff(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }

    /// The lead in words, never a bare signed number (DESIGN.md): "Up 15.3", "Lost by 4.0", "Tied".
    static func lead(_ lead: Double, started: Bool, decided: Bool) -> String {
        if abs(lead) < 0.05 { return started ? "Tied" : "vs" }
        let word = lead > 0 ? (decided ? "Won by" : "Up") : (decided ? "Lost by" : "Down")
        return "\(word) \(points(abs(lead)))"
    }

    /// "Updated 3 min ago".
    static func updated(_ date: Date, now: Date = .now) -> String {
        let minutes = Int(now.timeIntervalSince(date) / 60)
        if minutes < 1 { return "Updated just now" }
        if minutes < 60 { return "Updated \(minutes) min ago" }
        return "Updated \(date.formatted(.dateTime.weekday(.abbreviated).hour().minute()))"
    }
}

/// A player's name with his injury tag, over his position, team and game.
struct PlayerLine: View {
    let player: ViewPlayer
    var showPosition = true
    var compact = false
    var alignment: HorizontalAlignment = .leading

    var body: some View {
        VStack(alignment: alignment, spacing: 1) {
            HStack(spacing: Spacing.xs) {
                Text(compact ? SeasonFormat.shortName(player) : player.name)
                    .typeStyle(TypeScale.body).foregroundStyle(.text).lineLimit(1)
                if let tag = SeasonFormat.injuryTag(player.injuryStatus) {
                    Text(tag).typeStyle(TypeScale.micro)
                        .foregroundStyle(tag == "Q" ? Color.warnInk : Color.reachInk)
                }
            }
            Text(detail).typeStyle(TypeScale.label).foregroundStyle(player.game?.state == "in" ? Color.sky : Color.muted).lineLimit(1)
        }
    }

    private var detail: String {
        guard let game = player.game else { return showPosition ? [SlotLabel.of(player.pos), player.team].compactMap(\.self).joined(separator: " · ") : (player.team ?? "") }
        if compact { return SeasonFormat.gameWhen(game) }
        let who = showPosition ? "\(SlotLabel.of(player.pos)) · " : ""
        return who + SeasonFormat.game(game)
    }
}

/// What a player has scored, large, over his projection, with a meter of how much of it he has and
/// a tick where the game clock says he should be (the web's ScoreCell). The user's players earn green
/// past their projection; their opponent's ahead of pace read in red, from the user's chair.
struct ScoreCell: View {
    let player: ViewPlayer
    let pace: PlayerPace?
    var theirs = false
    var alignment: HorizontalAlignment = .trailing

    var body: some View {
        let level = pace?.pace ?? .pre
        let started = level != .pre
        let actual = player.actual ?? 0
        VStack(alignment: alignment, spacing: 2) {
            Text(SeasonFormat.points(started ? actual : player.points))
                .typeStyle(TypeScale.title).monospacedDigit()
                .foregroundStyle(tone(level))
                .contentTransition(.numericText(value: started ? actual : player.points))
            Text(sub(level, actual: actual)).typeStyle(TypeScale.label).foregroundStyle(.dim).monospacedDigit().lineLimit(1)
            if started && player.points > 0 {
                PaceMeter(share: min(1, max(0, actual / player.points)), due: pace?.progress, tint: tone(level) == Color.text ? Color.muted : tone(level), fromTrailing: alignment == .trailing)
                    .frame(width: 44, height: 3)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(level, actual: actual))
    }

    private func tone(_ level: Pace) -> Color {
        switch level {
        case .boom: theirs ? .reachInk : .value
        case .ahead: theirs ? .reachInk : .valueInk
        default: .text
        }
    }

    private func sub(_ level: Pace, actual: Double) -> String {
        switch level {
        case .pre: "proj"
        case .boom where player.points > 0: "\(SeasonFormat.signed(actual - player.points)) over"
        default: "of \(SeasonFormat.points(player.points))"
        }
    }

    private func spoken(_ level: Pace, actual: Double) -> String {
        switch level {
        case .pre: "projected \(SeasonFormat.points(player.points))"
        case .behind: "\(SeasonFormat.points(actual)) points, behind his projection of \(SeasonFormat.points(player.points))"
        case .on: "\(SeasonFormat.points(actual)) points, on pace with his projection of \(SeasonFormat.points(player.points))"
        case .ahead: "\(SeasonFormat.points(actual)) points, ahead of his projection of \(SeasonFormat.points(player.points))"
        case .boom: "\(SeasonFormat.points(actual)) points, past his whole projection of \(SeasonFormat.points(player.points))"
        }
    }
}

/// How much of his projection a player has, and where the game clock says he should be.
struct PaceMeter: View {
    let share: Double
    let due: Double?
    let tint: Color
    var fromTrailing = false

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: fromTrailing ? .trailing : .leading) {
                Capsule().fill(.line)
                Capsule().fill(tint).frame(width: geo.size.width * share)
                if let due {
                    Rectangle().fill(.text).frame(width: 1.5, height: geo.size.height + 4)
                        .offset(x: (fromTrailing ? -1 : 1) * geo.size.width * due)
                }
            }
        }
        .accessibilityHidden(true)
    }
}
