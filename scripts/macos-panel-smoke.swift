@preconcurrency import AppKit
import SwiftUI
@testable import ScholiaMac

@main
@MainActor
struct PanelLayoutSmoke {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        Task { @MainActor in
            do {
                let smoke = PanelLayoutSmoke()
                try await smoke.testContentChangesCannotResizeAppKitOwnedPanel()
                try await smoke.testQuickChatPromptAndAnswerKeepTheirExplicitSizes()
                print("PASS: panel content updates, 12 resizes, and 3 Quick Chat prompt/answer cycles")
                exit(0)
            } catch {
                print("FAIL: \(error)")
                exit(1)
            }
        }
        app.run()
    }
    @MainActor
    func testContentChangesCannotResizeAppKitOwnedPanel() async throws {
        _ = NSApplication.shared
        let state = LayoutState()
        let panel = NSPanel(
            contentRect: NSRect(x: 100, y: 100, width: 520, height: 230),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isReleasedWhenClosed = false
        let controller = PanelContentController(
            rootView: ChangingContent(state: state),
            size: panel.frame.size
        )
        panel.contentViewController = controller
        panel.minSize = NSSize(width: 480, height: 200)
        panel.maxSize = NSSize(width: 680, height: 580)
        panel.orderFrontRegardless()
        defer { panel.close() }

        // Exercise actual display cycles: synchronous layoutIfNeeded alone misses
        // the windowDidLayout -> updateAnimatedWindowSize crash from macOS 27.
        for index in 0..<12 {
            let size = index.isMultiple(of: 2)
                ? NSSize(width: 520, height: 230)
                : NSSize(width: 640, height: 480)
            panel.setContentSize(size)
            let expectedFrame = panel.frame
            state.expanded.toggle()
            try await Task.sleep(for: .milliseconds(80))

            expectEqual(panel.frame, expectedFrame)
            expectEqual(panel.minSize, NSSize(width: 480, height: 200))
            expectEqual(panel.maxSize, NSSize(width: 680, height: 580))
            let hostedView = try unwrap(controller.view.subviews.first)
            expectEqual(hostedView.frame, controller.view.bounds)
        }
    }

    @MainActor
    func testQuickChatPromptAndAnswerKeepTheirExplicitSizes() async throws {
        _ = NSApplication.shared
        let controller = QuickAskPanelController(model: AppModel.shared)
        let panel = try unwrap(controller.window)
        defer {
            controller.hide()
            panel.orderOut(nil)
        }

        for _ in 0..<3 {
            controller.showPrompt()
            try await Task.sleep(for: .milliseconds(350))
            expectEqual(panel.frame.size, NSSize(width: 520, height: 320))
            expectEqual(panel.maxSize, panel.minSize)

            controller.showAnswer()
            try await Task.sleep(for: .milliseconds(350))
            precondition(panel.frame.width >= 480)
            precondition(panel.frame.height >= 420)
            precondition(panel.frame.width <= 680)
            precondition(panel.frame.height <= 580)
            precondition(panel.styleMask.contains(.resizable))
        }
    }
}

@MainActor
private final class LayoutState: ObservableObject {
    @Published var expanded = false
}

private struct ChangingContent: View {
    @ObservedObject var state: LayoutState

    var body: some View {
        VStack {
            Text(state.expanded ? String(repeating: "Wide content ", count: 30) : "Prompt")
                .fixedSize()
            if state.expanded {
                Color.clear.frame(width: 900, height: 700)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeInOut(duration: 0.04), value: state.expanded)
    }
}

private func expectEqual<T: Equatable>(_ actual: T, _ expected: T) {
    precondition(actual == expected, "Expected \(expected), got \(actual)")
}

private func unwrap<T>(_ value: T?) throws -> T {
    guard let value else { throw CocoaError(.validationMissingMandatoryProperty) }
    return value
}
