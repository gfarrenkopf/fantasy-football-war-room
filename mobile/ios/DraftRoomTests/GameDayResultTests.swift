import Foundation
import Testing
import UIKit

@testable import DraftRoom

/// Game day once the week is decided and between weeks (APE-402): decoding the result, the swing,
/// ESPN's track record and last week; Win Night playing once per league and week, and only for a
/// win; the result in words; and drawing the share card.
@MainActor
@Suite
struct GameDayResultTests {
    // The fixtures' team (see .research/ape402): London beat ESPN's call, Gibbs and Allen missed it.
    static let allen = 3918298, gibbs = 4429795, london = 4426502

    let defaults = UserDefaults(suiteName: "result-tests-\(UUID().uuidString)")!

    private func season(_ fixture: String) throws -> SeasonResponse {
        try APIClient.decoder.decode(SeasonResponse.self, from: Fixture.data(fixture))
    }

    // MARK: Decoding

    @Test func decodesTheWinAfterTheFinal() throws {
        let season = try season("season-final")
        #expect(season.phase == .results)
        let result = try #require(season.gameDay.result)
        let recap = result.recap
        #expect(recap.result == .win && recap.week == 3)
        #expect(recap.me == 118.6 && recap.them == 104.2 && recap.margin == 14.4)
        #expect(recap.opponent == "Gridiron Gang")
        #expect(recap.starters.count == 9 && recap.starters[0].slot == "QB" && recap.starters[0].playerId == Self.allen)
        #expect(recap.star?.player.playerId == Self.london && recap.star?.beat == true)

        let swing = try #require(result.swing)
        #expect(swing.swings.map(\.playerId) == [Self.gibbs, Self.allen, Self.london, 4374302])
        #expect(swing.swings[0].delta == -15.2 && swing.swings[0].side == "me")
        // The story always lands on the final.
        #expect(swing.rest?.after == swing.final && swing.final == 14.4)
        #expect(swing.hindsight?.best?.name == "Emeka Egbuka" && swing.hindsight?.wouldHaveWon == false)
        #expect(season.gameDay.trackRecord == nil && season.gameDay.lastWeek == nil)
    }

    @Test func decodesTheLossWithEspnsCall() throws {
        let season = try season("season-final-loss")
        let recap = try #require(season.gameDay.result?.recap)
        #expect(recap.result == .loss && recap.margin == 25.5)
        #expect(season.live?.decided == true && season.live?.status == "Final")
        let call = try #require(season.gameDay.espnCall)
        #expect(call.me == ProjectionCall(projected: 112.4, actual: 92.4))
        #expect(call.best?.playerId == Self.london && call.worst?.playerId == Self.gibbs)
        #expect(call.season?.weeks == 4)
    }

    @Test func decodesBetweenWeeks() throws {
        let season = try season("season-between")
        #expect(season.phase == .lineup && season.gameDay.result == nil && season.gameDay.espnCall == nil)
        let record = try #require(season.gameDay.trackRecord)
        #expect(record.weeks == 4 && record.overcalled == 3 && record.meanBias == -6.3)
        #expect(record.surest.playerId == Self.gibbs && record.shakiest.playerId == Self.allen)
        // The names come from this week's roster.
        #expect(season.gameDayView.player(record.surest.playerId)?.name == "Jahmyr Gibbs")
        let last = try #require(season.gameDay.lastWeek)
        #expect(last.week == season.view.currentWeek - 1 && last.result == .win)
        #expect(last.star?.player.name == "Drake London")
    }

    // MARK: Win Night

    @Test func winNightPlaysOncePerLeagueAndWeek() throws {
        let moments = MomentStore(defaults: defaults)
        let recap = try #require(try season("season-final").gameDay.result?.recap)
        #expect(moments.claimWinNight(leagueId: "lg-1", season: 2026, recap: recap))
        #expect(!moments.claimWinNight(leagueId: "lg-1", season: 2026, recap: recap))
        #expect(!moments.claimWinNight(leagueId: "lg-1", season: 2026, recap: recap))
        // Another league's win, or another season's same week, is its own night.
        #expect(moments.claimWinNight(leagueId: "lg-2", season: 2026, recap: recap))
        #expect(moments.claimWinNight(leagueId: "lg-1", season: 2027, recap: recap))
        #expect(defaults.bool(forKey: MomentStore.winNightKey(leagueId: "lg-1", season: 2026, week: 3)))
    }

    @Test func aLossNeverOpensWinNight() throws {
        let moments = MomentStore(defaults: defaults)
        let recap = try #require(try season("season-final-loss").gameDay.result?.recap)
        #expect(!moments.claimWinNight(leagueId: "lg-1", season: 2026, recap: recap))
        #expect(!defaults.bool(forKey: MomentStore.winNightKey(leagueId: "lg-1", season: 2026, week: recap.week)))
    }

    @Test func theRaceRunsPastTheirScore() {
        let pass = try! #require(WinNight.passMoment(me: 118.6, them: 104.2))
        #expect(pass > 0 && pass < 1)
        #expect(WinNight.level(pass, top: 118.6) - 104.2 < 0.001)
        #expect(WinNight.level(1, top: 118.6) == 118.6)
        #expect(WinNight.passMoment(me: 90, them: 104.2) == nil)
        let beats = WinNight.beats(starters: 9)
        #expect(beats.count == WinNight.finalBeat && beats == beats.sorted())
    }

    // MARK: Words

    @Test func theWinAndLossReadDifferently() throws {
        let win = try #require(try season("season-final").gameDay.result?.recap)
        let loss = try #require(try season("season-final-loss").gameDay.result?.recap)
        #expect(ResultWords.title(win.result) == "You won")
        #expect(ResultWords.title(loss.result) == "Not this week")
        #expect(ResultWords.line(win) == "Beat Gridiron Gang by 14.4.")
        #expect(ResultWords.line(loss).hasPrefix("Gridiron Gang took it by 25.5."))
        #expect(ResultWords.spoken(win) == "Week 3 final: you won, 118.6 to 104.2, beating Gridiron Gang by 14.4. Star of the week: Drake London, 24.6 points, 9.2 over ESPN's call.")
        #expect(ResultWords.spoken(loss).hasPrefix("Week 3 final: you lost, 92.4 to 117.9. Gridiron Gang won by 25.5. Bright spot: "))
        #expect(ResultWords.lead(25.8) == "Up 25.8" && ResultWords.lead(-12) == "Down 12.0" && ResultWords.lead(0) == "Even")
        #expect(ResultWords.final(-25.5, .loss) == "Lost by 25.5")
    }

    // MARK: The share card

    @Test(arguments: ["season-final", "season-final-loss"])
    func drawsTheShareCard(_ fixture: String) throws {
        let recap = try #require(try season(fixture).gameDay.result?.recap)
        let card = try #require(RecapCardImage(recap: recap, league: "App Tester"))
        #expect(card.image.size.width * card.image.scale == 1080)
        #expect(card.image.size.height * card.image.scale == 1350)
        #expect(card.fileName == "app-tester-week-3-\(recap.result.rawValue).png")
        #expect(card.title == "Week 3 \(recap.result.rawValue)")
        #expect(card.image.pngData() != nil)
    }
}
