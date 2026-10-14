import SwiftUI

/// The season's sections, as tabs: the web's season room tabs (SeasonRoom.tsx), in its order.
/// Recaps live in Game day, as on the web. Epic 18 builds Game day and Lineup, Epic 19 Waivers and
/// Trades' offers and builder, and Epic 20 the AI in them.
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
