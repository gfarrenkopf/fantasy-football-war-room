import SwiftUI

@main
struct DraftRoomApp: App {
    @State private var session = Session(api: APIClient(baseURL: AppEnvironment.current.apiBaseURL))

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
                HomeView()
                    .transition(.opacity)
            case .updateRequired:
                UpdateRequiredView()
            case let .unreachable(message):
                UnreachableView(message: message)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: session.phase)
        .task { await session.start() }
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
