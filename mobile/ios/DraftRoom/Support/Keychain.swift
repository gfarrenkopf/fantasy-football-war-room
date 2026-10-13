import Foundation
import Security

/// A small wrapper over the Keychain for one kind of secret: generic passwords under one service.
/// The app keeps exactly one thing here, its session token.
struct Keychain: Sendable {
    let service: String

    init(service: String = "tech.apeman.draftroom") {
        self.service = service
    }

    enum Failure: Error, Equatable {
        case status(OSStatus)
    }

    /// False in builds that can't reach the Keychain: unsigned simulator builds lack the entitlement.
    static var isAvailable: Bool {
        let probe = Keychain(service: "tech.apeman.draftroom.probe")
        do {
            try probe.set("x", for: "probe")
            try probe.remove("probe")
            return true
        } catch {
            return false
        }
    }

    func string(for account: String) throws(Failure) -> String? {
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw Failure.status(status) }
        return String(data: data, encoding: .utf8)
    }

    /// Stores the value, readable after the phone's first unlock since boot, so background work
    /// (push, refresh) can use it. Never synced to other devices.
    func set(_ value: String, for account: String) throws(Failure) {
        let data = Data(value.utf8)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(base(account) as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = base(account)
            add.merge(update) { _, new in new }
            let added = SecItemAdd(add as CFDictionary, nil)
            guard added == errSecSuccess else { throw Failure.status(added) }
        } else if status != errSecSuccess {
            throw Failure.status(status)
        }
    }

    func remove(_ account: String) throws(Failure) {
        let status = SecItemDelete(base(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure.status(status) }
    }

    private func base(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

/// Where the API client gets and keeps the session token. The Keychain in the app; memory in tests.
protocol TokenStore: AnyObject, Sendable {
    func token() -> String?
    func setToken(_ token: String?)
}

final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    private let keychain: Keychain
    private static let account = "session"
    #if DEBUG
    /// Unsigned simulator builds (no Apple team yet) have no Keychain access: errSecMissingEntitlement.
    /// Debug builds then keep the token in memory, so signing in still works until the app quits.
    private var memory: String?
    private var keychainMissing = false
    #endif

    init(keychain: Keychain = Keychain()) {
        self.keychain = keychain
    }

    func token() -> String? {
        #if DEBUG
        if keychainMissing { return memory }
        #endif
        return try? keychain.string(for: Self.account)
    }

    func setToken(_ token: String?) {
        do {
            if let token {
                try keychain.set(token, for: Self.account)
            } else {
                try keychain.remove(Self.account)
            }
        } catch {
            #if DEBUG
            if error == .status(errSecMissingEntitlement) {
                keychainMissing = true
                memory = token
            }
            #endif
        }
    }
}
