import SwiftUI

struct StudyCourseLibraryView: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    var createCourse: () -> Void
    @State private var query = ""
    @Environment(\.colorScheme) private var scheme

    private var courses: [StudyCourse] {
        let selectedSemester = workspace.selectedSemesterID
        let courseIDs = Set(workspace.semesterGroups.first { $0.id == selectedSemester }?.courseIDs ?? [])
        let favoritesOnly = workspace.courseLibraryView == .favorites
        return workspace.sortedCourses.filter {
            (!favoritesOnly || $0.isFavorite)
                && (selectedSemester == "all" || courseIDs.contains($0.id))
                && (query.isEmpty
                    || ($0.name + " " + $0.code + " " + ($0.term ?? "")).localizedCaseInsensitiveContains(query))
        }
    }
    private var pendingFiles: Int { courses.reduce(0) { $0 + ($1.canvasFileSync?.pendingFileIDs.count ?? 0) } }

    var body: some View {
        GeometryReader { geometry in
            VStack(alignment: .leading, spacing: 21) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Your study workspace").font(.system(size: 27, design: .serif))
                        Text("Pick up a reading. Keep your next deadline in sight.")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        workspace.checkForNewCanvasFiles(courseIDs: courses.map(\.id), download: pendingFiles > 0 ? true : nil)
                    } label: {
                        Label(workspace.canvasFileSyncRunning ? "Checking files…"
                            : pendingFiles > 0 ? "Download new files · \(pendingFiles)" : "Check for new files", systemImage: "arrow.down.circle")
                    }.controlSize(.regular).disabled(workspace.canvasBusy || courses.isEmpty)
                        .help("Check the displayed courses and download newly discovered files")
                    Menu {
                        Button("Refresh course catalog") { workspace.loadCanvasCourses() }
                        Button("Canvas settings") { workspace.canvasPresented = true }
                    } label: { Image(systemName: "ellipsis") }
                        .menuStyle(.borderlessButton).fixedSize().disabled(workspace.canvasBusy)
                        .accessibilityLabel("Canvas options")
                }
                Button { workspace.examPlannerPresented = true } label: {
                    HStack(spacing: 13) {
                        Image(systemName: "calendar.badge.clock").font(.system(size: 24)).foregroundStyle(Color.accentColor)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Exam dates").font(.system(size: 13, weight: .semibold))
                            let exams = workspace.library.examPlan ?? []
                            let selected = exams.filter(\.selected).count
                            let conflicts = StudyExamPlanner.collisions(exams).count
                            Text(selected == 0 ? "Choose your exams and see how the dates fit." : "\(selected) exams selected · \(conflicts == 0 ? "No overlaps found" : "\(conflicts) overlaps to review")")
                                .font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("View schedule →").font(.system(size: 11)).foregroundStyle(Color.accentColor)
                    }.padding(14).background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 11))
                }.scholiaButtonStyle(.plain)
                HStack(alignment: .top, spacing: 20) {
                    workspacePanel.frame(maxWidth: .infinity, maxHeight: .infinity)
                    StudyAssignmentAgendaView(workspace: workspace)
                        .frame(width: min(370, max(280, geometry.size.width * 0.30)))
                }.frame(maxHeight: .infinity)
            }.padding(24)
        }.background(StudyPalette.paper(scheme == .dark))
    }

    private var workspacePanel: some View {
        let displayedCourses = courses
        let semesters = workspace.semesterGroups
        let readings = workspace.recentReadings
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 9) {
                Text("Workspaces").font(.system(size: 21, design: .serif))
                Text("\(displayedCourses.count)").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                Spacer()
                Picker(
                    "Workspace filter",
                    selection: Binding(
                        get: {
                            workspace.courseLibraryView == .favorites ? StudyCourseLibraryViewMode.favorites : .all
                        }, set: workspace.setCourseLibraryView)
                ) {
                    Text("All workspaces").tag(StudyCourseLibraryViewMode.all)
                    Text("Favorites").tag(StudyCourseLibraryViewMode.favorites)
                }.labelsHidden().pickerStyle(.menu).scholiaPointingCursor().fixedSize().accessibilityLabel(
                    "Workspace filter")
            }
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Find a workspace", text: $query).textFieldStyle(.plain)
                        .accessibilityLabel("Find a workspace")
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                            .scholiaButtonStyle(.plain).foregroundStyle(.secondary)
                            .help("Clear workspace search").accessibilityLabel("Clear workspace search")
                    }
                }.font(.system(size: 12)).padding(10)
                    .background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 9))
                HStack(spacing: 8) {
                    Image(systemName: "calendar").font(.system(size: 11)).foregroundStyle(.secondary)
                    Picker(
                        "Semester",
                        selection: Binding(get: { workspace.selectedSemesterID }, set: workspace.selectSemester)
                    ) {
                        Text("All semesters").tag("all")
                        ForEach(semesters) { Text($0.title).tag($0.id) }
                    }.labelsHidden().pickerStyle(.menu).scholiaPointingCursor().frame(maxWidth: 220).accessibilityLabel(
                        "Semester")
                    Spacer()
                    if let current = semesters.first(where: \.isCurrent), workspace.selectedSemesterID != current.id {
                        Button("This semester") { workspace.selectSemester(current.id) }
                            .scholiaButtonStyle(.plain).font(.system(size: 11)).foregroundStyle(Color.accentColor)
                    }
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if query.isEmpty && workspace.courseLibraryView != .favorites && !readings.isEmpty {
                        StudyContinueReadingView(
                            workspace: workspace, readings: Array(readings.prefix(2)), compact: true)
                    }
                    if displayedCourses.isEmpty {
                        emptyState
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 12)], spacing: 12) {
                            ForEach(displayedCourses) { card($0) }
                        }
                    }
                    HStack(spacing: 6) {
                        Image(systemName: "star").font(.system(size: 10))
                        Text("Canvas favorites and your pinned workspaces stay first.").font(.system(size: 10))
                    }.foregroundStyle(.secondary).padding(.bottom, 8)
                }.padding(.trailing, 3)
            }
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 11) {
            Image(systemName: "books.vertical").font(.system(size: 25, weight: .light)).foregroundStyle(
                Color.accentColor)
            Text(workspace.library.courses.isEmpty ? "Make room for a course." : "No matching workspaces.")
                .font(.system(size: 22, design: .serif))
            Text(
                workspace.library.courses.isEmpty
                    ? "Connect Canvas or create a workspace for your readings."
                    : "Try another name, semester, or workspace filter."
            )
            .font(.system(size: 12)).foregroundStyle(.secondary)
            if workspace.library.courses.isEmpty {
                Button("Create workspace", action: createCourse).controlSize(.small)
            }
        }.padding(25).frame(maxWidth: .infinity, alignment: .leading)
            .background(.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 13))
    }

    private func card(_ course: StudyCourse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(course.displayCode.isEmpty ? "PERSONAL WORKSPACE" : course.displayCode)
                    .font(.system(size: 10, weight: .semibold)).tracking(0.6).foregroundStyle(Color.accentColor)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if course.canvasID != nil {
                    Button { workspace.updateCanvasCourseContent(courseIDs: [course.id]) } label: {
                        Image(systemName: "arrow.clockwise")
                    }.scholiaButtonStyle(.plain).disabled(workspace.canvasBusy)
                        .help("Update course content").accessibilityLabel("Update \(course.displayName)")
                }
                Button {
                    workspace.toggleFavorite(course.id)
                } label: {
                    Image(systemName: course.isFavorite ? "star.fill" : "star")
                        .foregroundStyle(course.isFavorite ? Color.accentColor : .secondary)
                }.scholiaButtonStyle(.plain).help(course.isFavorite ? "Remove favorite" : "Favorite workspace")
                    .accessibilityLabel("\(course.isFavorite ? "Remove favorite" : "Favorite") \(course.name)")
            }
            Button {
                workspace.selectCourse(course.id)
            } label: {
                VStack(alignment: .leading, spacing: 8) {
                    Text(course.displayName).font(.system(size: 18, design: .serif)).lineLimit(2)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .topLeading)
                    Text(course.term ?? (course.canvasID == nil ? "Personal workspace" : "Canvas"))
                        .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                    if let pending = course.canvasFileSync?.pendingFileIDs.count, pending > 0 {
                        Label("\(pending) new \(pending == 1 ? "file" : "files") waiting", systemImage: "arrow.down.circle")
                            .font(.system(size: 10)).foregroundStyle(Color.accentColor)
                    }
                    Divider()
                    HStack {
                        Text(
                            course.canvasID == nil
                                ? "\(course.documents.count) documents"
                                : course.catalogUpdatedAt == nil
                                    ? "Ready to index"
                                    : "\(course.materials.count) materials · \(course.documents.count) saved"
                        )
                        .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                        Spacer(minLength: 4)
                        Image(systemName: "arrow.up.right").font(.system(size: 10)).foregroundStyle(Color.accentColor)
                    }
                }.contentShape(Rectangle())
            }.scholiaButtonStyle(.plain).help("Open \(course.displayName)")
            Button("Practice course", systemImage: "checkmark.bubble") {
                workspace.selectCourse(course.id)
                workspace.practiceSourceScope = "course"
                workspace.prepareStudyPrompt(.practice)
            }.controlSize(.small)
        }.padding(15)
            .background(
                scheme == .dark ? Color.white.opacity(0.025) : .white.opacity(0.75),
                in: RoundedRectangle(cornerRadius: 13)
            )
            .overlay(RoundedRectangle(cornerRadius: 13).stroke(.primary.opacity(0.07), lineWidth: 1))
            .contextMenu {
                Button("Open workspace") { workspace.selectCourse(course.id) }
                Button(course.isFavorite ? "Remove favorite" : "Favorite") { workspace.toggleFavorite(course.id) }
                if let url = course.canvasURL {
                    Divider()
                    Link("Open in Canvas", destination: url)
                    Button("Update course content") { workspace.updateCanvasCourseContent(courseIDs: [course.id]) }
                        .disabled(workspace.canvasBusy)
                    Button("Check for new files") { workspace.checkForNewCanvasFiles(courseIDs: [course.id]) }
                        .disabled(workspace.canvasBusy)
                    if course.canvasFileSync?.pendingFileIDs.isEmpty == false {
                        Button("Download new files") { workspace.checkForNewCanvasFiles(courseIDs: [course.id], download: true) }
                            .disabled(workspace.canvasBusy)
                    }
                    Button("Check for changes") { workspace.syncCanvasCourses(courseIDs: [course.id]) }.disabled(
                        workspace.canvasBusy)
                    Button("Download all materials") {
                        workspace.syncCanvasCourses(courseIDs: [course.id], downloadAll: true)
                    }.disabled(workspace.canvasBusy)
                }
            }
    }
}

struct StudyCourseMaterialsView: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    let course: StudyCourse
    var askCourse: () -> Void
    @State private var query = ""
    @State private var emptyAssignmentsExpanded = false
    @AppStorage private var materialView: String
    init(workspace: StudyWorkspaceModel, course: StudyCourse, askCourse: @escaping () -> Void) {
        self.workspace = workspace
        self.course = course
        self.askCourse = askCourse
        _materialView = AppStorage(wrappedValue: "organized", "study.materialView.\(course.id)")
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 8) {
                        Text(course.code.isEmpty ? "YOUR WORKSPACE" : course.displayCode)
                            .font(.system(size: 10, weight: .semibold)).tracking(1)
                            .foregroundStyle(Color.accentColor).lineLimit(1).help(course.code)
                        if let term = course.term {
                            Text("·").foregroundStyle(.tertiary)
                            Text(term).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    Text(course.displayName).font(.system(size: 26, design: .serif))
                        .fixedSize(horizontal: false, vertical: true)
                    Button(action: askCourse) {
                        Label("Ask about this course", systemImage: "bubble.left.and.bubble.right")
                    }.scholiaButtonStyle(.borderedProminent).controlSize(.small).padding(.top, 5)
                        .help("Ask about course topics, deadlines, or any of your saved readings")
                }
                if course.canvasID != nil {
                    HStack(spacing: 9) {
                        let updating = workspace.canvasContentSyncRunning && workspace.canvasActivityCourseID == course.id
                        Button(updating ? "Updating content…" : "Update content", systemImage: "arrow.clockwise") {
                            workspace.updateCanvasCourseContent(courseIDs: [course.id])
                        }.disabled(workspace.canvasBusy)
                            .help("Check files, pages, assignments and the syllabus, then fetch new or changed content. Local edits are preserved.")
                        Menu("All materials") {
                            Button("Check for new files") { workspace.checkForNewCanvasFiles(courseIDs: [course.id]) }
                            Button(course.catalogUpdatedAt == nil ? "Index materials" : "Check all materials for changes") {
                                workspace.syncCanvasCourses(courseIDs: [course.id])
                            }
                            Button("Download all materials") {
                                workspace.syncCanvasCourses(courseIDs: [course.id], downloadAll: true)
                            }
                        }.disabled(workspace.canvasBusy)
                        if let url = course.canvasURL {
                            Link(destination: url) { Image(systemName: "arrow.up.right.square") }.help(
                                "Open course in Canvas").accessibilityLabel("Open course in Canvas")
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "icloud.and.arrow.down").foregroundStyle(.secondary)
                            .help("Materials download when opened. Saved files are available offline and to your tutor.")
                            .accessibilityLabel("Materials download when opened and are then available offline")
                    }.controlSize(.small)
                    if let updated = course.syncedAt {
                        Text("Content updated \(updated.formatted(date: .abbreviated, time: .shortened))")
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    if let state = course.canvasFileSync {
                        VStack(alignment: .leading, spacing: 5) {
                            if let summary = state.summary { Text(summary) }
                            if let date = state.checkedAt {
                                Text("Files checked \(date.formatted(date: .abbreviated, time: .shortened))")
                            }
                            if let error = state.error {
                                Text(error).fixedSize(horizontal: false, vertical: true)
                                if workspace.canvasNeedsAuthentication {
                                    Button("Reconnect Canvas") { Task { await workspace.retryCanvasSignIn() } }
                                        .controlSize(.small).disabled(workspace.canvasBusy)
                                }
                            }
                        }.font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                } else {
                    Button(action: workspace.chooseDocuments) { Label("Add documents", systemImage: "plus") }
                        .scholiaButtonStyle(.borderedProminent)
                }
                if !(course.catalogWarnings ?? []).isEmpty {
                    Label("Some Canvas collections were unavailable. Check for changes to retry.", systemImage: "exclamationmark.circle")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if materialView != "files", query.isEmpty,
                    let reading = StudyRecentReading.inCourses([course], limit: 1).first
                {
                    StudyContinueReadingView(workspace: workspace, readings: [reading])
                }
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Materials").font(.system(size: 19, design: .serif))
                        Spacer(minLength: 12)
                        Picker("Materials view", selection: $materialView) {
                            Text("Organized").tag("organized")
                            Text("All files").tag("files")
                        }.pickerStyle(.segmented).labelsHidden().scholiaPointingCursor().frame(maxWidth: 210)
                    }
                    if !course.documents.isEmpty || !course.materials.isEmpty {
                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                            TextField("Search materials", text: $query).textFieldStyle(.plain)
                                .accessibilityLabel("Search materials")
                            if !query.isEmpty {
                                Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                                    .scholiaButtonStyle(.plain).foregroundStyle(.secondary)
                                    .help("Clear material search").accessibilityLabel("Clear material search")
                            }
                        }.font(.system(size: 12)).padding(10)
                            .background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
                if course.canvasID != nil && materialView != "files" {
                    if StudyAssignment.list(courses: [course]).isEmpty {
                        DisclosureGroup(isExpanded: $emptyAssignmentsExpanded) {
                            StudyAssignmentsView(workspace: workspace, courses: [course], query: query, showCourse: false)
                                .padding(.top, 10)
                        } label: {
                            Label(
                                course.catalogUpdatedAt == nil ? "Assignments · Not indexed yet" : "Assignments · None to submit in indexed materials",
                                systemImage: course.catalogUpdatedAt == nil ? "calendar" : "checkmark.circle")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                        }.padding(12)
                            .background(.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 9))
                    } else {
                        StudyAssignmentsView(workspace: workspace, courses: [course], query: query, showCourse: false)
                        Divider()
                    }
                }
                if !course.documents.isEmpty || !course.materials.isEmpty {
                    StudyMaterialsList(workspace: workspace, course: course, query: query)
                } else {
                    Text(
                        course.canvasID == nil
                            ? "Drop PDFs, images, or notes here to begin."
                            : "Index this course to discover its readings and assignments."
                    )
                    .font(.system(size: 13)).foregroundStyle(.secondary).padding(.vertical, 30)
                }
            }.padding(24).frame(maxWidth: 800, alignment: .leading)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct StudyContinueReadingView: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    let readings: [StudyRecentReading]
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Continue reading").font(.system(size: compact ? 16 : 18, design: .serif))
                Spacer()
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 10)], spacing: 10) {
                ForEach(readings) { reading in
                    Button {
                        workspace.resumeReading(reading.document.id)
                    } label: {
                        HStack(spacing: 11) {
                            Image(systemName: reading.document.kind.symbol)
                                .font(.system(size: 18, weight: .light)).foregroundStyle(Color.accentColor)
                                .frame(width: 30, height: 36)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(reading.document.title).font(.system(size: 13, weight: .medium))
                                    .lineLimit(2).truncationMode(.middle)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                if compact {
                                    Text(reading.courseName).font(.system(size: 10)).foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Text(reading.document.readingPosition).font(.system(size: 11))
                                    .foregroundStyle(Color.accentColor).lineLimit(1)
                            }
                            Image(systemName: "arrow.right").font(.system(size: 11)).foregroundStyle(Color.accentColor)
                        }.padding(13).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.accentColor.opacity(0.055), in: RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12).stroke(Color.accentColor.opacity(0.16), lineWidth: 1)
                            )
                            .contentShape(RoundedRectangle(cornerRadius: 12))
                    }.scholiaButtonStyle(.plain).help(
                        "Resume \(reading.document.title), \(reading.document.readingPosition.lowercased())")
                }
            }
        }
    }
}
