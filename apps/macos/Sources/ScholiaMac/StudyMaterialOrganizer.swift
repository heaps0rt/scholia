import Foundation

struct StudyMaterialEntry: Encodable, Identifiable, Sendable {
    var id: String
    var title: String
    var documentID: UUID?
    var materialID: String?
    var sourceURL: String?
    var symbol: String
    var detail: String
    var badge: String?
    var updateAvailable: Bool
    var order: Int
    var submissionStatus: CanvasSubmissionStatus?
    var requiresSubmission: Bool?
}
struct StudyMaterialGroup: Encodable, Identifiable, Sendable {
    var id: String
    var title: String
    var basis: String
    var order: Int
    var items: [StudyMaterialEntry]
}

enum StudyMaterialOrganizer {
    static func groups(for course: StudyCourse, query: String = "") -> [StudyMaterialGroup] {
        var groups: [String: StudyMaterialGroup] = [:]
        let saved = Dictionary(
            course.documents.compactMap { doc in doc.sourceKey.map { ($0, doc) } },
            uniquingKeysWith: { first, _ in first })
        let references = Dictionary(course.materials.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        func add(document: StudyDocument?, reference: CanvasMaterialReference?) {
            let title = document?.title ?? reference?.title ?? "Untitled material"
            guard
                query.isEmpty || (title + " " + (reference?.moduleTitle ?? "")).localizedCaseInsensitiveContains(query)
            else { return }
            let grouping: (String, String, Int, String)
            if let id = reference?.moduleID, let name = reference?.moduleTitle {
                grouping = ("module:\(id)", name, (reference?.modulePosition ?? 0) + 1, "Canvas module order")
            } else {
                let category = category(
                    title: title, fileName: reference?.fileName ?? document?.fileName, kind: reference?.kind,
                    documentKind: document?.kind)
                grouping = (category.0, category.1, 10_000 + category.2, "Grouped by explicit titles and file types")
            }
            let changed = reference.flatMap { ref in
                course.catalogChanges?.added.contains(ref.id) == true
                    ? "New" : course.catalogChanges?.updated.contains(ref.id) == true ? "Updated" : nil
            }
            let update = document.flatMap { course.updateAvailable(for: $0) } != nil
            let entry = StudyMaterialEntry(
                id: document.map { "saved:\($0.id)" } ?? "canvas:\(reference!.id)", title: title,
                documentID: document?.id, materialID: reference?.id,
                sourceURL: reference?.sourceURL ?? document?.sourceURL,
                symbol: document?.kind.symbol ?? reference?.symbol ?? "doc.text",
                detail: document.map {
                    "\($0.pageCount) \([StudyDocumentKind.office, .notebook, .code].contains($0.kind) ? "sections" : "pages") · Saved offline"
                } ?? reference?.unavailableReason ?? "Download to read",
                badge: update ? "Update available" : changed, updateAvailable: update,
                order: reference?.moduleItemPosition ?? Int.max,
                submissionStatus: reference?.assignment?.status,
                requiresSubmission: reference?.assignment?.requiresSubmission)
            if groups[grouping.0] == nil {
                groups[grouping.0] = StudyMaterialGroup(
                    id: grouping.0, title: grouping.1, basis: grouping.3, order: grouping.2, items: [])
            }
            groups[grouping.0]?.items.append(entry)
        }
        for reference in course.materials { add(document: saved[reference.id], reference: reference) }
        for document in course.documents where document.sourceKey.flatMap({ references[$0] }) == nil {
            add(document: document, reference: nil)
        }
        return groups.values.map { group in
            var sorted = group
            sorted.items.sort {
                if $0.order != $1.order { return $0.order < $1.order }
                if ["lectures", "exercises"].contains(group.id) {
                    let left = teachingNumber($0.title, group: group.id)
                    let right = teachingNumber($1.title, group: group.id)
                    if left != right { return left < right }
                }
                let comparison = $0.title.localizedStandardCompare($1.title)
                return comparison == .orderedSame ? $0.id < $1.id : comparison == .orderedAscending
            }
            return sorted
        }.sorted {
            $0.order == $1.order
                ? $0.title.localizedStandardCompare($1.title) == .orderedAscending : $0.order < $1.order
        }
    }

    /// A flat inventory of original files, including remote files and course assets.
    /// Reuse the organized entries so downloaded Canvas files appear only once.
    static func files(for course: StudyCourse, query: String = "") -> [StudyMaterialEntry] {
        let references = Dictionary(course.materials.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let documents = Dictionary(course.documents.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return groups(for: course).flatMap(\.items).compactMap { entry in
            let reference = entry.materialID.flatMap { references[$0] }
            let document = entry.documentID.flatMap { documents[$0] }
            if let reference {
                guard reference.kind == .files else { return nil }
            } else if let sourceKey = document?.sourceKey, !sourceKey.hasPrefix("files:") {
                return nil
            }
            var file = entry
            let ext = document.map { URL(fileURLWithPath: $0.fileName).pathExtension } ?? ""
            let localName =
                document?.originalFileName
                ?? (ext.isEmpty || entry.title.lowercased().hasSuffix(".\(ext.lowercased())")
                    ? entry.title : "\(entry.title).\(ext)")
            file.title = reference?.fileName.flatMap { $0.isEmpty ? nil : $0 } ?? localName
            guard needle.isEmpty || file.title.localizedCaseInsensitiveContains(needle) else { return nil }
            return file
        }.sorted {
            let order = $0.title.localizedStandardCompare($1.title)
            return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
        }
    }

    /// Explicit lecture/exercise numbers are reliable even with prefixes such
    /// as demo_forel5 or lf_oving3. Canvas module order remains authoritative.
    private static func teachingNumber(_ title: String, group: String) -> Int {
        let text = title.lowercased().replacingOccurrences(of: "_", with: " ")
        let words = group == "lectures" ? "forel|forelesning|lecture|lec|l" : "oving|øving|exercise|assignment|lab"
        guard let expression = try? NSRegularExpression(pattern: "\\b(?:\(words))[ -]*(\\d+)\\b"),
            let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
            let range = Range(match.range(at: 1), in: text)
        else { return .max }
        return Int(text[range]) ?? .max
    }

    static func category(title: String, fileName: String?, kind: CanvasMaterialKind?, documentKind: StudyDocumentKind?)
        -> (String, String, Int)
    {
        let value = title.lowercased().replacingOccurrences(of: "_", with: " ")
        let ext = URL(fileURLWithPath: fileName ?? title).pathExtension.lowercased()
        func matches(_ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
        if documentKind == .image || StudyDocumentImporter.imageExtensions.contains(ext),
            matches(#"(?:^|\b)(?:icon|logo|divider|banner|footer|header)(?:\b|[-\d])|\bhovedlogo\b"#)
        {
            return ("assets", "Course assets", 100)
        }
        if kind == .syllabus || matches(#"\b(syllabus|kursplan|course overview|emnebeskrivelse)\b"#) {
            return ("information", "Course information", 0)
        }
        if matches(#"\b(exam|eksamen|past paper)\b"#) { return ("exams", "Exams", 40) }
        if kind == .assignments
            || matches(
                #"\b(exercise|assignment|problem set|øving|oving|oppgave|homework|lab|semesteroppgave|prosjektoppgave)\b|\b(?:oving|øving|exercise|assignment)[ -]*\d+"#
            )
        {
            return ("exercises", "Exercises & assignments", 30)
        }
        if matches(
            #"\b(lecture|lectures|forelesning|forelesningsnotater|slides|lecture notes)\b|\b(?:forel|forelesning|lecture|lec)[ -]*\d+|^l\d+\b"#
        ) {
            return ("lectures", "Lecture notes", 10)
        }
        if matches(#"\b(reading|readings|pensum|chapter|kapittel|textbook|article|artikkel)\b"#) {
            return ("readings", "Readings", 20)
        }
        if documentKind == .code || documentKind == .notebook || ext == "ipynb"
            || StudyFileFormats.codeExtensions.contains(ext)
        {
            return ("code", "Code & notebooks", 50)
        }
        if kind == .files || documentKind != nil { return ("documents", "Documents", 70) }
        return ("other", "Other materials", 90)
    }
}
