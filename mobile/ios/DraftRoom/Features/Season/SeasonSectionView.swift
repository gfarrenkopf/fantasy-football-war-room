import SwiftUI

/// The season's sections, as tabs: the web's season room tabs (SeasonRoom.tsx), in its order.
/// Recaps live in Game day, as on the web. Epic 18 builds Game day and Lineup, Epic 19 Waivers,
/// Epic 20 Trades.
enum SeasonTab: String, CaseIterable, Identifiable, Hashable {
    case gameDay = "gameday"
    case lineup
    case trade
    case waivers

    var id: String { rawValue }

    var title: String {
        switch self {
        case .gameDay: "Game day"
        case .lineup: "Lineup"
        case .trade: "Trades"
        case .waivers: "Waivers"
        }
    }

    var symbol: String {
        switch self {
        case .gameDay: "sportscourt"
        case .lineup: "list.bullet.rectangle"
        case .trade: "arrow.left.arrow.right"
        case .waivers: "person.badge.plus"
        }
    }
}

/// Placeholder for a section until its Epic 18 ticket builds it.
struct SeasonSectionView: View {
    let section: SeasonTab
    let league: League

    var body: some View {
        ContentUnavailableView {
            Label(section.title, systemImage: section.symbol)
        } description: {
            Text("\(league.name) · \(String(league.season))")
        }
        .foregroundStyle(.muted)
        .accessibilityIdentifier("section-\(section.rawValue)")
    }
}
