import AuthenticationServices
import SwiftUI

/// The way in. The room's lights come up as it opens (the brand settles, then the three ways in
/// rise one after another), and a sent link flies off as an envelope, like the web's sign-in.
struct SignInView: View {
    @Environment(Session.self) private var session
    @Environment(\.webAuthenticationSession) private var webAuthentication
    @State private var model: SignInModel?
    @State private var shown = false
    @FocusState private var emailFocused: Bool

    var body: some View {
        Group {
            if let model {
                content(model)
            } else {
                Color.clear
            }
        }
        .background(.bg)
        .task {
            if model == nil { model = SignInModel(session: session) }
            withAnimation(Motion.settle.delay(0.1)) { shown = true }
        }
        .onOpenURL { url in
            Task { await model?.handle(url) }
        }
    }

    @ViewBuilder
    private func content(_ model: SignInModel) -> some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl * 2) {
                header
                    .offset(y: shown ? 0 : 12)
                    .opacity(shown ? 1 : 0)

                switch model.step {
                case .choose:
                    choices(model)
                        .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .leading).combined(with: .opacity)))
                case let .checkInbox(address):
                    InboxView(address: address) {
                        withAnimation(Motion.respond) { model.step = .choose }
                    }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }

                if let message = model.errorMessage {
                    Text(message)
                        .typeStyle(TypeScale.label)
                        .foregroundStyle(.reachInk)
                        .accessibilityIdentifier("signin-error")
                        .transition(.opacity)
                }
            }
            .padding(.horizontal, Spacing.xl + Spacing.sm)
            .padding(.top, 72)
            .padding(.bottom, Spacing.xl * 2)
            .animation(Motion.respond, value: model.step)
            .animation(.easeOut(duration: 0.2), value: model.errorMessage)
        }
        .scrollDismissesKeyboard(.interactively)
        .disabled(model.busy)
        .overlay {
            if model.busy {
                ProgressView().controlSize(.large).tint(.text)
            }
        }
        .accessibilityIdentifier("signin")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("Draft Room")
                .typeStyle(TypeScale.headline)
                .foregroundStyle(.text)
            Text("Your league, every week of the season: lineups, trades and the waiver wire, with the reasons.")
                .typeStyle(TypeScale.body)
                .fontWeight(.regular)
                .foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func choices(_ model: SignInModel) -> some View {
        @Bindable var model = model
        VStack(spacing: Spacing.md + Spacing.xs) {
            SignInWithAppleButton(.continue, onRequest: model.prepare) { result in
                Task { await model.finishApple(result) }
            }
            .signInWithAppleButtonStyle(.white)
            .frame(height: 50)
            .clipShape(RoundedRectangle(cornerRadius: Radius.dialog))
            .rise(shown, order: 1)

            Button {
                Task { await signInWithGoogle(model) }
            } label: {
                HStack(spacing: Spacing.md) {
                    Image("GoogleMark").resizable().frame(width: 18, height: 18)
                    Text("Continue with Google")
                }
            }
            .buttonStyle(ProviderButtonStyle())
            .rise(shown, order: 2)

            divider.rise(shown, order: 3)

            VStack(spacing: Spacing.md) {
                TextField("you@example.com", text: $model.email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .focused($emailFocused)
                    .onSubmit { if model.emailLooksValid { Task { await model.sendLink() } } }
                    .padding(.horizontal, Spacing.xl)
                    .frame(height: 50)
                    .background(.panel, in: RoundedRectangle(cornerRadius: Radius.dialog))
                    .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(emailFocused ? Color.focus : Color.line))
                    .foregroundStyle(.text)
                    .accessibilityIdentifier("signin-email")

                Button("Email me a sign-in link") {
                    Task { await model.sendLink() }
                }
                .buttonStyle(ProviderButtonStyle(prominent: true))
                .disabled(!model.emailLooksValid)
            }
            .rise(shown, order: 4)

            Text("No password. The link signs you in on this phone.")
                .typeStyle(TypeScale.label)
                .foregroundStyle(.dim)
                .frame(maxWidth: .infinity, alignment: .leading)
                .rise(shown, order: 5)
        }
    }

    private var divider: some View {
        HStack(spacing: Spacing.md) {
            Rectangle().fill(.line).frame(height: 1)
            Text("or").typeStyle(TypeScale.label).foregroundStyle(.dim)
            Rectangle().fill(.line).frame(height: 1)
        }
        .padding(.vertical, Spacing.xs)
    }

    private func signInWithGoogle(_ model: SignInModel) async {
        let start = model.googleStart
        do {
            let url = try await webAuthentication.authenticate(using: start.url, callback: start.callback, preferredBrowserSession: .ephemeral, additionalHeaderFields: [:])
            await model.finishGoogle(callbackURL: url)
        } catch {
            model.googleFailed(error)
        }
    }
}

/// "Check your inbox": the envelope lands, the address is confirmed, and Mail is a tap away.
private struct InboxView: View {
    let address: String
    let onChangeAddress: () -> Void
    @Environment(\.openURL) private var openURL
    @State private var landed = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Image(systemName: landed ? "envelope.badge" : "paperplane")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.sky)
                .contentTransition(.symbolEffect(.replace))
                .offset(x: landed ? 0 : -40, y: landed ? 0 : 20)
                .padding(.bottom, Spacing.sm)
            Text("Check your inbox.")
                .typeStyle(TypeScale.title)
                .foregroundStyle(.text)
            (Text("A sign-in link is on its way to ") + Text(address).foregroundStyle(.text).bold() + Text(". Open it on this phone and the app signs you in."))
                .typeStyle(TypeScale.body)
                .fontWeight(.regular)
                .foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
            Button("Open Mail") {
                if let mail = URL(string: "message://") { openURL(mail) }
            }
            .buttonStyle(ProviderButtonStyle(prominent: true))
            .padding(.top, Spacing.sm)
            Button("Use a different address", action: onChangeAddress)
                .typeStyle(TypeScale.label)
                .foregroundStyle(.muted)
        }
        .sensoryFeedback(Haptic.success, trigger: landed)
        .onAppear {
            withAnimation(.spring(duration: 0.6, bounce: 0.35).delay(0.15)) { landed = true }
        }
        .accessibilityIdentifier("signin-inbox")
    }
}

/// The sign-in buttons other than Apple's own: the same height and corners, in the room's colors.
struct ProviderButtonStyle: ButtonStyle {
    var prominent = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .typeStyle(TypeScale.title)
            .foregroundStyle(prominent ? Color.sky : Color.text)
            .multilineTextAlignment(.center)
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.lg)
            // At least 50 tall, and taller when the text needs two lines at the accessibility sizes.
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(configuration.isPressed ? Color.btnHover : Color.panel2, in: RoundedRectangle(cornerRadius: Radius.dialog))
            .overlay(RoundedRectangle(cornerRadius: Radius.dialog).stroke(prominent ? Color.skyLine : Color.line))
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

private extension View {
    /// Rises into place after the brand, one step after another.
    func rise(_ shown: Bool, order: Int) -> some View {
        offset(y: shown ? 0 : 16)
            .opacity(shown ? 1 : 0)
            .animation(Motion.stagger(order), value: shown)
    }
}

#Preview {
    SignInView()
        .environment(Session(api: APIClient(baseURL: URL(string: "http://localhost:3000")!)))
}
