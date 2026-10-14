import CoreTransferable
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The week's keepsake for the group chat (the web's recapCard.ts, APE-230), drawn natively: a
/// 1080×1350 poster on the stage, with the giant W, L or T, the final, the margin on the slab, the
/// starters as they scored and the star of the week. A win is lit green; a loss is the same stage
/// with the lights down, a bright spot, and a dry word at the foot. Nothing leaves the phone until
/// the user shares it.
struct RecapCardView: View {
    let recap: WeekRecap
    let league: String

    /// Laid out at 360×450 points and rendered at 3×.
    static let size = CGSize(width: 360, height: 450)

    private var win: Bool { recap.result == .win }
    private var tone: Color { win ? .mine : .muted }

    var body: some View {
        VStack(spacing: 0) {
            Text("Week \(recap.week) · Final".uppercased())
                .font(.system(size: 12, weight: .heavy).width(.condensed)).tracking(2.6)
                .foregroundStyle(win ? Color.sky : Color.muted)
                .padding(.top, 24)
            Text(letter)
                .font(.system(size: 104, weight: .black).width(.compressed))
                .foregroundStyle(tone)
                .shadow(color: win ? Color.mine.opacity(0.55) : .clear, radius: 18)
                .frame(height: 96)
            HStack(alignment: .firstTextBaseline, spacing: 14) {
                Text(SeasonFormat.points(recap.me)).foregroundStyle(.text)
                Text("–").font(.system(size: 16, weight: .heavy)).foregroundStyle(Color.muted.opacity(0.6))
                Text(SeasonFormat.points(recap.them)).foregroundStyle(Color.muted.opacity(0.9))
            }
            .font(.system(size: 36, weight: .black).width(.compressed).monospacedDigit())
            Slab(text: slab, tone: tone, ink: win ? .mineInk : .bg, size: 17)
                .padding(.top, 6)
            Text("\(win ? "over" : recap.result == .loss ? "to" : "with") \(recap.opponent) · \(league)")
                .font(.system(size: 10, weight: .semibold)).foregroundStyle(.muted).lineLimit(1)
                .padding(.top, 8).padding(.horizontal, 24)
            VStack(spacing: 3) {
                ForEach(recap.starters) { p in starter(p) }
            }
            .padding(.horizontal, 24).padding(.top, 14)
            Spacer(minLength: 8)
            if let star = recap.star {
                VStack(spacing: 4) {
                    Slab(text: win ? "Star of the week" : "Bright spot", tone: tone, ink: win ? .mineInk : .bg, size: 15)
                    Text(star.player.name.uppercased())
                        .font(.system(size: 24, weight: .black).width(.compressed)).foregroundStyle(.text)
                        .lineLimit(1).minimumScaleFactor(0.6).padding(.horizontal, 24)
                    Text(star.beat
                        ? "\(SeasonFormat.points(star.player.points)) points · +\(SeasonFormat.points(star.player.points - star.player.projected)) over ESPN's call"
                        : "\(SeasonFormat.points(star.player.points)) points, the most of your starters")
                        .font(.system(size: 9.5, weight: .semibold)).foregroundStyle(.muted)
                }
            }
            Text(recap.result == .loss ? "Draft Room · \(shrug)" : "Draft Room")
                .font(.system(size: 8, weight: .semibold)).foregroundStyle(Color.muted.opacity(0.8))
                .padding(.top, 12).padding(.bottom, 10)
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .background { StageBackground(win: win) }
        .environment(\.colorScheme, .dark)
    }

    private var letter: String {
        switch recap.result {
        case .win: "W"
        case .loss: "L"
        case .tie: "T"
        }
    }

    private var slab: String {
        switch recap.result {
        case .win: "Won by \(SeasonFormat.points(recap.margin))"
        case .loss: "Lost by \(SeasonFormat.points(recap.margin))"
        case .tie: "Dead heat"
        }
    }

    /// The loss card's last word, by how it went.
    private var shrug: String {
        if recap.margin < 3 { return "lost by a rounding error" }
        if recap.margin >= 40 { return "we don't talk about this one" }
        return "every contender drops one"
    }

    private func starter(_ p: WeekRecap.Starter) -> some View {
        let star = p.playerId == recap.star?.player.playerId
        let hue = Color.position(p.pos)
        return HStack(spacing: 8) {
            Text(SlotLabel.of(p.slot))
                .font(.system(size: 7.5, weight: .heavy).width(.condensed)).foregroundStyle(hue)
                .frame(width: 30, height: 12)
                .background(hue.opacity(0.2), in: RoundedRectangle(cornerRadius: 2))
            Text(p.name).font(.system(size: 10, weight: .bold)).foregroundStyle(.text).lineLimit(1)
            Spacer(minLength: 4)
            Text(SeasonFormat.points(p.points))
                .font(.system(size: 12, weight: .black).width(.compressed).monospacedDigit())
                .foregroundStyle(p.points >= p.projected ? Color.mine : p.points < p.projected * 0.7 ? Color.reachInk : Color.text)
        }
        .padding(.horizontal, 4).frame(height: 17)
        .background(star ? tone.opacity(0.14) : Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 3))
    }
}

/// The margin, on the skewed broadcast slab.
struct Slab: View {
    let text: String
    let tone: Color
    let ink: Color
    var size: CGFloat = 17

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: size, weight: .black).width(.compressed))
            .foregroundStyle(ink)
            .padding(.horizontal, size * 1.1).padding(.vertical, size * 0.2)
            .background(tone)
            .transformEffect(CGAffineTransform(a: 1, b: 0, c: -0.16, d: 1, tx: size * 0.2, ty: 0))
    }
}

/// The stage, lit from the floor: green for a win, work lights for anything else.
struct StageBackground: View {
    let win: Bool

    var body: some View {
        ZStack {
            RadialGradient(colors: [win ? Color(red: 0.07, green: 0.1, blue: 0.09) : Color(red: 0.08, green: 0.09, blue: 0.11), Color(red: 0.024, green: 0.031, blue: 0.039)],
                           center: UnitPoint(x: 0.5, y: 0.36), startRadius: 10, endRadius: 520)
            RadialGradient(colors: [(win ? Color.mine : Color.muted).opacity(win ? 0.22 : 0.1), .clear],
                           center: UnitPoint(x: 0.5, y: 1.04), startRadius: 6, endRadius: 330)
        }
    }
}

/// The card as a PNG for the share sheet, named for the league and week.
struct RecapCardImage: Transferable, Equatable {
    let image: UIImage
    let fileName: String
    let title: String

    @MainActor
    init?(recap: WeekRecap, league: String) {
        guard let image = Self.render(recap: recap, league: league) else { return nil }
        self.image = image
        let slug = league.lowercased().replacing(/[^a-z0-9]+/, with: "-").trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        fileName = "\(slug.isEmpty ? "league" : slug)-week-\(recap.week)-\(recap.result.rawValue).png"
        title = "Week \(recap.week) \(recap.result.rawValue)"
    }

    /// Draws the card at 1080×1350 pixels.
    @MainActor
    static func render(recap: WeekRecap, league: String) -> UIImage? {
        let renderer = ImageRenderer(content: RecapCardView(recap: recap, league: league))
        renderer.proposedSize = ProposedViewSize(RecapCardView.size)
        renderer.scale = 3
        renderer.isOpaque = true
        return renderer.uiImage
    }

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .png) { card in card.image.pngData() ?? Data() }
            .suggestedFileName { $0.fileName }
    }
}

#if DEBUG
#Preview {
    RecapCardView(recap: SeasonSample.finalResult.recap, league: "App Tester")
}
#endif
