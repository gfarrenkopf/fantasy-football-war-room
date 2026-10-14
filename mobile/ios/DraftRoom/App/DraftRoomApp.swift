import SwiftUI

@main
struct DraftRoomApp: App {
    @State private var session = Session(api: DraftRoomApp.makeAPI())

    @MainActor private static func makeAPI() -> APIClient {
        #if DEBUG
        if let stub = UITestStub.apiIfRequested() { return stub }
        #endif
        return APIClient(baseURL: AppEnvironment.current.apiBaseURL)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .preferredColorScheme(.dark)
                .tint(.focus)
        }
    }
}

/// Picks the screen for where the session stands.
struct RootView: View {
    @Environment(Session.self) private var session

    var body: some View {
        ZStack {
            Color.bg.ignoresSafeArea()
            switch session.phase {
            case .starting:
                ProgressView().tint(.muted)
            case .signedOut:
                SignInView()
                    .transition(.opacity)
            case .signedIn:
                ShellView()
                    .transition(.opacity)
            case .updateRequired:
                UpdateRequiredView()
            case let .unreachable(message):
                UnreachableView(message: message)
            }
        }
        .animation(Motion.fade, value: session.phase)
        .task { await session.start() }
        // Season links (a shared recap, the season emails) wait here until the shell can open them.
        .onOpenURL { url in
            if let link = SeasonLink(url) { session.seasonLink = link }
        }
    }
}

/// A stored session couldn't be checked: offline, or the server is down.
private struct UnreachableView: View {
    @Environment(Session.self) private var session
    let message: String

    var body: some View {
        VStack(spacing: Spacing.lg) {
            Text(message)
                .typeStyle(TypeScale.body)
                .fontWeight(.regular)
                .foregroundStyle(.muted)
                .multilineTextAlignment(.center)
            Button("Try again") { Task { await session.refresh() } }
                .buttonStyle(ProviderButtonStyle(prominent: true))
                .frame(maxWidth: 240)
        }
        .padding(Spacing.xl * 2)
    }
}
