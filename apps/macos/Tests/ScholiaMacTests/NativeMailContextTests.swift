import Foundation
import XCTest
@testable import ScholiaMac

final class NativeMailContextTests: XCTestCase {
    func testRecognizesCommonNativeMailReadersWithoutClassifyingBrowsersAsMail() {
        XCTAssertTrue(NativeMailContext.isMailApplication(
            bundleIdentifier: "com.apple.mail",
            name: "Mail"
        ))
        XCTAssertTrue(NativeMailContext.isMailApplication(
            bundleIdentifier: "com.microsoft.Outlook",
            name: "Microsoft Outlook"
        ))
        XCTAssertTrue(NativeMailContext.isMailApplication(
            bundleIdentifier: "org.mozilla.thunderbird",
            name: "Thunderbird"
        ))
        XCTAssertFalse(NativeMailContext.isMailApplication(
            bundleIdentifier: "com.google.Chrome",
            name: "Google Chrome"
        ))
        XCTAssertFalse(NativeMailContext.isMailApplication(
            bundleIdentifier: "com.brave.Browser",
            name: "Brave Browser"
        ))
    }

    func testFormatsAccessibleConversationAsBoundedPrivateReference() throws {
        let context = try XCTUnwrap(NativeMailContext.formattedConversation(
            accessibleText: "From: Ada\nCould you send the revised plan?\n\nFrom: Me\nI can send it tomorrow.",
            selectedText: "Could you send the revised plan?",
            conversationTitle: "Re: Project plan"
        ))

        XCTAssertTrue(context.contains("Private email-thread reference"))
        XCTAssertTrue(context.contains("Conversation: Re: Project plan"))
        XCTAssertTrue(context.contains("Selected passage: Could you send the revised plan?"))
        XCTAssertTrue(context.contains("From: Ada"))
        XCTAssertLessThanOrEqual(context.utf16.count, NativeMailContext.maximumContextUTF16Units)
    }

    func testLongConversationKeepsTheSelectedAreaAndHonorsTheUTF16Limit() throws {
        let before = String(repeating: "old thread text ", count: 500)
        let after = String(repeating: "later thread text ", count: 500)
        let selected = "NEAR_BEFORE Please confirm Tuesday. NEAR_AFTER"
        let context = try XCTUnwrap(NativeMailContext.formattedConversation(
            accessibleText: before + selected + after,
            selectedText: selected,
            conversationTitle: "Schedule",
            maximumUTF16Units: 1_200
        ))

        XCTAssertTrue(context.contains("Please confirm Tuesday."))
        XCTAssertTrue(context.contains("NEAR_BEFORE"))
        XCTAssertTrue(context.contains("NEAR_AFTER"))
        XCTAssertLessThanOrEqual(context.utf16.count, 1_200)
    }

    func testReplyInstructionIsLocalized() {
        XCTAssertTrue(NativeMailContext.defaultReplyQuestion(language: "en").hasPrefix("Draft"))
        XCTAssertTrue(NativeMailContext.defaultReplyQuestion(language: "no").hasPrefix("Skriv"))
    }
}
