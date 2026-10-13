import OSLog
import SwiftUI
import WebKit

/// ESPN's own sign-in page (Disney OneID) in a web view the app controls. Non-persistent: nothing
/// ESPN sets survives the sheet. When both login cookies appear, they're handed over and the
/// sheet closes. The cookies are never written to disk or logged.
struct EspnSignInView: UIViewRepresentable {
    let onLogin: @MainActor (EspnLogin) -> Void

    static let signInURL = URL(string: "https://www.espn.com/login")!

    func makeCoordinator() -> Coordinator { Coordinator(onLogin: onLogin) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        // Present as Safari: some sign-in pages refuse embedded browsers they can't identify.
        configuration.applicationNameForUserAgent = "Version/18.0 Mobile/15E148 Safari/604.1"
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        context.coordinator.watch(configuration.websiteDataStore.httpCookieStore)
        webView.load(URLRequest(url: Self.signInURL))
        return webView
    }

    func updateUIView(_: WKWebView, context _: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.stop(webView.configuration.websiteDataStore.httpCookieStore)
    }

    @MainActor
    final class Coordinator: NSObject, WKHTTPCookieStoreObserver, WKNavigationDelegate {
        /// Where ESPN's sign-in goes, host and path only, for working out sign-in problems. Never cookies or query strings.
        private nonisolated static let log = Logger(subsystem: "tech.apeman.draftroom", category: "espn-signin")

        private let onLogin: @MainActor (EspnLogin) -> Void
        private var delivered = false

        init(onLogin: @escaping @MainActor (EspnLogin) -> Void) {
            self.onLogin = onLogin
        }

        func watch(_ store: WKHTTPCookieStore) {
            store.add(self)
        }

        func stop(_ store: WKHTTPCookieStore) {
            store.remove(self)
        }

        nonisolated func webView(_ webView: WKWebView, didFinish _: WKNavigation!) {
            Task { @MainActor in
                Self.log.info("loaded \(webView.url?.host() ?? "?", privacy: .public)\(webView.url?.path() ?? "", privacy: .public)")
            }
        }

        nonisolated func webView(_: WKWebView, didFail _: WKNavigation!, withError error: any Error) {
            Self.log.error("failed: \(error.localizedDescription, privacy: .public)")
        }

        nonisolated func webView(_: WKWebView, didFailProvisionalNavigation _: WKNavigation!, withError error: any Error) {
            Self.log.error("failed to start: \(error.localizedDescription, privacy: .public)")
        }

        /// The "signed in" signal: espn_s2 and SWID both present for espn.com.
        nonisolated func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
            Task { @MainActor in
                let cookies = await cookieStore.allCookies()
                guard !self.delivered, let login = EspnCookies.login(from: cookies) else { return }
                self.delivered = true
                self.onLogin(login)
            }
        }
    }
}

enum EspnCookies {
    /// The login, once ESPN has set both cookies on its own domain.
    static func login(from cookies: [HTTPCookie]) -> EspnLogin? {
        let espn = cookies.filter { $0.domain.hasSuffix("espn.com") }
        guard
            let s2 = espn.first(where: { $0.name == "espn_s2" })?.value, !s2.isEmpty,
            let swid = espn.first(where: { $0.name == "SWID" })?.value, swid.wholeMatch(of: /\{[0-9A-Fa-f-]{36}\}/) != nil
        else { return nil }
        return EspnLogin(espnS2: s2, swid: swid)
    }
}
