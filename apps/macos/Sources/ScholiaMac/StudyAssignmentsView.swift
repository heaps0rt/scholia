import SwiftUI

struct StudySubmissionBadge: View {
    var status: CanvasSubmissionStatus?
    var body: some View {
        let value = status ?? .unknown
        Label(
            value.submissionLabel,
            systemImage: value.isHandedIn
                ? "checkmark.circle.fill"
                : value == .excused ? "minus.circle" : value == .unknown ? "questionmark.circle" : "circle"
        )
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(value.isHandedIn ? Color.green : Color.secondary)
        .padding(.horizontal, 7).padding(.vertical, 4)
        .background((value.isHandedIn ? Color.green : Color.secondary).opacity(0.08), in: Capsule())
    }
}

struct StudyAssignmentAgendaView: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    @State private var query = ""
    @State private var filter = StudyAssignmentFilter.due
    @Environment(\.colorScheme) private var scheme

    private var incomplete: Bool {
        workspace.library.courses.contains { course in
            course.canvasID != nil
                && (course.catalogUpdatedAt == nil
                    || (course.catalogWarnings ?? []).contains { $0.localizedCaseInsensitiveContains("assignments:") }
                    || course.materials.contains {
                        $0.kind == .assignments && ($0.assignment == nil || $0.assignment?.status == .unknown)
                    })
        }
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let groups = StudyAssignmentGroup.make(
                courses: workspace.library.courses, query: query, filter: filter, now: context.date)
            let count = groups.reduce(0) { $0 + $1.items.count }
            let handedIn = StudyAssignment.list(courses: workspace.library.courses, includeCompleted: true).filter {
                $0.details?.status.isHandedIn == true
            }.count
            VStack(alignment: .leading, spacing: 15) {
                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    Text("Assignments").font(.system(size: 23, design: .serif))
                    Text("\(count)").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    Image(systemName: "calendar.badge.clock").font(.system(size: 19, weight: .light)).foregroundStyle(
                        Color.accentColor)
                }
                HStack {
                    Text("All workspaces").font(.system(size: 10)).foregroundStyle(.secondary)
                    Spacer(minLength: 4)
                    Picker("Assignment filter", selection: $filter) {
                        ForEach(StudyAssignmentFilter.allCases) { Text($0.rawValue).tag($0) }
                    }.labelsHidden().pickerStyle(.menu).scholiaPointingCursor().fixedSize().accessibilityLabel(
                        "Assignment filter")
                }
                Button {
                    filter = .handedIn
                } label: {
                    Label("\(handedIn) handed in", systemImage: "checkmark.circle.fill")
                        .font(.system(size: 11, weight: .medium)).foregroundStyle(Color.green)
                }.scholiaButtonStyle(.plain).help("Show handed-in assignments")
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Find an assignment", text: $query).textFieldStyle(.plain)
                }.font(.system(size: 12)).padding(10)
                    .background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
                if incomplete {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "arrow.triangle.2.circlepath").padding(.top, 1)
                        Text("Sync Canvas to refresh deadlines and submission status.").fixedSize(
                            horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        Button("Connect") { workspace.canvasPresented = true }.scholiaButtonStyle(.plain)
                            .foregroundStyle(Color.accentColor)
                    }.font(.system(size: 10)).foregroundStyle(.secondary)
                }
                Divider()
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 22) {
                        if groups.isEmpty { emptyState }
                        ForEach(StudyAssignmentTimeframe.allCases) { timeframe in
                            let sections = groups.filter { $0.timeframe == timeframe }
                            if !sections.isEmpty {
                                VStack(alignment: .leading, spacing: 14) {
                                    if timeframe != .archive {
                                        HStack {
                                            Text(timeframe.title).font(.system(size: 17, design: .serif))
                                            Spacer()
                                            Text("\(sections.reduce(0) { $0 + $1.items.count })").font(
                                                .system(size: 10))
                                        }.foregroundStyle(timeframe == .overdue ? Color.orange : Color.primary)
                                    }
                                    ForEach(sections) { group in
                                        VStack(alignment: .leading, spacing: 8) {
                                            Text(group.semester.title.uppercased()).tracking(1)
                                                .font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                                            ForEach(StudyAssignmentDateGroup.make(group.items)) { day in
                                                VStack(alignment: .leading, spacing: 6) {
                                                    Text(day.title).font(.system(size: 11, weight: .semibold))
                                                        .foregroundStyle(.secondary).padding(.top, 7)
                                                    ForEach(day.items) { item in agendaRow(item) }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }.padding(.trailing, 3).padding(.vertical, 3)
                }
                Text(
                    "\(filter == .hidden ? "Restore assignments to show them again" : filter == .due ? "Next deadlines, then newest overdue" : filter == .handedIn ? "Submitted & graded in Canvas" : filter == .all ? "All indexed assignments" : "Undated & completed") · \(TimeZone.current.identifier)"
                )
                .font(.system(size: 9)).foregroundStyle(.tertiary)
            }.padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(
                    scheme == .dark ? Color.white.opacity(0.02) : Color.accentColor.opacity(0.035),
                    in: RoundedRectangle(cornerRadius: 16)
                )
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(.primary.opacity(0.065), lineWidth: 1))
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "checklist").font(.system(size: 24, weight: .light)).foregroundStyle(Color.accentColor)
            Text(
                !query.isEmpty
                    ? "No matching assignments."
                    : filter == .hidden
                        ? "No hidden assignments."
                        : filter == .handedIn
                            ? "No handed-in assignments yet."
                            : filter == .all
                                ? "No assignments yet."
                                : filter == .archive ? "Nothing in the archive." : "No outstanding deadlines."
            )
            .font(.system(size: 19, design: .serif))
            Text(
                !query.isEmpty
                    ? "Try an assignment title or course code."
                    : filter == .hidden
                        ? "Assignments you remove from the list can be restored here."
                        : filter == .handedIn || filter == .all
                            ? "Sync Canvas to refresh submission status."
                            : filter == .archive
                                ? "Undated and completed assignments will be kept here."
                                : "Use Handed in for submitted work, or All assignments to see everything."
            )
            .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }.padding(.vertical, 20)
    }

    private func agendaRow(_ item: StudyAssignment) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                Button {
                    workspace.openAssignment(item.material, courseID: item.course.id)
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.material.title).font(.system(size: 12, weight: .medium)).lineLimit(2).padding(
                            .trailing, 24)
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(item.course.displayCode.isEmpty ? item.course.displayName : item.course.displayCode)
                                .foregroundStyle(Color.accentColor).lineLimit(1)
                            Spacer(minLength: 0)
                            if let date = item.dueDate {
                                Text(date.formatted(.dateTime.hour().minute())).monospacedDigit().foregroundStyle(
                                    .secondary
                                ).fixedSize()
                            } else {
                                Text(item.details == nil ? "Deadline not synced" : "No due date").foregroundStyle(
                                    .tertiary
                                ).fixedSize()
                            }
                        }.font(.system(size: 10))
                        StudySubmissionBadge(status: item.details?.status)
                        if let availability = item.details?.availability(at: .now) {
                            Text(availability).font(.system(size: 9)).foregroundStyle(.secondary)
                        }
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                }.scholiaButtonStyle(.plain)
                    .help("Read \(item.material.title)").accessibilityLabel("Read assignment: \(item.material.title)")
                if let url = URL(string: item.material.sourceURL), url.scheme == "https", url.user == nil,
                    url.password == nil
                {
                    Link(destination: url) { Image(systemName: "arrow.up.right").font(.system(size: 10)).padding(10) }
                        .scholiaButtonStyle(.plain)
                        .help("Open \(item.material.title) in Canvas")
                }
            }
            Button {
                workspace.setAssignmentHidden(item.material.id, courseID: item.course.id, hidden: filter != .hidden)
            } label: {
                Label(
                    filter == .hidden ? "Restore" : "Remove from list",
                    systemImage: filter == .hidden ? "arrow.uturn.backward" : "minus.circle"
                )
                .font(.system(size: 10)).foregroundStyle(.secondary)
            }.scholiaButtonStyle(.plain).padding(.horizontal, 10).padding(.bottom, 9)
                .help(
                    filter == .hidden
                        ? "Show this assignment again" : "Hide this assignment. Restore it using the Hidden filter.")
        }.frame(maxWidth: .infinity, alignment: .leading)
            .background(
                scheme == .dark ? Color.white.opacity(0.025) : .white.opacity(0.8),
                in: RoundedRectangle(cornerRadius: 8))
    }
}

struct StudyAssignmentsView: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    let courses: [StudyCourse]
    var query = ""
    var showCourse = true
    var dashboard = false
    @State private var includeCompleted = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let assignments = StudyAssignment.list(
                courses: courses, query: query, includeCompleted: !dashboard && includeCompleted, dueOnly: dashboard)
            VStack(alignment: .leading, spacing: 14) {
                ViewThatFits(in: .horizontal) {
                    HStack {
                        heading(assignments.count)
                        Spacer()
                        if !dashboard { filter }
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        heading(assignments.count)
                        if !dashboard { filter }
                    }
                }
                Text(
                    dashboard
                        ? "Upcoming and overdue assignments from all workspaces, earliest deadline first. Times in \(TimeZone.current.identifier)."
                        : "Exercises and assignments, earliest deadline first. Times in \(TimeZone.current.identifier)."
                )
                .font(.system(size: 11)).foregroundStyle(.secondary)
                if courses.contains(where: {
                    $0.canvasID != nil
                        && ($0.catalogUpdatedAt == nil
                            || !$0.materials.filter { $0.kind == .assignments && $0.assignment == nil }.isEmpty
                            || !($0.catalogWarnings ?? []).isEmpty)
                }) {
                    Text("Some deadlines may be missing or out of date. Check Canvas for changes to refresh the list.")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                if assignments.isEmpty {
                    Text(
                        query.isEmpty
                            ? dashboard
                                ? "No upcoming or overdue assignments in your indexed workspaces."
                                : "No \(includeCompleted ? "assignments" : "assignments to submit") in the indexed materials for these courses."
                            : "No matching assignments."
                    )
                    .font(.system(size: 13)).foregroundStyle(.secondary).padding(.vertical, 18)
                } else {
                    LazyVStack(spacing: 9) {
                        ForEach(assignments) { assignment in row(assignment, now: context.date) }
                    }
                }
            }
        }
    }

    private func heading(_ count: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(dashboard ? "Due across your workspaces" : "Assignment due dates").font(
                .system(size: 23, design: .serif))
            Text("\(count)").font(.system(size: 12)).foregroundStyle(.secondary)
        }
    }
    private var filter: some View {
        Picker("Assignments", selection: $includeCompleted) {
            Text("To submit").tag(false)
            Text("All assignments").tag(true)
        }.labelsHidden().pickerStyle(.segmented).scholiaPointingCursor().frame(width: 215).accessibilityLabel(
            "Assignments")
    }
    private func row(_ item: StudyAssignment, now: Date) -> some View {
        let status = item.details?.statusLabel(at: now) ?? "Check Canvas"
        let overdue = status == "Overdue" || status == "Missing"
        return VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.material.title).font(.system(size: 14, weight: .medium)).fixedSize(
                        horizontal: false, vertical: true)
                    if showCourse {
                        Button(item.course.code.isEmpty ? item.course.displayName : item.course.code) {
                            workspace.selectCourse(item.course.id)
                        }
                        .scholiaButtonStyle(.plain).font(.system(size: 11)).foregroundStyle(Color.accentColor)
                    }
                    if let date = item.dueDate {
                        Text("Due \(date.formatted(date: .abbreviated, time: .shortened))").font(.system(size: 12))
                    } else {
                        Text(
                            item.details == nil
                                ? "Refresh to load due date"
                                : item.details?.dueAt != nil ? "Due date unavailable" : "No due date"
                        ).font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 5) {
                    StudySubmissionBadge(status: item.details?.status)
                    if overdue { Text(status).font(.system(size: 10, weight: .medium)).foregroundStyle(Color.orange) }
                }
            }
            HStack(spacing: 12) {
                if let availability = item.details?.availability(at: now) {
                    Text(availability).font(.system(size: 10)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button("Remove from list") {
                    workspace.setAssignmentHidden(item.material.id, courseID: item.course.id, hidden: true)
                }.help("Restore it using the Hidden filter in the assignment sidebar")
                Button("Read assignment") {
                    workspace.openAssignment(item.material, courseID: item.course.id)
                }
                if let url = URL(string: item.material.sourceURL), url.scheme == "https" {
                    Link("Open Canvas ↗", destination: url)
                }
            }.font(.system(size: 11)).controlSize(.small)
        }.padding(16).background(.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 12))
    }
}
