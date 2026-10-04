import Foundation
import XCTest
@testable import ScholiaMac

final class StudyExamPlannerTests: XCTestCase {
    private func exam(_ id: String, date: String = "2026-12-15", start: String = "09:00", end: String = "13:00", selected: Bool = true) -> StudyExam {
        StudyExam(id: id, courseCode: "TDT4100", courseName: "Programming", component: "Final exam", date: date,
            startTime: start, endTime: end, selected: selected)
    }

    func testOverlapBoundariesSelectionAndUnknownTimes() {
        let first = exam("one")
        XCTAssertTrue(StudyExamPlanner.collisions([first, exam("two", start: "13:00", end: "15:00")]).isEmpty)
        XCTAssertTrue(StudyExamPlanner.collisions([first, exam("two", selected: false)]).isEmpty)
        XCTAssertTrue(StudyExamPlanner.collisions([first, exam("two", date: "2026-12-16", start: "", end: "")]).isEmpty)
        XCTAssertEqual(StudyExamPlanner.collisions([first, exam("two", start: "12:59", end: "15:00")]).first?.possible, false)
        XCTAssertEqual(StudyExamPlanner.collisions([first, exam("two", start: "", end: "")]).first?.possible, true)
        XCTAssertTrue(StudyExamPlanner.collisions([first, exam("two", date: "", start: "", end: "")]).isEmpty)
    }

    func testOvernightAndLongExams() throws {
        var overnight = exam("night", start: "22:00", end: "02:00")
        XCTAssertThrowsError(try StudyExamPlanner.normalized([overnight]))
        overnight.endDate = "2026-12-16"
        XCTAssertNoThrow(try StudyExamPlanner.normalized([overnight]))
        XCTAssertEqual(StudyExamPlanner.collisions([overnight, exam("morning", date: "2026-12-16", start: "01:00", end: "03:00")]).first?.possible, false)
        XCTAssertTrue(StudyExamPlanner.collisions([overnight, exam("morning", date: "2026-12-16", start: "02:00", end: "03:00")]).isEmpty)
    }

    func testFlexibleComparisonDisappearsOnceBothExamsAreSelected() throws {
        let fixed = exam("written")
        var flexible = exam("oral")
        flexible.courseCode = "TMA4100"
        let original = [fixed, flexible]
        let pair = try XCTUnwrap(StudyExamPlanAnalysis(original).choices.first)
        let adjusted = try StudyExamPlanner.setFlexibleTiming(original, id: flexible.id, flexible: true)
        XCTAssertTrue(StudyExamPlanAnalysis(adjusted).conflicts.isEmpty)
        XCTAssertTrue(StudyExamPlanAnalysis(adjusted).choices.isEmpty, "Both selected exams fit, so no choice remains.")

        let setAside = try StudyExamPlanner.setSelected(adjusted, id: fixed.id, selected: false)
        XCTAssertEqual(StudyExamPlanAnalysis(setAside).choices, [pair], "The fixed exam stays available to choose.")
        let chosen = try StudyExamPlanner.setSelected(setAside, id: fixed.id, selected: true)
        XCTAssertEqual(chosen, adjusted, "Selecting the fixed exam must retain the flexible exam and its timing.")
        XCTAssertTrue(StudyExamPlanAnalysis(chosen).choices.isEmpty, "Selecting the remaining exam resolves the choice.")
        let reloaded = try JSONDecoder().decode([StudyExam].self, from: JSONEncoder().encode(chosen))
        XCTAssertTrue(StudyExamPlanAnalysis(reloaded).choices.isEmpty, "Resolved pairs stay hidden after reopening.")
        XCTAssertEqual(StudyExamPlanAnalysis(reloaded).selected.count, 2)

        let bothFlexible = try StudyExamPlanner.setFlexibleTiming(chosen, id: fixed.id, flexible: true)
        XCTAssertTrue(StudyExamPlanAnalysis(bothFlexible).choices.isEmpty)
        let flexibleSetAside = try StudyExamPlanner.setSelected(chosen, id: flexible.id, selected: false)
        XCTAssertEqual(StudyExamPlanAnalysis(flexibleSetAside).choices, [pair], "Either exam can still be selected independently.")
        let neitherSelected = try StudyExamPlanner.setSelected(setAside, id: flexible.id, selected: false)
        XCTAssertTrue(StudyExamPlanAnalysis(neitherSelected).choices.isEmpty)

        let reverted = try StudyExamPlanner.setFlexibleTiming(chosen, id: flexible.id, flexible: false)
        XCTAssertEqual(StudyExamPlanAnalysis(reverted).conflicts, [pair])
        XCTAssertEqual(StudyExamPlanAnalysis(reverted).choices, [pair], "Restoring fixed timing brings the choice back.")
        XCTAssertTrue(StudyExamPlanAnalysis([chosen[0]]).choices.isEmpty)
        XCTAssertThrowsError(try StudyExamPlanner.setSelected(chosen, id: "removed", selected: true))

        var third = exam("third"); third.courseCode = "TFE4100"
        let remaining = StudyExamPlanAnalysis(chosen + [third])
        XCTAssertEqual(remaining.conflicts, StudyExamPlanner.collisions([fixed, third]), "Unrelated fixed overlaps still need resolving.")
        XCTAssertEqual(remaining.choices, remaining.conflicts, "Only the remaining fixed-time overlap needs a choice.")
    }

    func testIndividualCourseExamSelectionPreservesOtherComponents() throws {
        var midterm = exam("midterm", date: "2026-10-09", start: "09:00", end: "11:00")
        midterm.courseCode = "TTK4250"; midterm.component = "Midterm"; midterm.kind = "midterm"
        var final = exam("final", date: "2026-12-10", start: "15:00", end: "19:00")
        final.courseCode = midterm.courseCode
        var other = final; other.id = "other"; other.courseCode = "OTHER1000"
        let original = [final, other, midterm]
        XCTAssertEqual(StudyExamPlanner.collisions(original).count, 1)

        let midtermOnly = try StudyExamPlanner.setSelected(original, id: final.id, selected: false)
        var expectedFinal = final; expectedFinal.selected = false
        XCTAssertEqual(midtermOnly, [expectedFinal, other, midterm], "Selecting only a midterm leaves its final and other courses intact.")
        XCTAssertTrue(StudyExamPlanAnalysis(midtermOnly).conflicts.isEmpty, "An unselected final does not create a clash.")
        XCTAssertEqual(try JSONDecoder().decode([StudyExam].self, from: JSONEncoder().encode(midtermOnly)), midtermOnly)

        let neither = try StudyExamPlanner.setSelected(midtermOnly, id: midterm.id, selected: false)
        let finalOnly = try StudyExamPlanner.setSelected(neither, id: final.id, selected: true)
        XCTAssertEqual(finalOnly.filter { $0.courseKey == midterm.courseKey && $0.selected }.map(\.id), [final.id])
        XCTAssertEqual(StudyExamPlanAnalysis(finalOnly).conflicts.count, 1)
        XCTAssertEqual(finalOnly.first(where: { $0.id == other.id }), other)

        let refreshed = try StudyExamPlanner.importing(StudyExamImport(exams: [midterm, final]), into: midtermOnly)
        XCTAssertEqual(refreshed, midtermOnly, "Refreshing the same exam dates preserves the individual selections.")
    }

    func testStrictValidationDoesNotNormalizeImpossibleDates() throws {
        XCTAssertNil(StudyExamPlanner.day("2026-02-29"))
        XCTAssertNotNil(StudyExamPlanner.day("2028-02-29"))
        XCTAssertThrowsError(try StudyExamPlanner.normalized([exam("bad", date: "2026-02-30")]))
        XCTAssertThrowsError(try StudyExamPlanner.normalized([exam("bad", start: "24:00")]))
        XCTAssertThrowsError(try StudyExamPlanner.normalized([exam("one"), exam("one")]))
        XCTAssertThrowsError(try StudyExamPlanner.normalized((0...500).map { exam(String($0)) }))
        var bad = exam("bad")
        bad.endDate = "2026-12-14"
        XCTAssertThrowsError(try StudyExamPlanner.normalized([bad]))
    }

    func testStudentwebPreviewGroupsComponentsWithoutRetainingPersonalDetails() throws {
        let imported = StudyExamPlanner.parseStudentweb("""
        Studentnummer: 123456
        TDT4100 Object-oriented programming
        Midterm 15.10.2026 09:00–11:00
        Final exam 15.12.2026 09:00–13:00
        E-post: private@example.com
        TMA4115 Calculus
        Skriftlig skoleeksamen
        16.12.2026
        09:00 - 13:00
        """)
        XCTAssertEqual(imported.exams.count, 3)
        XCTAssertEqual(imported.exams.map(\.kind), ["midterm", "final", "final"])
        XCTAssertEqual(imported.exams.map(\.courseCode), ["TDT4100", "TDT4100", "TMA4115"])
        XCTAssertTrue(imported.exams.allSatisfy { !$0.selected && $0.source == "studentweb" })
        XCTAssertEqual(imported.exams.last?.endTime, "13:00")
        XCTAssertNoThrow(try StudyExamPlanner.normalized(imported.exams))
        let encoded = String(data: try JSONEncoder().encode(imported.exams), encoding: .utf8)!
        XCTAssertFalse(encoded.contains("private@example.com"))
        XCTAssertFalse(encoded.contains("123456"))
        XCTAssertTrue(StudyExamPlanner.parseStudentweb("Exam 15.12.2026 09:00–13:00").exams.isEmpty)
    }

    func testLibraryRoundTripAndExistingLibraries() throws {
        var library = StudyLibrary()
        library.examPlan = [exam("one")]
        let reopened = try JSONDecoder().decode(StudyLibrary.self, from: JSONEncoder().encode(library))
        XCTAssertEqual(reopened.examPlan, library.examPlan)
        library.examPlan = nil
        let older = try JSONDecoder().decode(StudyLibrary.self, from: JSONEncoder().encode(library))
        XCTAssertNil(older.examPlan)
    }

    @MainActor func testStaleSaveCannotOverwriteAnotherSurface() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let model = StudyWorkspaceModel(store: StudyLibraryStore(root: root))
        let initial = exam("one")
        try model.replaceExamPlan([initial], base: [])
        XCTAssertThrowsError(try model.replaceExamPlan([], base: []))
        XCTAssertEqual(model.library.examPlan, [initial])
        var invalid = initial
        invalid.date = "2026-02-30"
        XCTAssertThrowsError(try model.replaceExamPlan([invalid], base: [initial]))
        XCTAssertEqual(model.library.examPlan, [initial])
        model.flush()
        XCTAssertEqual(try model.store.load().examPlan, [initial])
    }

    @MainActor func testChoicesKeepCourseComponentsTogetherAndFavoriteOnlyClearSelections() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let model = StudyWorkspaceModel(store: StudyLibraryStore(root: root))
        let programming = StudyCourse(name: "Programming", code: "TDT4100-26H")
        let calculus = StudyCourse(name: "Calculus", code: "TMA4100")
        model.library.courses = [programming, calculus]
        let midterm = exam("midterm", date: "2026-10-10")
        let final = exam("final")
        var other = exam("calculus"); other.courseCode = "TMA4100"
        let initial = [midterm, final, other]
        try model.replaceExamPlan(initial, base: [])
        XCTAssertFalse(model.library.courses.contains(where: \.isFavorite))
        let chosen = try StudyExamPlanner.resolveConflict(initial, keep: other.id, drop: final.id)
        XCTAssertEqual(chosen.map(\.selected), [false, false, true])
        try model.replaceExamPlan(chosen, base: initial)
        XCTAssertFalse(model.library.courses[0].isFavorite)
        XCTAssertTrue(model.library.courses[1].isFavorite)
        XCTAssertThrowsError(try StudyExamPlanner.resolveConflict(chosen, keep: other.id, drop: final.id))
        model.flush()
        XCTAssertTrue(try model.store.load().courses[1].isFavorite)
    }
}
