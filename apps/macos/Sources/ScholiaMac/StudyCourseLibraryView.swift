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

    var body: some View {
        GeometryReader { geometry in
            VStack(alignment: .leading, spacing: 25) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("Your study workspace").font(.system(size: 29, design: .serif))
                        Text("Pick up a reading. Keep your next deadline in sight.")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        workspace.loadCanvasCourses()
                    } label: {
                        Label(workspace.canvasBusy ? "Refreshing…" : "Refresh Canvas", systemImage: "arrow.clockwise")
                    }.controlSize(.regular).disabled(workspace.canvasBusy)
                }
                HStack(alignment: .top, spacing: 24) {
                    workspacePanel.frame(maxWidth: .infinity, maxHeight: .infinity)
                    StudyAssignmentAgendaView(workspace: workspace)
                        .frame(width: min(390, max(300, geometry.size.width * 0.30)))
                }.frame(maxHeight: .infinity)
            }.padding(28)
        }.background(StudyPalette.paper(scheme == .dark))
    }

    private var workspacePanel: some View {
        let displayedCourses = courses
        let semesters = workspace.semesterGroups
        let readings = workspace.recentReadings
        return VStack(alignment: .leading, spacing: 17) {
            HStack(alignment: .firstTextBaseline, spacing: 9) {
                Text("Workspaces").font(.system(size: 23, design: .serif))
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
            VStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Find a workspace", text: $query).textFieldStyle(.plain)
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
                VStack(alignment: .leading, spacing: 22) {
                    if query.isEmpty && workspace.courseLibraryView != .favorites && !readings.isEmpty {
                        StudyContinueReadingView(
                            workspace: workspace, readings: Array(readings.prefix(2)), compact: true)
                    }
                    if displayedCourses.isEmpty {
                        emptyState
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 14)], spacing: 14) {
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
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(course.displayCode.isEmpty ? "PERSONAL WORKSPACE" : course.displayCode)
                    .font(.system(size: 10, weight: .semibold)).tracking(0.6).foregroundStyle(Color.accentColor)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button {
                    workspace.toggleFavorite(course.id)
                } label: {
                    Image(systemName: course.isFavorite ? "star.fill" : "star")
                        .foregroundStyle(course.isFavorite ? Color.accentColor : .secondary)
                }.scholiaButtonStyle(.plain).help(course.isFavorite ? "Remove favorite" : "Favorite workspace")
                    .accessibilityLabel("Favorite \(course.name)")
            }
            Button {
                workspace.selectCourse(course.id)
            } label: {
                VStack(alignment: .leading, spacing: 10) {
                    Text(course.displayName).font(.system(size: 19, design: .serif)).lineLimit(2)
                        .frame(maxWidth: .infinity, minHeight: 47, alignment: .topLeading)
                    Text(course.term ?? (course.canvasID == nil ? "Personal workspace" : "Canvas"))
                        .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
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
        }.padding(17)
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
    @State private var query = ""
    @AppStorage private var materialView: String
    init(workspace: StudyWorkspaceModel, course: StudyCourse) {
        self.workspace = workspace
        self.course = course
        _materialView = AppStorage(wrappedValue: "organized", "study.materialView.\(course.id)")
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text(course.code.isEmpty ? "YOUR WORKSPACE" : course.code).font(.system(size: 10, weight: .semibold))
                    .tracking(1.6).foregroundStyle(Color.accentColor)
                Text(course.displayName).font(.system(size: 30, design: .serif)).fixedSize(
                    horizontal: false, vertical: true)
                if materialView != "files", query.isEmpty,
                    let reading = StudyRecentReading.inCourses([course], limit: 1).first
                {
                    StudyContinueReadingView(workspace: workspace, readings: [reading])
                }
                if course.canvasID != nil {
                    Text(
                        "Open a material to download it. Once saved, it's available offline and included in your tutor's course context."
                    )
                    .font(.system(size: 13)).foregroundStyle(.secondary)
                    HStack {
                        Button(course.catalogUpdatedAt == nil ? "Index materials" : "Check for changes") {
                            workspace.syncCanvasCourses(courseIDs: [course.id])
                        }.disabled(workspace.canvasBusy)
                        Button("Download all") {
                            workspace.syncCanvasCourses(courseIDs: [course.id], downloadAll: true)
                        }.disabled(workspace.canvasBusy)
                        if let url = course.canvasURL {
                            Link(destination: url) { Image(systemName: "arrow.up.right.square") }.help(
                                "Open course in Canvas")
                        }
                    }.controlSize(.small)
                } else {
                    Button(action: workspace.chooseDocuments) { Label("Add documents", systemImage: "plus") }
                        .scholiaButtonStyle(.borderedProminent)
                }
                if !(course.catalogWarnings ?? []).isEmpty {
                    Text("Some Canvas collections were unavailable. Refresh to retry, or open the course in Canvas.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Picker("Materials view", selection: $materialView) {
                    Text("Organized").tag("organized")
                    Text("All files").tag("files")
                }.pickerStyle(.segmented).scholiaPointingCursor().frame(maxWidth: 240)
                if course.canvasID != nil && materialView != "files" {
                    StudyAssignmentsView(workspace: workspace, courses: [course], query: query, showCourse: false)
                    Divider()
                }
                if !course.documents.isEmpty || !course.materials.isEmpty {
                    TextField("Search materials", text: $query).textFieldStyle(.roundedBorder)
                    StudyMaterialsList(workspace: workspace, course: course, query: query)
                } else {
                    Text(
                        course.canvasID == nil
                            ? "Drop PDFs, images, or notes here to begin."
                            : "Index this course to discover its readings and assignments."
                    )
                    .font(.system(size: 13)).foregroundStyle(.secondary).padding(.vertical, 30)
                }
            }.padding(30).frame(maxWidth: 800, alignment: .leading)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct StudyContinueReadingView: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    let readings: [StudyRecentReading]
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Text("Continue reading").font(.system(size: compact ? 16 : 22, design: .serif))
                Spacer()
                if !compact { Text("Your place is saved").font(.system(size: 11)).foregroundStyle(.secondary) }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
                ForEach(readings) { reading in
                    Button {
                        workspace.resumeReading(reading.document.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Label(reading.courseName, systemImage: reading.document.kind.symbol)
                                    .font(.system(size: 10, weight: .medium)).lineLimit(1)
                                Spacer(minLength: 4)
                                Image(systemName: "arrow.up.right").font(.system(size: 11))
                            }.foregroundStyle(Color.accentColor)
                            Text(reading.document.title).font(.system(size: 14, weight: .medium)).lineLimit(2)
                                .frame(maxWidth: .infinity, minHeight: 36, alignment: .topLeading)
                            Text(reading.document.readingPosition).font(.system(size: 11)).foregroundStyle(.secondary)
                        }.padding(17).frame(maxWidth: .infinity, alignment: .leading)
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
