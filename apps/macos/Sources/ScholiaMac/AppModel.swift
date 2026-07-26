import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var request: ExplainRequest?
    @Published var status = "Select text in any app to begin."
    @Published var accessibilityGranted = SelectionReader.isTrusted

    @discardableResult
    func captureSelectedText() -> Bool {
        do {
            let text = try SelectionReader.selectedText()
            request = ExplainRequest(kind: .text, question: "Explain this.", selection: text)
            status = "Selection captured."
            accessibilityGranted = true
            return true
        } catch {
            status = error.localizedDescription
            accessibilityGranted = SelectionReader.isTrusted
            return false
        }
    }

    func requestAccessibility() {
        accessibilityGranted = SelectionReader.requestPermission()
        status = accessibilityGranted ? "Accessibility access is ready." : "Approve Accessibility access in System Settings."
    }
}
