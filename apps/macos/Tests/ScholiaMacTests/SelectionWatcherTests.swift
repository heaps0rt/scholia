import Foundation
import XCTest
@testable import ScholiaMac

final class SelectionWatcherTests: XCTestCase {
    func testClearedSelectionHidesPopupAndAllowsSameTextToShowAgain() {
        var state = SelectionWatcherState()
        let now = Date()

        XCTAssertEqual(state.update(text: "marked text", pid: 42, now: now), .show)
        XCTAssertEqual(state.update(text: "marked text", pid: 42, now: now.addingTimeInterval(0.5)), .unchanged)
        XCTAssertEqual(state.update(text: "marked text", pid: 42, now: now.addingTimeInterval(30)), .unchanged)
        XCTAssertEqual(state.update(text: nil, pid: 42, now: now.addingTimeInterval(0.75)), .hide)
        XCTAssertEqual(state.update(text: "marked text", pid: 42, now: now.addingTimeInterval(1)), .show)
    }

    func testSameWordsAtDifferentSelectionBoundsAreTreatedAsANewSelection() {
        var state = SelectionWatcherState()
        let firstBounds = CGRect(x: 20, y: 30, width: 120, height: 18)
        let secondBounds = CGRect(x: 20, y: 130, width: 120, height: 18)

        XCTAssertEqual(state.update(text: "repeated phrase", pid: 42, bounds: firstBounds), .show)
        XCTAssertEqual(state.update(text: "repeated phrase", pid: 42, bounds: firstBounds), .unchanged)
        XCTAssertEqual(state.update(text: "repeated phrase", pid: 42, bounds: secondBounds), .show)
    }

    func testHandledSelectionStaysHiddenUntilItChangesOrSuppressionExpires() {
        var state = SelectionWatcherState()
        let now = Date()
        let bounds = CGRect(x: 20, y: 30, width: 120, height: 18)

        XCTAssertEqual(state.update(text: "reply to this", pid: 42, bounds: bounds, now: now), .show)
        state.suppress(text: "reply to this", pid: 42, bounds: bounds, now: now)
        XCTAssertEqual(
            state.update(text: nil, pid: 42, now: now.addingTimeInterval(1)),
            .hide
        )
        XCTAssertEqual(
            state.update(
                text: "reply to this",
                pid: 42,
                bounds: bounds,
                now: now.addingTimeInterval(2)
            ),
            .hide
        )
        XCTAssertEqual(
            state.update(
                text: "a new selection",
                pid: 42,
                bounds: bounds.offsetBy(dx: 0, dy: 40),
                now: now.addingTimeInterval(3)
            ),
            .show
        )

        state.suppress(text: "reply to this", pid: 42, bounds: bounds, now: now)
        _ = state.update(text: nil, pid: 42, now: now.addingTimeInterval(31))
        XCTAssertEqual(
            state.update(
                text: "reply to this",
                pid: 42,
                bounds: bounds,
                now: now.addingTimeInterval(32)
            ),
            .show
        )
    }

    func testSelectionTooShortForPopupIsTreatedAsCleared() {
        var state = SelectionWatcherState()

        XCTAssertEqual(state.update(text: "x", pid: 42), .hide)
        XCTAssertEqual(state.update(text: "", pid: 42), .hide)
    }

    func testEditableControlSelectionCanBeRecoveredFromValueAndUTF16Range() {
        let value = "Mail draft: explain this selected sentence, please."
        let prefix = "Mail draft: "
        let selection = "explain this selected sentence"
        let range = CFRange(
            location: prefix.utf16.count,
            length: selection.utf16.count
        )

        XCTAssertEqual(
            SelectionReader.boundedTextSelection(in: value, range: range),
            selection
        )
    }

    func testEditableControlSelectionRejectsEmptyAndInvalidRanges() {
        XCTAssertNil(SelectionReader.boundedTextSelection(
            in: "Draft text",
            range: CFRange(location: 0, length: 0)
        ))
        XCTAssertNil(SelectionReader.boundedTextSelection(
            in: "Draft text",
            range: CFRange(location: 200, length: 5)
        ))
    }

    func testEditableControlSelectionIsBoundedBeforeItReachesThePopup() {
        let value = String(repeating: "x", count: 100_000)
        let selected = SelectionReader.boundedTextSelection(
            in: value,
            range: CFRange(location: 0, length: value.utf16.count)
        )

        XCTAssertEqual(selected?.utf16.count, TextInputPolicy.maximumMessageUTF16Units)

        let unicodeBoundary = String(repeating: "x", count: 30_000) + "🧠"
        XCTAssertEqual(
            SelectionReader.boundedTextSelection(
                in: unicodeBoundary,
                range: CFRange(location: 0, length: unicodeBoundary.utf16.count),
                maximumUTF16Units: 30_001
            ),
            String(repeating: "x", count: 30_000)
        )
    }
}
