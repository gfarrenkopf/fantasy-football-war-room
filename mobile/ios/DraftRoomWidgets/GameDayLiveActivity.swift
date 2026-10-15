import ActivityKit
import SwiftUI
import WidgetKit

/// The user's matchup on the lock screen and in the Dynamic Island, all game day (21.5), after the
/// app's Game day scoreboard: both scores, the lead in words and tone, each side's projection and
/// starters left, and ESPN's win odds. The server's live job pushes each new score.
struct GameDayLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GameDayAttributes.self) { context in
            LockScreenView(league: context.attributes.league, live: context.state, stale: context.isStale)
                .activityBackgroundTint(Color.bg.opacity(0.85))
                .activitySystemActionForegroundColor(.text)
                .widgetURL(context.attributes.url)
        } dynamicIsland: { context in
            let live = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Score(name: "You", side: live.me, live: live, mine: true)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Score(name: live.them.name, side: live.them, live: live, mine: false)
                }
                DynamicIslandExpandedRegion(.center) {
                    Status(live: live, league: context.attributes.league)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: Spacing.md) {
                        Lead(live: live)
                        if let win = live.win, !live.decided { WinBar(win: win) }
                    }
                }
            } compactLeading: {
                Text(LiveFormat.points(live.me.points))
                    .font(.caption.bold().monospacedDigit())
                    .foregroundStyle(.mine)
                    .contentTransition(.numericText(value: live.me.points))
            } compactTrailing: {
                Text(LiveFormat.points(live.them.points))
                    .font(.caption.bold().monospacedDigit())
                    .foregroundStyle(.muted)
                    .contentTransition(.numericText(value: live.them.points))
            } minimal: {
                Text(LiveFormat.points(live.me.points))
                    .font(.caption2.bold().monospacedDigit())
                    .foregroundStyle(live.tone)
                    .minimumScaleFactor(0.6)
            }
            .widgetURL(context.attributes.url)
            .keylineTint(live.tone)
        }
    }
}

extension LiveMatchup {
    /// Green while the user leads, red while they trail, muted when level or before kickoff.
    var tone: Color {
        guard started, abs(lead) >= 0.05 else { return .muted }
        return lead > 0 ? .value : .reachInk
    }
}

private struct LockScreenView: View {
    let league: String
    let live: LiveMatchup
    let stale: Bool

    var body: some View {
        VStack(spacing: Spacing.lg) {
            HStack(alignment: .firstTextBaseline) {
                Status(live: live, league: league)
                Spacer()
                Text(stale ? "Not updating" : "Week \(live.week)").font(.caption2).foregroundStyle(.dim)
            }
            HStack(alignment: .center, spacing: Spacing.md) {
                Score(name: "You", side: live.me, live: live, mine: true)
                Lead(live: live).frame(minWidth: 64)
                Score(name: live.them.name, side: live.them, live: live, mine: false)
            }
            if let win = live.win, !live.decided { WinBar(win: win) }
        }
        .padding(Spacing.xl)
        .accessibilityElement(children: .combine)
    }
}

private struct Status: View {
    let live: LiveMatchup
    let league: String

    var body: some View {
        HStack(spacing: Spacing.sm) {
            if live.live { Circle().fill(.sky).frame(width: 6, height: 6).accessibilityHidden(true) }
            Text(live.status).foregroundStyle(live.live ? Color.sky : Color.text).lineLimit(1)
            Text(league).foregroundStyle(.muted).lineLimit(1)
        }
        .font(.caption.weight(.semibold))
    }
}

private struct Score: View {
    let name: String
    let side: LiveSide
    let live: LiveMatchup
    let mine: Bool

    var body: some View {
        let number = live.started ? side.points : side.projected
        VStack(spacing: Spacing.xs) {
            Text(name).font(.caption2).foregroundStyle(mine ? Color.mine : Color.muted).lineLimit(1)
            Text(LiveFormat.points(number))
                .font(.title.bold().monospacedDigit())
                .foregroundStyle(.text)
                .minimumScaleFactor(0.6).lineLimit(1)
                .contentTransition(.numericText(value: number))
            Text(live.started ? (live.decided ? "proj \(LiveFormat.points(side.projected))" : side.left == 0 ? "done" : "\(side.left) to play") : "projected")
                .font(.caption2.monospacedDigit()).foregroundStyle(.dim).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct Lead: View {
    let live: LiveMatchup

    var body: some View {
        Text(LiveFormat.lead(live.lead, started: live.started, decided: live.decided))
            .font(.subheadline.weight(.semibold).monospacedDigit())
            .foregroundStyle(live.tone)
            .multilineTextAlignment(.center)
            .contentTransition(.numericText(value: live.lead))
    }
}

/// ESPN's win odds as a split bar: green against a 35% red, like the app's scoreboard.
private struct WinBar: View {
    let win: Int

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            GeometryReader { geo in
                HStack(spacing: 0) {
                    Rectangle().fill(.value).frame(width: geo.size.width * Double(win) / 100)
                    Rectangle().fill(Color.reach.opacity(0.35))
                }
                .clipShape(Capsule())
            }
            .frame(height: 4)
            Text("ESPN: \(win)% to win").font(.caption2.monospacedDigit()).foregroundStyle(.muted)
        }
    }
}

// MARK: - Previews

extension GameDayAttributes {
    static let preview = GameDayAttributes(leagueId: "lg-1", league: "Sunday Regulars")
}

extension LiveMatchup {
    private static func side(_ name: String, _ points: Double, _ projected: Double, left: Int) -> LiveSide {
        LiveSide(teamId: name == "Mine" ? 1 : 2, name: name, points: points, projected: projected, left: left)
    }

    static let upNext = LiveMatchup(week: 6, status: "Up next", live: false, started: false, decided: false, lead: 0, win: 54, me: side("Mine", 0, 112.4, left: 9), them: side("Gridiron Gang", 0, 108.9, left: 9))
    static let leading = LiveMatchup(week: 6, status: "Live", live: true, started: true, decided: false, lead: 12.6, win: 71, me: side("Mine", 74.2, 118.0, left: 4), them: side("Gridiron Gang", 61.6, 101.3, left: 3))
    static let trailing = LiveMatchup(week: 6, status: "3 left for Gridiron Gang", live: false, started: true, decided: false, lead: -8.3, win: 32, me: side("Mine", 96.1, 99.0, left: 1), them: side("Gridiron Gang", 104.4, 121.7, left: 3))
    static let final = LiveMatchup(week: 6, status: "Final", live: false, started: true, decided: true, lead: 14.5, win: nil, me: side("Mine", 128.9, 128.9, left: 0), them: side("Gridiron Gang", 114.4, 114.4, left: 0))
}

#Preview("Lock screen", as: .content, using: GameDayAttributes.preview) {
    GameDayLiveActivity()
} contentStates: {
    LiveMatchup.upNext
    LiveMatchup.leading
    LiveMatchup.trailing
    LiveMatchup.final
}

#Preview("Island expanded", as: .dynamicIsland(.expanded), using: GameDayAttributes.preview) {
    GameDayLiveActivity()
} contentStates: {
    LiveMatchup.leading
    LiveMatchup.final
}

#Preview("Island compact", as: .dynamicIsland(.compact), using: GameDayAttributes.preview) {
    GameDayLiveActivity()
} contentStates: {
    LiveMatchup.leading
    LiveMatchup.trailing
}

#Preview("Island minimal", as: .dynamicIsland(.minimal), using: GameDayAttributes.preview) {
    GameDayLiveActivity()
} contentStates: {
    LiveMatchup.leading
    LiveMatchup.trailing
}
