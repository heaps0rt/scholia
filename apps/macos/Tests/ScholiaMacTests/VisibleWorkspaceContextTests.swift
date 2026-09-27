import XCTest
@testable import ScholiaMac

final class VisibleWorkspaceContextTests: XCTestCase {
    private func window(
        _ application: String,
        title: String,
        text: String = "",
        tabs: [String] = [],
        index: Int,
        preferred: Bool = false
    ) -> VisibleWindowContext {
        VisibleWindowContext(
            applicationName: application,
            applicationBundleIdentifier: "test.\(application.lowercased())",
            applicationPID: pid_t(index + 100),
            windowTitle: title,
            sourceURL: nil,
            accessibleText: text,
            openTabTitles: tabs,
            frontToBackIndex: index,
            isPreferred: preferred
        )
    }

    func testOpenBrowserTabsAreCorrelatedWithVisibleScreenText() throws {
        let context = try XCTUnwrap(VisibleWorkspaceContext.formatted(
            candidates: [window(
                "Chromium",
                title: "Cell biology lecture",
                text: "Oxidative phosphorylation and a proton gradient are visible",
                tabs: ["Shopping basket", "Mitochondrial membrane notes", "Weather"],
                index: 0,
                preferred: true
            )],
            question: "How does the mitochondrial membrane produce ATP?"
        ))

        XCTAssertTrue(context.contains("Open browser tabs correlated with this screen"))
        XCTAssertTrue(context.contains("Mitochondrial membrane notes"))
    }

    func testSelectionKeepsActiveWindowAndFindsRelevantVisibleText() {
        let candidates = [
            window("Safari", title: "Documentation", text: "API reference", index: 0, preferred: true),
            window("Mail", title: "Inbox", text: "Lunch plans", index: 1),
            window("Numbers", title: "Forecast", text: "Quarterly budget revenue expenses", index: 4)
        ]

        let selected = VisibleWorkspaceContext.selectedWindows(
            from: candidates,
            question: "How should I revise the quarterly budget?"
        )

        XCTAssertEqual(selected.map(\.applicationName), ["Safari", "Numbers"])
    }

    func testExplicitScreenQuestionIncludesSeveralFrontmostWindows() {
        let candidates = [
            window("Safari", title: "Paper", index: 0, preferred: true),
            window("Preview", title: "Chart.pdf", index: 1),
            window("Notes", title: "Results", index: 2),
            window("Mail", title: "Inbox", index: 3)
        ]

        let selected = VisibleWorkspaceContext.selectedWindows(
            from: candidates,
            question: "Compare what is open on this screen"
        )

        XCTAssertEqual(selected.map(\.applicationName), ["Safari", "Preview", "Notes"])
    }

    func testFirstQuickChatIncludesVisibleChatGptDesktopContext() {
        let candidates = [
            window("Safari", title: "Reference", text: "Unrelated page", index: 0, preferred: true),
            window("Notes", title: "Scratchpad", text: "Unrelated notes", index: 1),
            window("ChatGPT", title: "Planning chat", text: "Important prior conversation", index: 8)
        ]

        let ordinary = VisibleWorkspaceContext.selectedWindows(
            from: candidates,
            question: "Explain the selected paragraph"
        )
        let firstQuickChat = VisibleWorkspaceContext.selectedWindows(
            from: candidates,
            question: "Explain the selected paragraph",
            includeChatGptDesktopContext: true
        )

        XCTAssertFalse(ordinary.contains(where: { $0.applicationName == "ChatGPT" }))
        XCTAssertEqual(firstQuickChat.map(\.applicationName), ["Safari", "ChatGPT"])
    }

    func testFormattedWorkspaceIsBoundedAndAttachedAsSourceContext() throws {
        let oversized = String(repeating: "visible evidence ", count: 2_000)
        let context = try XCTUnwrap(VisibleWorkspaceContext.formatted(
            candidates: [window("Preview", title: "Study.pdf", text: oversized, index: 0, preferred: true)],
            question: "Summarize the study"
        ))
        XCTAssertLessThanOrEqual(context.count, VisibleWorkspaceContext.maximumContextCharacters)
        XCTAssertTrue(context.contains("active before Scholia"))

        let capture = try XCTUnwrap(VisibleWorkspaceContext.attaching(context, to: nil))
        let prompt = PromptBuilder.initialUserPrompt(
            question: "Summarize this",
            capture: capture,
            language: "en"
        )
        XCTAssertTrue(prompt.contains("Relevant visible workspace"))
        XCTAssertTrue(prompt.contains("<scholia-context>"))
    }

    func testAttachedWorkspaceKeepsBothExistingAndOnScreenContextWithinPromptBudget() throws {
        let capture = CapturedContent(
            kind: .text,
            context: "existing-marker\n" + String(repeating: "existing source ", count: 3_000)
        )
        let workspace = "workspace-marker\n" + String(repeating: "visible source ", count: 2_000)

        let enriched = try XCTUnwrap(VisibleWorkspaceContext.attaching(workspace, to: capture))
        let context = try XCTUnwrap(enriched.context)

        XCTAssertTrue(context.contains("existing-marker"))
        XCTAssertTrue(context.contains("workspace-marker"))
        XCTAssertLessThanOrEqual(
            context.utf16.count,
            VisibleWorkspaceContext.maximumAttachedContextUTF16Units
        )
    }

    func testDisabledAutomaticContextKeepsExplicitSelectionAndDropsSurroundingContext() throws {
        let capture = CapturedContent(
            kind: .text,
            text: "Explicitly selected paragraph",
            applicationName: "Preview",
            windowTitle: "Private.pdf",
            sourceURL: "file:///private.pdf",
            context: "Automatically captured surrounding window",
            parentContext: "Explicitly selected parent answer"
        )

        let request = try XCTUnwrap(VisibleWorkspaceContext.requestCapture(
            capture,
            workspaceContext: "Other visible windows",
            automaticContextEnabled: false
        ))

        XCTAssertEqual(request.text, "Explicitly selected paragraph")
        XCTAssertNil(request.context)
        XCTAssertNil(request.applicationName)
        XCTAssertNil(request.applicationBundleIdentifier)
        XCTAssertNil(request.applicationPID)
        XCTAssertNil(request.windowTitle)
        XCTAssertNil(request.sourceURL)
        XCTAssertEqual(request.parentContext, "Explicitly selected parent answer")
    }

    func testEnabledAutomaticContextStillBoundsAnExistingSourceWithoutWorkspaceText() throws {
        let capture = CapturedContent(
            kind: .text,
            text: "Selected paragraph",
            context: String(repeating: "surrounding source ", count: 2_000)
        )

        let request = try XCTUnwrap(VisibleWorkspaceContext.requestCapture(
            capture,
            workspaceContext: nil,
            automaticContextEnabled: true
        ))

        XCTAssertLessThanOrEqual(
            try XCTUnwrap(request.context).utf16.count,
            VisibleWorkspaceContext.maximumAttachedContextUTF16Units
        )
    }

    func testFullContextKeepsThePreviousLargerSourceBudget() throws {
        let fullText = "full-marker\n" + String(repeating: "complete source context ", count: 700)
        let request = try XCTUnwrap(VisibleWorkspaceContext.requestCapture(
            nil,
            workspaceContext: nil,
            automaticContextEnabled: true,
            compactContextEnabled: false,
            fullApplicationContext: ApplicationContextSnapshot(
                applicationName: "Safari",
                applicationBundleIdentifier: "com.apple.Safari",
                applicationPID: 42,
                windowTitle: "Full source",
                sourceURL: "https://example.test/full",
                context: fullText
            )
        ))

        XCTAssertEqual(request.context, fullText)
        XCTAssertGreaterThan(try XCTUnwrap(request.context).utf16.count, 8_000)
    }

    func testLegacySettingsEnableWorkspaceContextByDefault() throws {
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(AppSettings())) as? [String: Any]
        )
        object.removeValue(forKey: "useVisibleWorkspaceContext")
        var decoded = try JSONDecoder().decode(
            AppSettings.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
        XCTAssertTrue(decoded.resolvedUseVisibleWorkspaceContext)
        decoded.normalize()
        XCTAssertEqual(decoded.useVisibleWorkspaceContext, true)
    }
}
