@preconcurrency import ApplicationServices
import Foundation

enum SelectionReaderError: LocalizedError {
    case permissionRequired
    case noFocusedElement
    case noSelection

    var errorDescription: String? {
        switch self {
        case .permissionRequired:
            "Allow Scholia in System Settings → Privacy & Security → Accessibility."
        case .noFocusedElement:
            "Scholia could not read the focused application."
        case .noSelection:
            "Select some text in another app, then try again."
        }
    }
}

enum SelectionReader {
    static var isTrusted: Bool { AXIsProcessTrusted() }

    @discardableResult
    static func requestPermission() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    static func selectedText() throws -> String {
        guard isTrusted else { throw SelectionReaderError.permissionRequired }

        let system = AXUIElementCreateSystemWide()
        var focusedValue: CFTypeRef?
        let focusedResult = AXUIElementCopyAttributeValue(
            system,
            kAXFocusedUIElementAttribute as CFString,
            &focusedValue
        )
        guard focusedResult == .success, let focusedValue else {
            throw SelectionReaderError.noFocusedElement
        }

        let focused = focusedValue as! AXUIElement
        var selectionValue: CFTypeRef?
        let selectionResult = AXUIElementCopyAttributeValue(
            focused,
            kAXSelectedTextAttribute as CFString,
            &selectionValue
        )
        guard selectionResult == .success,
              let text = selectionValue as? String,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw SelectionReaderError.noSelection
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
