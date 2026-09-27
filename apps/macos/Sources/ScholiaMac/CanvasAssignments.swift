import Foundation

enum CanvasSubmissionStatus: String, Codable, Sendable {
    case unknown, notSubmitted, submitted, graded, excused
    var isHandedIn: Bool { self == .submitted || self == .graded }
    var isComplete: Bool { isHandedIn || self == .excused }
    var submissionLabel: String {
        switch self {
        case .submitted: "Handed in"
        case .graded: "Handed in · graded"
        case .excused: "Excused"
        case .notSubmitted: "Not handed in"
        case .unknown: "Status not synced"
        }
    }
}

/// Assignment dates are already adjusted by Canvas for the requesting student.
/// Keep the ISO timestamps intact for both the native and browser views.
struct CanvasAssignmentDetails: Codable, Equatable, Sendable {
    var dueAt: String?
    var unlockAt: String?
    var lockAt: String?
    var submissionTypes: [String]
    var status: CanvasSubmissionStatus
    var missing: Bool
    var locked: Bool
    var linkedFileIDs: [String]?

    init(record: [String: Any], origin: URL? = nil, courseID: Int? = nil) {
        dueAt = record["due_at"] as? String
        unlockAt = record["unlock_at"] as? String
        lockAt = record["lock_at"] as? String
        submissionTypes = record["submission_types"] as? [String] ?? []
        locked = record["locked_for_user"] as? Bool == true
        if let origin, let courseID, record.keys.contains("description") {
            linkedFileIDs = Self.linkedFiles(
                in: record["description"] as? String ?? "", origin: origin, courseID: courseID)
        }
        let submission = record["submission"] as? [String: Any] ?? [:]
        missing = submission["missing"] as? Bool == true
        let workflow = submission["workflow_state"] as? String
        if submission["excused"] as? Bool == true {
            status = .excused
        }
        // A missing assignment can be automatically graded zero without a submission.
        else if workflow == "graded" && !missing {
            status = .graded
        } else if submission["submitted_at"] as? String != nil
            || ["submitted", "pending_review"].contains(workflow ?? "")
        {
            status = .submitted
        } else if workflow == "unsubmitted" || missing {
            status = .notSubmitted
        } else {
            status = .unknown
        }
    }

    /// Keep Canvas file identity before the assignment HTML becomes plain text.
    /// Only follow explicit links on this Canvas origin, never similarly named files.
    static func linkedFiles(in html: String, origin: URL, courseID: Int) -> [String] {
        let pattern = #"(?i)\b(?:href|src|data-api-endpoint)\s*=\s*["']([^"']+)["']"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let text = html as NSString
        var result: [String] = []
        for match in regex.matches(in: html, range: NSRange(location: 0, length: text.length)) {
            let value = text.substring(with: match.range(at: 1)).replacingOccurrences(of: "&amp;", with: "&")
            guard let url = URL(string: value, relativeTo: origin)?.absoluteURL, CanvasAddress.sameOrigin(url, origin)
            else { continue }
            var parts = url.path.split(separator: "/").map(String.init)
            if parts.starts(with: ["api", "v1"]) { parts.removeFirst(2) }
            if parts.first == "courses" {
                guard parts.count >= 4, parts[1] == String(courseID) else { continue }
                parts.removeFirst(2)
            }
            guard parts.count >= 2, parts[0] == "files", let id = Int(parts[1]), id > 0,
                parts.count == 2 || (parts.count == 3 && ["download", "preview"].contains(parts[2]))
            else { continue }
            let key = String(id)
            if !result.contains(key) { result.append(key) }
        }
        return result
    }

    var requiresSubmission: Bool { submissionTypes.contains { !["none", "not_graded"].contains($0) } }
    var dueDate: Date? { Self.date(dueAt) }
    private static let dateStyle = Date.ISO8601FormatStyle()
    private static let fractionalDateStyle = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        return (try? dateStyle.parse(value)) ?? (try? fractionalDateStyle.parse(value))
    }
    func availability(at now: Date) -> String? {
        if let date = Self.date(lockAt), date <= now { return "Closed" }
        if let date = Self.date(unlockAt), date > now { return "Not open yet" }
        return locked ? "Locked in Canvas" : nil
    }
    func statusLabel(at now: Date) -> String {
        switch status {
        case .submitted, .graded, .unknown: return status.submissionLabel
        case .excused: return "Excused"
        case .notSubmitted:
            if let dueDate, dueDate < now { return "Overdue" }
            if missing { return "Missing" }
            if let dueDate, Calendar.current.isDate(dueDate, inSameDayAs: now) { return "Due today" }
            return "To submit"
        }
    }
}

struct StudyAssignment: Identifiable {
    let course: StudyCourse
    let material: CanvasMaterialReference
    let dueDate: Date?
    var id: String { "\(course.id):\(material.id)" }
    var details: CanvasAssignmentDetails? { material.assignment }
    var isHidden: Bool { course.hiddenAssignmentIDs?.contains(material.id) == true }

    func isUpcoming(at now: Date) -> Bool {
        guard let dueDate else { return false }
        return dueDate > now && details?.status.isComplete != true
    }

    static func list(
        courses: [StudyCourse], query: String = "", includeCompleted: Bool = false, dueOnly: Bool = false,
        includeHidden: Bool = false, hiddenOnly: Bool = false
    ) -> [Self] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return courses.flatMap { course in
            course.materials.filter {
                $0.kind == .assignments && $0.assignment?.requiresSubmission != false
                    && (hiddenOnly
                        ? course.hiddenAssignmentIDs?.contains($0.id) == true
                        : includeHidden || course.hiddenAssignmentIDs?.contains($0.id) != true)
                    && (includeCompleted || $0.assignment?.status.isComplete != true)
                    && (!dueOnly || $0.assignment?.dueDate != nil)
                    && (query.isEmpty
                        || "\(course.name) \(course.code) \($0.title)".localizedCaseInsensitiveContains(query))
            }.map { Self(course: course, material: $0, dueDate: $0.assignment?.dueDate) }
        }.sorted {
            let lhs = $0.dueDate ?? .distantFuture
            let rhs = $1.dueDate ?? .distantFuture
            if lhs != rhs { return lhs < rhs }
            let order = $0.material.title.localizedStandardCompare($1.material.title)
            return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
        }
    }
}

struct StudyAssignmentGroup: Identifiable {
    let semester: StudySemester
    let timeframe: StudyAssignmentTimeframe
    let items: [StudyAssignment]
    var id: String { "\(timeframe.rawValue):\(semester.id)" }
    private struct Key: Hashable {
        var semester: StudySemester
        var timeframe: StudyAssignmentTimeframe
    }

    static func make(
        courses: [StudyCourse], query: String = "", filter: StudyAssignmentFilter = .due, now: Date = Date()
    ) -> [Self] {
        let memberships = Dictionary(
            uniqueKeysWithValues: courses.map {
                ($0.id, StudySemester.memberships(term: $0.term, code: $0.code, name: $0.name))
            })
        var groups: [Key: [StudyAssignment]] = [:]
        for item in StudyAssignment.list(
            courses: courses, query: query, includeCompleted: true, includeHidden: filter == .all,
            hiddenOnly: filter == .hidden)
        {
            let hasDeadline = item.dueDate != nil && item.details?.status.isComplete != true
            switch filter {
            case .due: guard hasDeadline else { continue }
            case .handedIn: guard item.details?.status.isHandedIn == true else { continue }
            case .archive: guard !hasDeadline else { continue }
            case .all, .hidden: break
            }
            let terms = memberships[item.course.id] ?? [.unassigned]
            // A year-long course appears once, in the matching deadline semester.
            let dueSemester = item.dueDate.map { StudySemester.current(at: $0) }
            let semester = terms.first { $0 == dueSemester } ?? terms.first ?? .unassigned
            let timeframe: StudyAssignmentTimeframe
            if filter == .archive {
                timeframe = .archive
            } else if item.details?.status.isHandedIn == true {
                timeframe = .handedIn
            } else if item.details?.status == .excused {
                timeframe = .excused
            } else if item.dueDate == nil {
                timeframe = .undated
            } else {
                timeframe = item.isUpcoming(at: now) ? .upcoming : .overdue
            }
            groups[Key(semester: semester, timeframe: timeframe), default: []].append(item)
        }
        return groups.map { key, rows in
            let items =
                key.timeframe == .upcoming
                ? rows
                : rows.sorted {
                    let lhs = $0.dueDate ?? .distantPast
                    let rhs = $1.dueDate ?? .distantPast
                    if lhs != rhs { return lhs > rhs }
                    return $0.material.title.localizedStandardCompare($1.material.title) == .orderedAscending
                }
            return Self(semester: key.semester, timeframe: key.timeframe, items: items)
        }.sorted {
            if $0.timeframe != $1.timeframe { return $0.timeframe.rawValue < $1.timeframe.rawValue }
            if $0.timeframe == .upcoming, $0.items.first?.dueDate != $1.items.first?.dueDate {
                return ($0.items.first?.dueDate ?? .distantFuture) < ($1.items.first?.dueDate ?? .distantFuture)
            }
            return StudySemester.newestFirst($0.semester, $1.semester)
        }
    }
}

enum StudyAssignmentTimeframe: Int, CaseIterable, Identifiable {
    case upcoming, overdue, undated, handedIn, excused, archive
    var id: Int { rawValue }
    var title: String {
        switch self {
        case .upcoming: "Upcoming"
        case .overdue: "Overdue"
        case .undated: "No deadline"
        case .handedIn: "Handed in"
        case .excused: "Excused"
        case .archive: "Archive"
        }
    }
}

enum StudyAssignmentFilter: String, CaseIterable, Identifiable {
    case due = "Due & overdue"
    case handedIn = "Handed in"
    case all = "All assignments"
    case archive = "Archive"
    case hidden = "Hidden"
    var id: String { rawValue }
}

struct StudyAssignmentDateGroup: Identifiable {
    let date: Date?
    var items: [StudyAssignment]
    var id: String { date.map { String($0.timeIntervalSince1970) } ?? "undated" }
    var title: String {
        date?.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).year()) ?? "No due date"
    }

    static func make(_ items: [StudyAssignment], calendar: Calendar = .current) -> [Self] {
        var groups: [Self] = []
        for item in items {
            let day = item.dueDate.map { calendar.startOfDay(for: $0) }
            if let index = groups.firstIndex(where: { $0.date == day }) {
                groups[index].items.append(item)
            } else {
                groups.append(Self(date: day, items: [item]))
            }
        }
        return groups
    }
}
