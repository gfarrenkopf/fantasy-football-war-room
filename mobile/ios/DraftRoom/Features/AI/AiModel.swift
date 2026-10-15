import Foundation
import Observation

/// In-season AI for one league (APE-391, after the web's AiPanel): the AI lineup in the Lineup tab,
/// and trade ideas and write-ups in the Trades tab. Kept by the shell per league, so a write the user
/// leaves running carries on, and the tab shows it when they come back.
///
/// The server decides who gets AI and what it says. A 403 or 404 means this account has none, and the
/// app shows none, as the web does. A locked league shows the server's one line about the pass.
@MainActor
@Observable
final class AiModel {
    enum Load: Equatable {
        case loading
        case ready(AiResponse)
        /// No AI for this account or league, or ESPN couldn't be read (the tab already says so).
        case hidden
        case failed(String)
    }

    /// A write in flight. Writing takes up to 90 seconds.
    enum Job: Equatable {
        case lineup
    }

    let store: SeasonStore
    private(set) var load: Load = .loading
    private(set) var working: Job?
    /// Why the last AI lineup write didn't land, in the server's words.
    private(set) var lineupError: String?

    private let api: APIClient
    private var reading = false

    /// The server's own timeout is 90 seconds; this leaves room for the round trip.
    static let writeTimeout: TimeInterval = 120

    init(api: APIClient, store: SeasonStore) {
        self.api = api
        self.store = store
    }

    var ai: AiResponse? {
        if case let .ready(ai) = load { return ai }
        return nil
    }

    // MARK: Reading

    /// Reads the AI state the first time a tab shows it.
    func start() async {
        guard ai == nil else { return }
        await refresh()
    }

    /// Reads again, e.g. on coming back to the app: a write left running may have finished.
    func refresh() async {
        guard !reading else { return }
        reading = true
        defer { reading = false }
        do {
            load = .ready(try await api.get("api/v1/leagues/\(store.leagueId)/ai"))
        } catch .signedOut {
            // The session handles this: the app is already back at sign-in.
        } catch let .server(status, _) where status == 403 || status == 404 {
            load = .hidden
        } catch .problem {
            load = .hidden
        } catch {
            if ai == nil { load = .failed(error.message) }
        }
    }

    // MARK: The AI lineup

    /// Writes this week's mid-week AI lineup, or rewrites it with the latest news.
    func writeLineup() async {
        guard working == nil else { return }
        working = .lineup
        lineupError = nil
        defer { working = nil }
        do {
            load = .ready(try await api.post("api/v1/leagues/\(store.leagueId)/ai/lineup", timeout: Self.writeTimeout))
        } catch .signedOut {
        } catch .locked {
            // The trial ended since the last read: the card shows the server's line about the pass.
            await refresh()
        } catch .offline {
            // The server carries on writing when the app loses the answer; it may be there now.
            let before = ai?.lineup?.createdAt
            await refresh()
            if ai?.lineup?.createdAt == before { lineupError = APIError.offline.message }
        } catch {
            lineupError = error.message
            await refresh()
        }
    }
}
