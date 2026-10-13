import Foundation
import Testing
@testable import DraftRoom

// Needs a signed build: unsigned simulator builds (CODE_SIGNING_ALLOWED=NO, before the Apple team
// exists) have no Keychain entitlement, and the test is skipped there.
@Suite(.serialized, .enabled(if: Keychain.isAvailable, "The Keychain needs a signed build"))
struct KeychainTests {
    let keychain = Keychain(service: "tech.apeman.draftroom.tests.\(UUID().uuidString)")

    @Test func roundTrips() throws {
        #expect(try keychain.string(for: "session") == nil)
        try keychain.set("first", for: "session")
        #expect(try keychain.string(for: "session") == "first")
        try keychain.set("second", for: "session")
        #expect(try keychain.string(for: "session") == "second")
        try keychain.remove("session")
        #expect(try keychain.string(for: "session") == nil)
        try keychain.remove("session")
    }
}
