@preconcurrency import Security
import Foundation

enum KeychainStoreError: LocalizedError {
    case unexpectedStatus(OSStatus)

    var needsInteraction: Bool {
        switch self {
        case .unexpectedStatus(let status):
            [errSecInteractionNotAllowed, errSecAuthFailed, errSecUserCanceled].contains(status)
        }
    }

    var errorDescription: String? {
        switch self {
        case .unexpectedStatus(let status):
            if status == errSecInteractionNotAllowed {
                return "The saved credential needs Keychain access. Reconnect to allow access."
            }
            if status == errSecAuthFailed {
                return "Keychain could not authorize access to the saved credential. Allow Keychain access to retry."
            }
            if status == errSecUserCanceled {
                return "Keychain access was canceled. Allow Keychain access when you’re ready."
            }
            let detail = SecCopyErrorMessageString(status, nil) as String? ?? "Unknown Keychain error"
            return "Keychain: \(detail)."
        }
    }
}

enum ProviderKeychain {
    private static let service = "app.scholia.macos.provider-credentials"
    private static let lock = NSLock()
    private static let queue = DispatchQueue(label: "app.scholia.keychain", qos: .utility)

    // These existing credentials live in the macOS file keychain. The newer
    // authentication-context flag alone does not suppress its legacy ACL UI.
    // Serialize every access while temporarily disabling interaction, and always
    // restore the previous setting. Access checks still apply and may fail.
    private static func access<T>(allowInteraction: Bool, _ body: () throws -> T) throws -> T {
        // An interactive reconnect may wait for macOS indefinitely. UI and
        // browser-state reads must not block the main thread behind that prompt.
        if Thread.isMainThread {
            guard lock.try() else { throw KeychainStoreError.unexpectedStatus(errSecInteractionNotAllowed) }
        } else {
            lock.lock()
        }
        defer { lock.unlock() }
        var previous = DarwinBoolean(true)
        if !allowInteraction {
            let status = SecKeychainGetUserInteractionAllowed(&previous)
            guard status == errSecSuccess else { throw KeychainStoreError.unexpectedStatus(status) }
            let changed = SecKeychainSetUserInteractionAllowed(false)
            guard changed == errSecSuccess else { throw KeychainStoreError.unexpectedStatus(changed) }
        }
        defer { if !allowInteraction { SecKeychainSetUserInteractionAllowed(previous.boolValue) } }
        return try body()
    }

    static func valueAsync(for providerID: String, allowInteraction: Bool = false) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                continuation.resume(with: Result { try value(for: providerID, allowInteraction: allowInteraction) })
            }
        }
    }

    static func setAsync(_ value: String, for providerID: String, allowInteraction: Bool = false) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                continuation.resume(with: Result { try set(value, for: providerID, allowInteraction: allowInteraction) })
            }
        }
    }

    static func value(for providerID: String, allowInteraction: Bool = true) throws -> String {
        try access(allowInteraction: allowInteraction) {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: providerID,
                kSecMatchLimit as String: kSecMatchLimitOne,
                kSecReturnData as String: true
            ]
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            if status == errSecItemNotFound { return "" }
            guard status == errSecSuccess else { throw KeychainStoreError.unexpectedStatus(status) }
            guard let data = result as? Data else { return "" }
            return String(data: data, encoding: .utf8) ?? ""
        }
    }

    static func set(_ value: String, for providerID: String, allowInteraction: Bool = true) throws {
        try access(allowInteraction: allowInteraction) {
            let base: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: providerID
            ]
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                let status = SecItemDelete(base as CFDictionary)
                if status != errSecSuccess && status != errSecItemNotFound {
                    throw KeychainStoreError.unexpectedStatus(status)
                }
                return
            }

            let data = Data(trimmed.utf8)
            let updateStatus = SecItemUpdate(
                base as CFDictionary,
                [kSecValueData as String: data] as CFDictionary
            )
            if updateStatus == errSecSuccess { return }
            guard updateStatus == errSecItemNotFound else {
                throw KeychainStoreError.unexpectedStatus(updateStatus)
            }

            var insert = base
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(insert as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw KeychainStoreError.unexpectedStatus(addStatus) }
        }
    }
}
