import OSLog
import SwiftUI
import WebKit

/// ESPN's own sign-in (MyDisney) in a web view the app controls. Non-persistent: nothing ESPN sets
/// survives the sheet. When both login cookies appear, they're handed over and the sheet closes.
/// The cookies are never written to disk or logged.
struct EspnSignInView: UIViewRepresentable {
    let onLogin: @MainActor (EspnLogin) -> Void
    /// The user closed ESPN's sign-in without signing in.
    var onClose: @MainActor () -> Void = {}
    /// MyDisney is on screen, or couldn't be opened and ESPN's page is all there is.
    var onReady: @MainActor () -> Void = {}

    /// An espn.com page, for ESPN's own MyDisney sign-in (OneID v4). `/login` still opens the
    /// older OneID lightbox, so the app opens this page and starts sign-in with `launchScript`.
    static let signInURL = URL(string: "https://www.espn.com/fantasy/football/")!
    static let messageName = "espnSignIn"

    /// Opens MyDisney once ESPN has set up OneID (`window.did`), as the page's own "Log In" does, and
    /// reports back when it's closed or finished. Does nothing once signed in.
    static let launchScript = """
    (() => {
      if (document.cookie.includes('espn_s2=')) return;
      const post = (event) => window.webkit.messageHandlers.\(messageName).postMessage(event);
      let tries = 0;
      let listening = false;
      // ESPN creates window.did before OneID has finished starting, and launchLogin() rejects
      // until it has, so keep trying for up to 20 seconds.
      const attempt = () => {
        const did = window.did;
        if (!did || typeof did.launchLogin !== 'function') return retry('no OneID');
        if (!listening && typeof did.on === 'function') {
          listening = true;
          did.on('login', () => post('login'));
          did.on('close', () => post('close'));
        }
        Promise.resolve(did.launchLogin()).catch((error) => retry(String((error && (error.message || error.type || error.code)) || error)));
        watchShown();
      };
      // MyDisney draws in an iframe from registerdisney.go.com. Once one is on screen, the app can stop
      // covering ESPN's page.
      let watching = false;
      const watchShown = () => {
        if (watching) return;
        watching = true;
        const check = setInterval(() => {
          const frame = [...document.querySelectorAll('iframe')].find((f) => {
            if (!/registerdisney/.test(f.src || '')) return false;
            const box = f.getBoundingClientRect();
            const style = getComputedStyle(f);
            return box.height > 200 && box.width > 200 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
          });
          if (frame) {
            clearInterval(check);
            post('shown');
          }
        }, 100);
      };
      const retry = (reason) => {
        if (++tries > 40) return post('failed: ' + reason);
        setTimeout(attempt, 500);
      };
      attempt();
    })();
    """

    func makeCoordinator() -> Coordinator { Coordinator(onLogin: onLogin, onClose: onClose, onReady: onReady) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        // Present as Safari: some sign-in pages refuse embedded browsers they can't identify.
        configuration.applicationNameForUserAgent = "Version/18.0 Mobile/15E148 Safari/604.1"
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.launchScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
        configuration.userContentController.add(context.coordinator, name: Self.messageName)
        let webView = WKWebView(frame: .zero, configuration: configuration)
        #if DEBUG
        // Safari's Develop menu can inspect ESPN's page, for working out sign-in problems.
        webView.isInspectable = true
        #endif
        webView.navigationDelegate = context.coordinator
        context.coordinator.watch(configuration.websiteDataStore.httpCookieStore)
        webView.load(URLRequest(url: Self.signInURL))
        return webView
    }

    func updateUIView(_: WKWebView, context _: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: messageName)
        coordinator.stop(webView.configuration.websiteDataStore.httpCookieStore)
    }

    @MainActor
    final class Coordinator: NSObject, WKHTTPCookieStoreObserver, WKNavigationDelegate, WKScriptMessageHandler {
        /// Where ESPN's sign-in goes, host and path only, for working out sign-in problems. Never cookies or query strings.
        private nonisolated static let log = Logger(subsystem: "tech.apeman.draftroom", category: "espn-signin")

        private let onLogin: @MainActor (EspnLogin) -> Void
        private let onClose: @MainActor () -> Void
        private let onReady: @MainActor () -> Void
        private var delivered = false
        #if DEBUG
        private var lastSeen = ""
        #endif

        init(onLogin: @escaping @MainActor (EspnLogin) -> Void, onClose: @escaping @MainActor () -> Void, onReady: @escaping @MainActor () -> Void) {
            self.onLogin = onLogin
            self.onClose = onClose
            self.onReady = onReady
        }

        func watch(_ store: WKHTTPCookieStore) {
            store.add(self)
        }

        func stop(_ store: WKHTTPCookieStore) {
            store.remove(self)
        }

        /// The "signed in" signal: espn_s2 and SWID both present for espn.com. Checked on every cookie
        /// change, page load and message from the page, since the cookie observer alone can miss it.
        private func check(_ store: WKHTTPCookieStore) async {
            guard !delivered else { return }
            let cookies = await store.allCookies()
            #if DEBUG
            let has = { (name: String) in cookies.contains { $0.domain.hasSuffix("espn.com") && $0.name == name } }
            let seen = "SWID \(has("SWID") ? "yes" : "no"), espn_s2 \(has("espn_s2") ? "yes" : "no")"
            if seen != lastSeen {
                lastSeen = seen
                Self.log.debug("cookies \(seen, privacy: .public)")
            }
            #endif
            guard !delivered, let login = EspnCookies.login(from: cookies) else { return }
            delivered = true
            onLogin(login)
        }

        nonisolated func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
            Task { @MainActor in await self.check(cookieStore) }
        }

        nonisolated func webView(_ webView: WKWebView, didFinish _: WKNavigation!) {
            Task { @MainActor in
                Self.log.info("loaded \(webView.url?.host() ?? "?", privacy: .public)\(webView.url?.path() ?? "", privacy: .public)")
                await self.check(webView.configuration.websiteDataStore.httpCookieStore)
            }
        }

        nonisolated func webView(_: WKWebView, didFail _: WKNavigation!, withError error: any Error) {
            Self.log.error("failed: \(error.localizedDescription, privacy: .public)")
        }

        nonisolated func webView(_: WKWebView, didFailProvisionalNavigation _: WKNavigation!, withError error: any Error) {
            Self.log.error("failed to start: \(error.localizedDescription, privacy: .public)")
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            let event = message.body as? String ?? ""
            Self.log.info("sign-in \(event, privacy: .public)")
            switch event {
            case "shown":
                onReady()
            case _ where event.hasPrefix("failed"):
                // No MyDisney: show ESPN's page, whose own Log In button is the way left.
                onReady()
            case "close":
                // MyDisney's own close button leaves a bare ESPN page; go back to the app instead.
                Task { @MainActor in
                    guard let webView = message.webView else { return }
                    await self.check(webView.configuration.websiteDataStore.httpCookieStore)
                    if !self.delivered { self.onClose() }
                }
            default:
                guard let webView = message.webView else { return }
                Task { @MainActor in await self.check(webView.configuration.websiteDataStore.httpCookieStore) }
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
