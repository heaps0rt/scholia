@preconcurrency import AppKit
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class StudyWindowController: NSObject, NSWindowDelegate {
    let workspace: StudyWorkspaceModel
    let window: NSWindow
    private let app: AppModel

    init(app: AppModel, workspace: StudyWorkspaceModel = StudyWorkspaceModel(), autosave: Bool = true) {
        self.app = app
        self.workspace = workspace
        let size = NSSize(width: 1_420, height: 900)
        window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered,
            defer: false)
        super.init()
        window.title = "Scholia"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 1_020, height: 640)
        window.collectionBehavior = [.fullScreenPrimary]
        window.contentViewController = PanelContentController(
            rootView: StudyWorkspaceView(workspace: workspace).environmentObject(app), size: size)
        window.delegate = self
        window.center()
        if autosave { window.setFrameAutosaveName("ScholiaStudyWorkspace") }
    }
    func show() {
        app.studyWindowVisibilityDidChange(true)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func windowWillClose(_ notification: Notification) {
        workspace.flush()
        app.studyWindowVisibilityDidChange(false)
    }
}

enum StudyPalette {
    static let accent = Color(red: 0.20, green: 0.38, blue: 0.32)
    static func paper(_ dark: Bool) -> Color {
        dark ? Color(nsColor: .windowBackgroundColor) : Color(red: 0.985, green: 0.979, blue: 0.960)
    }
    static func canvas(_ dark: Bool) -> Color {
        dark ? Color(nsColor: .underPageBackgroundColor) : Color(red: 0.943, green: 0.939, blue: 0.920)
    }
    static func rail(_ dark: Bool) -> Color {
        dark ? Color(red: 0.12, green: 0.14, blue: 0.13) : Color(red: 0.930, green: 0.943, blue: 0.919)
    }
}

struct StudyWorkspaceView: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    @EnvironmentObject private var app: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var query = ""
    @State private var courseSheet = false
    @State private var renaming = false
    @State private var courseName = ""
    @State private var courseCode = ""
    @State private var removeCourseID: UUID?
    @State private var sidebarVisible = true
    @State private var tutorVisible = true
    @State private var readerReset = 0
    @AppStorage("study.workspacesExpanded") private var workspacesExpanded = true
    @AppStorage("study.materialsExpanded") private var materialsExpanded = true
    private var dark: Bool { colorScheme == .dark }

    var body: some View {
        HStack(spacing: 0) {
            if sidebarVisible {
                sidebar.frame(width: 224)
                Divider()
            }
            VStack(spacing: 0) {
                topbar
                Divider()
                if workspace.isShowingLibrary {
                    StudyCourseLibraryView(workspace: workspace, createCourse: showCreateCourse)
                } else {
                    StudyWorkspaceSplitView(
                        reader: StudyReaderPane(
                            workspace: workspace, editing: workspace.documentEditing, tutorVisible: $tutorVisible,
                            expandReader: { readerReset += 1 }, createCourse: { showCreateCourse() }
                        )
                        .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity).clipped()
                        .environmentObject(app).scholiaButtonStyle(.automatic),
                        tutor: StudyTutorPane(workspace: workspace)
                            .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity).clipped()
                            .environmentObject(app).scholiaButtonStyle(.automatic),
                        tutorVisible: tutorVisible,
                        readerReset: readerReset,
                        minimumReaderWidth: workspace.document == nil && workspace.assignment == nil ? 380 : 80
                    )
                }
                if let status = workspace.preloadStatus {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.mini)
                        Text(status).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                        Spacer()
                        Button("Stop") { workspace.preloadFrequentCourses = false }.controlSize(.mini)
                    }.padding(.horizontal, 14).padding(.vertical, 6)
                }
                if let status = workspace.canvasStatus, !workspace.canvasPresented {
                    HStack(spacing: 9) {
                        if workspace.canvasBusy { ProgressView().controlSize(.small) }
                        Image(systemName: workspace.canvasWarnings.isEmpty ? "cloud" : "exclamationmark.circle")
                            .foregroundStyle(.secondary)
                        Text(status).font(.caption).lineLimit(2)
                        Spacer()
                        if workspace.canvasBusy { Button("Stop", action: workspace.cancelCanvas).controlSize(.small) }
                        if !workspace.canvasWarnings.isEmpty {
                            Button("Details") { workspace.canvasPresented = true }.controlSize(.small)
                        }
                        if !workspace.canvasBusy {
                            Button {
                                workspace.canvasStatus = nil
                            } label: {
                                Image(systemName: "xmark")
                            }.scholiaButtonStyle(.plain).help("Dismiss status")
                        }
                    }.padding(12).background(.primary.opacity(0.035))
                }
            }
        }
        .background(StudyPalette.paper(dark))
        .tint(ScholiaVisualStyle.accentColor(for: colorScheme))
        .accentColor(ScholiaVisualStyle.accentColor(for: colorScheme))
        .onChange(of: workspace.library.selectedCourseID) { _, _ in query = "" }
        .onChange(of: workspace.isShowingLibrary) { _, _ in query = "" }
        .sheet(isPresented: $courseSheet) { courseEditor }
        .sheet(isPresented: $workspace.canvasPresented) { StudyCanvasSheet(workspace: workspace) }
        .sheet(isPresented: $workspace.practicePresented) {
            StudyPracticeView(workspace: workspace, learning: workspace.learning).environmentObject(app)
        }
        .alert(
            "Remove this course workspace?",
            isPresented: Binding(get: { removeCourseID != nil }, set: { if !$0 { removeCourseID = nil } })
        ) {
            Button("Cancel", role: .cancel) { removeCourseID = nil }
            Button("Remove workspace", role: .destructive) {
                if let id = removeCourseID { workspace.removeCourse(id) }
                removeCourseID = nil
            }
        } message: {
            Text(
                "This removes the workspace and its chats from your library. Original files and Canvas content are unaffected."
            )
        }
        .onReceive(NotificationCenter.default.publisher(for: NSTextView.didChangeSelectionNotification)) {
            notification in
            guard let view = notification.object as? NSTextView, view.identifier?.rawValue == "ScholiaStudyDocument"
            else { return }
            let text = view.string as NSString
            let range = view.selectedRange()
            if NSMaxRange(range) <= text.length {
                workspace.selectedText = String(text.substring(with: range).prefix(16_000))
            }
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                ScholiaMark(size: 31)
                Text("scholia").font(.system(size: 26, weight: .semibold, design: .serif))
                Spacer()
            }.padding(.horizontal, 19).padding(.top, 44).padding(.bottom, 26)
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField(workspace.isShowingLibrary ? "Find a course" : "Find a material", text: $query)
                    .textFieldStyle(.plain).font(.system(size: 11))
            }.padding(9).background(.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 8)).padding(
                .horizontal, 13)
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    Button(action: workspace.showCourseLibrary) {
                        Label("Dashboard", systemImage: workspace.isShowingLibrary ? "square.grid.2x2" : "chevron.left")
                            .font(.system(size: 12, weight: .semibold))
                            .frame(maxWidth: .infinity, alignment: .leading).padding(10)
                            .background(
                                workspace.isShowingLibrary ? Color.accentColor.opacity(0.13) : .clear,
                                in: RoundedRectangle(cornerRadius: 9))
                    }.scholiaButtonStyle(.plain).padding(.top, 16)
                    if workspace.isShowingLibrary {
                        sectionTitle("WORKSPACES", expanded: $workspacesExpanded) { showCreateCourse() }.padding(
                            .top, 23)
                        if workspacesExpanded || !query.isEmpty {
                            if workspace.library.courses.isEmpty {
                                Text("A home for each course.")
                                    .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 9).padding(
                                        .vertical, 9)
                            }
                            ForEach(workspace.sidebarCourses(matching: query)) { course in
                                Button {
                                    workspace.selectCourse(course.id)
                                } label: {
                                    HStack(spacing: 10) {
                                        Image(
                                            systemName: course.isFavorite
                                                ? "star.fill"
                                                : course.canvasID == nil ? "books.vertical" : "graduationcap"
                                        )
                                        .font(.system(size: 16)).frame(width: 23)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(course.code.isEmpty ? course.name : course.code).font(
                                                .system(size: 12, weight: .semibold)
                                            ).lineLimit(1)
                                            Text(
                                                course.code.isEmpty
                                                    ? "\(course.documents.count) documents" : course.displayName
                                            )
                                            .font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                                        }
                                        Spacer(minLength: 0)
                                    }.padding(10).contentShape(Rectangle())
                                        .background(
                                            !workspace.isShowingLibrary
                                                && workspace.library.selectedCourseID == course.id
                                                ? Color.accentColor.opacity(0.13) : .clear,
                                            in: RoundedRectangle(cornerRadius: 9))
                                }.scholiaButtonStyle(.plain)
                            }
                            if query.isEmpty && workspace.library.courses.count > 7 {
                                Button(
                                    "Browse all \(workspace.library.courses.count) courses",
                                    action: workspace.showCourseLibrary
                                )
                                .scholiaButtonStyle(.plain).font(.caption).foregroundStyle(.secondary).padding(10)
                            }
                        }
                    }
                    if !workspace.isShowingLibrary, let course = workspace.course {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(course.code.isEmpty ? "YOUR WORKSPACE" : course.code).font(
                                .system(size: 10, weight: .semibold)
                            ).tracking(1).foregroundStyle(Color.accentColor)
                            Text(course.displayName).font(.system(size: 21, design: .serif)).fixedSize(
                                horizontal: false, vertical: true)
                            if let term = course.term { Text(term).font(.system(size: 10)).foregroundStyle(.secondary) }
                            Button(action: workspace.showCourseMaterials) {
                                Label("Course overview", systemImage: "rectangle.grid.1x2").font(.system(size: 11))
                            }.scholiaButtonStyle(.plain).padding(.top, 6)
                        }.padding(.horizontal, 10).padding(.top, 23).padding(.bottom, 5)
                        sectionTitle("MATERIALS", expanded: $materialsExpanded, action: workspace.chooseDocuments)
                            .padding(.top, 23)
                        if materialsExpanded || !query.isEmpty {
                            StudyMaterialsList(workspace: workspace, course: course, query: query, compact: true)
                        }
                        if course.documents.isEmpty && course.materials.isEmpty {
                            Button(action: workspace.chooseDocuments) {
                                Label("Add your first document", systemImage: "plus")
                            }.scholiaButtonStyle(.plain).font(.caption).foregroundStyle(.secondary).padding(10)
                        }
                        if !course.threads.isEmpty {
                            sectionTitle("CONVERSATIONS", action: workspace.newThread).padding(.top, 23)
                            ForEach(course.threads.reversed()) { thread in
                                Button {
                                    workspace.selectThread(thread.id)
                                } label: {
                                    Label(thread.title, systemImage: "bubble.left")
                                        .font(.system(size: 11)).lineLimit(1).frame(
                                            maxWidth: .infinity, alignment: .leading
                                        )
                                        .padding(9).contentShape(Rectangle())
                                        .background(
                                            workspace.library.selectedThreadID == thread.id
                                                ? Color.primary.opacity(0.06) : .clear,
                                            in: RoundedRectangle(cornerRadius: 7))
                                }.scholiaButtonStyle(.plain).contextMenu {
                                    Button("Delete conversation", role: .destructive) {
                                        workspace.removeThread(thread.id)
                                    }.disabled(workspace.streamingThreadID == thread.id)
                                }
                            }
                        }
                    }
                }.padding(.horizontal, 11).padding(.bottom, 20)
            }
            Divider().padding(.horizontal, 15)
            Button {
                workspace.canvasPresented = true
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "link.circle.fill").font(.system(size: 21)).foregroundStyle(Color.accentColor)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(workspace.library.canvasUserID == nil ? "Connect Canvas" : "Canvas connected").font(
                            .system(size: 11, weight: .semibold))
                        Text(workspace.library.canvasUserName ?? "Bring your courses along").font(.system(size: 10))
                            .foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 9)).foregroundStyle(.tertiary)
                }.padding(15)
            }.scholiaButtonStyle(.plain)
            HStack {
                SettingsLink { Label("Settings", systemImage: "gearshape") }.scholiaButtonStyle(.plain)
                Spacer()
                Button(action: app.openStudyWebsite) { Image(systemName: "globe") }.scholiaButtonStyle(.plain).help(
                    "Open this workspace in your browser")
                Button(action: app.showQuickAsk) { Image(systemName: "sparkles") }.scholiaButtonStyle(.plain).help(
                    "Open Quick Chat")
            }.font(.system(size: 11)).foregroundStyle(.secondary).padding(.horizontal, 19).padding(.bottom, 18)
        }.background(StudyPalette.rail(dark))
    }
    private var topbar: some View {
        HStack(spacing: 12) {
            Button {
                sidebarVisible.toggle()
            } label: {
                Image(systemName: "sidebar.left")
            }.buttonStyle(ScholiaIconButtonStyle()).help("Toggle course library")
            HStack(spacing: 2) {
                Button(action: workspace.goBack) { Image(systemName: "chevron.left") }
                    .disabled(!workspace.canGoBack).help("Back (⌘[)").accessibilityLabel("Back").keyboardShortcut(
                        "[", modifiers: .command)
                Button(action: workspace.goForward) { Image(systemName: "chevron.right") }
                    .disabled(!workspace.canGoForward).help("Forward (⌘])").accessibilityLabel("Forward")
                    .keyboardShortcut("]", modifiers: .command)
            }.buttonStyle(ScholiaIconButtonStyle())
            Button(
                workspace.isShowingLibrary
                    ? "Dashboard"
                    : (workspace.course?.code.isEmpty == false
                        ? workspace.course!.code : workspace.course?.name ?? "Your study space")
            ) {
                if !workspace.isShowingLibrary { workspace.showCourseMaterials() }
            }.scholiaButtonStyle(.plain).font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary).lineLimit(
                1)
            if !workspace.isShowingLibrary, let title = workspace.assignment?.title ?? workspace.document?.title {
                Image(systemName: "chevron.right").font(.system(size: 9)).foregroundStyle(.tertiary)
                Text(title).font(.system(size: 12)).lineLimit(1)
            }
            Spacer()
            Button("Review due") {
                workspace.practiceScreen = "review"
                workspace.practicePresented = true
            }.controlSize(.small)
            if workspace.course != nil && !workspace.isShowingLibrary {
                Button("Practice this") { workspace.prepareStudyPrompt(.practice) }.controlSize(.small)
            }
            if let activity = workspace.activity {
                ProgressView().controlSize(.small)
                Text(activity).font(.caption).lineLimit(1)
                Button(action: workspace.cancelImport) { Image(systemName: "xmark") }.scholiaButtonStyle(.plain).help(
                    "Stop import")
            } else if workspace.isShowingLibrary {
                Button("Connect Canvas") { workspace.canvasPresented = true }.controlSize(.small)
                Button("New workspace", action: showCreateCourse).controlSize(.small)
            } else if workspace.course != nil {
                Button(action: workspace.chooseDocuments) { Label("Add documents", systemImage: "plus") }.controlSize(
                    .small
                ).disabled(workspace.isImporting)
                Menu {
                    Button(workspace.course?.isFavorite == true ? "Remove favorite" : "Favorite course") {
                        if let id = workspace.course?.id { workspace.toggleFavorite(id) }
                    }
                    Button("Browse materials", action: workspace.showCourseMaterials)
                    Toggle("Preload frequent courses", isOn: $workspace.preloadFrequentCourses)
                        .help(
                            "After repeated visits, save up to three small readings in the background. Paused in Low Power Mode."
                        )
                    Button("Rename workspace") {
                        courseName = workspace.course?.name ?? ""
                        courseCode = workspace.course?.code ?? ""
                        renaming = true
                        courseSheet = true
                    }
                    if !app.savedConversations.isEmpty {
                        Menu("Bring in a saved chat") {
                            ForEach(app.savedConversations) { conversation in
                                Button(conversation.title) { workspace.importConversation(conversation) }
                            }
                        }
                    }
                    Divider()
                    Button("Remove workspace", role: .destructive) { removeCourseID = workspace.course?.id }.disabled(
                        workspace.isStreaming || workspace.isImporting || workspace.canvasBusy)
                } label: {
                    Image(systemName: "ellipsis")
                }.menuStyle(.borderlessButton).scholiaPointingCursor().frame(width: 22)
            }
        }.padding(.horizontal, 16).frame(height: 53).padding(.top, 28)
    }
    private func sectionTitle(_ title: String, expanded: Binding<Bool>? = nil, action: @escaping () -> Void)
        -> some View
    {
        HStack {
            if let expanded {
                Button {
                    expanded.wrappedValue.toggle()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: expanded.wrappedValue ? "chevron.down" : "chevron.right").font(
                            .system(size: 8, weight: .semibold))
                        Text(title).font(.system(size: 9, weight: .semibold)).tracking(1.5)
                    }.foregroundStyle(.secondary).contentShape(Rectangle())
                }.scholiaButtonStyle(.plain).help(
                    expanded.wrappedValue ? "Collapse \(title.lowercased())" : "Expand \(title.lowercased())")
            } else {
                Text(title).font(.system(size: 9, weight: .semibold)).tracking(1.5).foregroundStyle(.secondary)
            }
            Spacer()
            Button(action: action) { Image(systemName: "plus").font(.system(size: 10, weight: .medium)) }
                .scholiaButtonStyle(.plain).help(
                    title == "WORKSPACES" ? "Create a course workspace" : "Add \(title.lowercased())")
        }.padding(.horizontal, 10).padding(.bottom, 5)
    }
    private func showCreateCourse() {
        renaming = false
        courseName = ""
        courseCode = ""
        courseSheet = true
    }
    private var courseEditor: some View {
        VStack(alignment: .leading, spacing: 20) {
            ScholiaMark(size: 40)
            Text(renaming ? "Your course workspace" : "A new space to learn.").font(.system(size: 27, design: .serif))
            Text("Keep your readings, questions, and explanations together.").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 6) {
                Text("Course name").font(.caption)
                TextField("e.g. Linear algebra", text: $courseName).textFieldStyle(.roundedBorder)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Course code · optional").font(.caption)
                TextField("e.g. TMA4115", text: $courseCode).textFieldStyle(.roundedBorder)
            }
            HStack {
                Button("Cancel") { courseSheet = false }.keyboardShortcut(.cancelAction)
                Spacer()
                Button(renaming ? "Save changes" : "Create workspace") {
                    if renaming {
                        workspace.renameCourse(name: courseName, code: courseCode)
                    } else {
                        workspace.createCourse(name: courseName, code: courseCode)
                    }
                    courseSheet = false
                }.scholiaButtonStyle(.borderedProminent).disabled(
                    courseName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ).keyboardShortcut(.defaultAction)
            }.padding(.top, 8)
        }.padding(32).frame(width: 400).background(StudyPalette.paper(dark))
    }
}

private struct StudyReaderPane: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    @ObservedObject var editing: StudyEditingState
    @Binding var tutorVisible: Bool
    var expandReader: () -> Void
    var createCourse: () -> Void
    @EnvironmentObject private var app: AppModel
    @StateObject private var pdfControls = StudyPDFControls()
    @State private var semanticSearch = false
    @Environment(\.colorScheme) private var colorScheme
    @State private var zoom: CGFloat = 1
    @State private var search = ""
    @State private var searching = false
    @State private var outline = false
    @State private var dropTarget = false
    @State private var originalLayout = false
    @State private var previewCapture = 0
    private var dark: Bool { colorScheme == .dark }

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 260
            ZStack(alignment: .topLeading) {
                readingContent.frame(width: max(260, geometry.size.width), height: geometry.size.height)
                    .opacity(compact ? 0 : 1).accessibilityHidden(compact)
                    .allowsHitTesting(!compact)
                if compact {
                    VStack(spacing: 14) {
                        Image(systemName: "doc.richtext").font(.system(size: 22, weight: .light))
                        Text("Reader").font(.system(size: 10, weight: .medium))
                        Button(action: expandReader) { Image(systemName: "arrow.right.to.line") }
                            .help("Expand document reader").accessibilityLabel("Expand document reader")
                    }.foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.top, 24)
                }
            }.frame(width: geometry.size.width, height: geometry.size.height).clipped()
        }
    }
    private var readingContent: some View {
        VStack(spacing: 0) {
            if let assignment = workspace.assignment {
                StudyAssignmentPageView(workspace: workspace, assignment: assignment)
                    .id("\(workspace.course!.id):\(assignment.id)")
                Divider()
            }
            if let document = workspace.document {
                readerToolbar(document)
                Divider()
                if let notice = document.contentNotice {
                    Text(notice).font(.system(size: 10)).foregroundStyle(.secondary).frame(
                        maxWidth: .infinity, alignment: .leading
                    ).padding(.horizontal, 17).padding(.vertical, 8)
                }
                ZStack {
                    StudyPalette.canvas(dark)
                    if editing.drafts[document.id] != nil {
                        StudyDocumentEditorView(editing: editing, document: document)
                    } else {
                        switch document.kind {
                        case .pdf:
                            StudyPDFReader(
                                url: workspace.store.file(for: document),
                                page: Binding(get: { workspace.currentPage }, set: { workspace.setPage($0) }),
                                selection: $workspace.selectedText, selectingFigure: $workspace.selectingFigure,
                                zoom: zoom,
                                onFigure: {
                                    workspace.draftImage = $0
                                    tutorVisible = true
                                }, controls: pdfControls,
                                onSelectionAction: { text, explain, question in
                                    tutorVisible = true
                                    workspace.selectedText = text
                                    if explain && !workspace.isStreaming {
                                        let draft = workspace.draft
                                        let image = workspace.draftImage
                                        workspace.draftImage = nil
                                        workspace.send(
                                            using: app,
                                            question: question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                                ? "Explain the selected passage clearly, using its context in the document."
                                                : question)
                                        workspace.draft = draft
                                        workspace.draftImage = image
                                        return workspace.isStreaming
                                    }
                                    if !explain && !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                        workspace.draft = [workspace.draft, question].filter { !$0.isEmpty }.joined(
                                            separator: "\n\n")
                                    }
                                    return false
                                }, selectionBusy: workspace.isStreaming,
                                revision:
                                    "\(document.addedAt.timeIntervalSinceReferenceDate)-\(document.sourceVersion ?? "")"
                            )
                        case .image:
                            if let image = NSImage(contentsOf: workspace.store.file(for: document)) {
                                Image(nsImage: image).resizable().scaledToFit().padding(30).accessibilityLabel(
                                    document.title)
                            }
                        case .preview:
                            StudyOriginalPreview(
                                url: workspace.store.file(for: document), captureRequest: previewCapture,
                                onCapture: {
                                    workspace.attachImage($0)
                                    tutorVisible = true
                                }
                            ).id(document.addedAt)
                        case .notebook:
                            if let cells = workspace.documentIndex?.pages {
                                StudyNotebookReader(workspace: workspace, document: document, cells: cells).id(
                                    document.id)
                            } else {
                                ProgressView("Opening notebook…")
                            }
                        case .text, .code, .office:
                            if originalLayout && document.kind == .office {
                                StudyOriginalPreview(
                                    url: workspace.store.file(for: document), captureRequest: previewCapture,
                                    onCapture: {
                                        workspace.attachImage($0)
                                        tutorVisible = true
                                    }
                                ).id(document.addedAt)
                            } else {
                                ScrollView {
                                    VStack(alignment: .leading, spacing: 20) {
                                        RichMarkdownView(
                                            source: workspace.currentPageText,
                                            registerSelectionView: {
                                                $0.identifier = NSUserInterfaceItemIdentifier("ScholiaStudyDocument")
                                            })
                                        ForEach(
                                            workspace.documentIndex?.pages.first(where: {
                                                $0.number == workspace.currentPage
                                            })?.images ?? [], id: \.self
                                        ) { name in
                                            if let image = NSImage(
                                                contentsOf: workspace.store.directory(for: document.id)
                                                    .appendingPathComponent(name))
                                            {
                                                Image(nsImage: image).resizable().scaledToFit().accessibilityLabel(
                                                    "Embedded image")
                                                Button("Ask about this image") { workspace.attachImage(image) }
                                                    .controlSize(.small)
                                            }
                                        }
                                    }.padding(38).frame(maxWidth: 860, alignment: .leading)
                                        .background(StudyPalette.paper(dark), in: RoundedRectangle(cornerRadius: 3))
                                        .shadow(color: .black.opacity(0.05), radius: 8, y: 3).padding(28)
                                }.id("\(document.id)-\(workspace.currentPage)")
                            }
                        }
                    }
                    if workspace.selectingFigure {
                        VStack {
                            Text("Drag around a figure to ask about it · Esc to cancel").font(.caption.weight(.medium))
                                .padding(10)
                                .background(.regularMaterial, in: Capsule()).padding(14)
                            Spacer()
                        }.allowsHitTesting(false)
                    }
                }
                readerFooter(document)
            } else if workspace.assignment != nil {
                EmptyView()
            } else if let course = workspace.course {
                StudyCourseMaterialsView(workspace: workspace, course: course)
            } else {
                welcome
            }
        }
        .overlay {
            if dropTarget {
                RoundedRectangle(cornerRadius: 12).stroke(
                    Color.accentColor, style: StrokeStyle(lineWidth: 3, dash: [8])
                ).padding(8).allowsHitTesting(false)
            }
        }
        .onDrop(of: [.fileURL], isTargeted: $dropTarget) { providers in
            guard workspace.course != nil, !workspace.isImporting else { return false }
            Task { @MainActor in
                var urls: [URL] = []
                for provider in providers {
                    let value: Data? = await withCheckedContinuation { continuation in
                        _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.fileURL.identifier) { data, _ in
                            continuation.resume(returning: data)
                        }
                    }
                    if let value, let url = URL(dataRepresentation: value, relativeTo: nil), url.isFileURL {
                        urls.append(url)
                    }
                }
                workspace.importDocuments(urls)
            }
            return true
        }
        .onChange(of: workspace.document?.id) { _, _ in
            zoom = 1
            search = ""
            searching = false
            originalLayout = false
            pdfControls.matches = []
            pdfControls.outline = []
        }
        .onChange(of: pdfControls.layout) { _, _ in pdfControls.apply() }
        .onChange(of: pdfControls.zoomMode) { _, _ in pdfControls.apply() }
        .onChange(of: pdfControls.dark) { _, _ in pdfControls.apply() }
        .task(id: "\(workspace.document?.id.uuidString ?? "")-\(search)-\(semanticSearch)") {
            do { try await Task.sleep(for: .milliseconds(220)) } catch { return }
            pdfControls.search(search, pages: workspace.documentIndex?.pages ?? [], semantic: semanticSearch)
        }
    }

    private func readerToolbar(_ document: StudyDocument) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                if editing.drafts[document.id] != nil {
                    Text(document.kind == .notebook ? "EDIT NOTEBOOK" : "EDIT DOCUMENT").font(
                        .system(size: 9, weight: .semibold)
                    ).tracking(1).foregroundStyle(.secondary)
                    Text("Saved locally").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Cancel") { editing.cancel(document.id) }.disabled(editing.busy)
                    Button(editing.busy ? "Saving…" : "Save changes") {
                        editing.save(document.id, workspace: workspace)
                    }
                    .scholiaButtonStyle(.borderedProminent).disabled(editing.busy).keyboardShortcut(
                        "s", modifiers: .command)
                } else {
                    Button {
                        outline.toggle()
                    } label: {
                        Image(systemName: "list.bullet")
                    }.buttonStyle(ScholiaIconButtonStyle()).help("Table of contents")
                        .popover(isPresented: $outline) {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(pdfControls.outline.isEmpty ? "Document sections" : "Table of contents").font(
                                    .headline)
                                ScrollView {
                                    LazyVStack(alignment: .leading, spacing: 3) {
                                        if !pdfControls.outline.isEmpty && document.kind == .pdf {
                                            ForEach(pdfControls.outline) { entry in
                                                Button {
                                                    workspace.setPage(entry.page)
                                                    outline = false
                                                } label: {
                                                    HStack {
                                                        Text(entry.title).lineLimit(2)
                                                        Spacer()
                                                        Text("\(entry.page)").foregroundStyle(.secondary)
                                                    }
                                                    .padding(.leading, CGFloat(entry.depth * 12)).padding(7)
                                                    .contentShape(Rectangle())
                                                }.scholiaButtonStyle(.plain).font(.caption)
                                            }
                                        } else {
                                            ForEach(workspace.documentIndex?.pages ?? [], id: \.number) { page in
                                                Button {
                                                    workspace.setPage(page.number)
                                                    outline = false
                                                } label: {
                                                    HStack(alignment: .top) {
                                                        Text("\(page.number)").monospacedDigit().frame(
                                                            width: 26, alignment: .trailing
                                                        ).foregroundStyle(.secondary)
                                                        Text(
                                                            page.text.isEmpty
                                                                ? "Image page"
                                                                : String(page.text.prefix(100)).replacingOccurrences(
                                                                    of: "\n", with: " ")
                                                        ).lineLimit(2)
                                                    }
                                                    .font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                                                    .padding(7).contentShape(Rectangle())
                                                }.scholiaButtonStyle(.plain)
                                            }
                                        }
                                    }
                                }
                            }.padding(16).frame(width: 320, height: 420)
                        }
                    Button {
                        searching.toggle()
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }.buttonStyle(ScholiaIconButtonStyle()).help("Find in document (⌘F)").keyboardShortcut(
                        "f", modifiers: .command)
                    if document.kind == .pdf {
                        Menu {
                            Picker("Page layout", selection: $pdfControls.layout) {
                                Text("Continuous").tag("continuous")
                                Text("Single page").tag("page")
                                Text("Two-page spread").tag("spread")
                            }
                        } label: {
                            Image(systemName: pdfControls.layout == "spread" ? "book" : "rectangle.portrait")
                        }.menuStyle(.borderlessButton).scholiaPointingCursor().fixedSize().help("Page layout")
                        Spacer(minLength: 0)
                        Button {
                            pdfControls.zoom(-1)
                        } label: {
                            Image(systemName: "minus.magnifyingglass")
                        }.scholiaButtonStyle(.plain).help("Zoom out")
                        Menu {
                            Button("Automatic") { pdfControls.zoomMode = "auto" }
                            Button("Fit page") { pdfControls.zoomMode = "page" }
                            Button("Fit width") { pdfControls.zoomMode = "width" }
                            Divider()
                            ForEach([50, 75, 100, 125, 150, 200], id: \.self) { value in
                                Button("\(value)%") {
                                    pdfControls.scale = CGFloat(value) / 100
                                    pdfControls.zoomMode = "custom"
                                    pdfControls.apply()
                                }
                            }
                        } label: {
                            Text(
                                pdfControls.zoomMode == "custom"
                                    ? "\(Int(pdfControls.scale * 100))%"
                                    : pdfControls.zoomMode == "width"
                                        ? "Fit width" : pdfControls.zoomMode == "page" ? "Fit page" : "Auto"
                            ).font(.system(size: 10)).frame(minWidth: 39)
                        }.menuStyle(.borderlessButton).scholiaPointingCursor().fixedSize()
                        Button {
                            pdfControls.zoom(1)
                        } label: {
                            Image(systemName: "plus.magnifyingglass")
                        }.scholiaButtonStyle(.plain).help("Zoom in")
                        Button {
                            workspace.selectingFigure.toggle()
                        } label: {
                            Image(systemName: "viewfinder")
                        }.buttonStyle(ScholiaIconButtonStyle()).help("Select a figure for the tutor")
                    } else {
                        Text(
                            document.kind == .notebook ? "NOTEBOOK" : document.kind == .code ? "SOURCE CODE" : "READING"
                        ).font(.system(size: 9, weight: .semibold)).tracking(1).foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                        if document.kind == .preview || (originalLayout && document.kind == .office) {
                            Button("Ask about view") { previewCapture += 1 }.controlSize(.small)
                        }
                        if document.kind == .office {
                            Button(originalLayout ? "Reading view" : "Original layout") { originalLayout.toggle() }
                                .controlSize(.small)
                        }
                    }
                    if StudyDocumentEditing.supports(document) {
                        Button("Edit", systemImage: "pencil") { editing.begin(document) }.controlSize(.small).disabled(
                            editing.busy
                        ).help("Edit this local document")
                    }
                    Button {
                        tutorVisible.toggle()
                    } label: {
                        Image(systemName: "bubble.left.and.bubble.right")
                    }.buttonStyle(ScholiaIconButtonStyle()).help(tutorVisible ? "Hide tutor" : "Show tutor")
                    Menu {
                        Button("Guide me") {
                            workspace.mode = .guide
                            tutorVisible = true
                        }
                        Button(pdfControls.dark ? "Light reader" : "Dark reader") { pdfControls.dark.toggle() }
                        Button("Save a copy…") { saveCopy(document) }
                        if document.kind == .pdf {
                            Button("Print…", action: pdfControls.printDocument).keyboardShortcut(
                                "p", modifiers: .command)
                        }
                        Button("Open original in default app") {
                            NSWorkspace.shared.open(workspace.store.file(for: document))
                        }
                        Button("Choose file…", action: workspace.chooseDocuments)
                    } label: {
                        Image(systemName: "ellipsis")
                    }.menuStyle(.borderlessButton).scholiaPointingCursor().fixedSize()
                }
            }.padding(.horizontal, 13).frame(height: 46)
            if let error = editing.error {
                Text(error).font(.caption).foregroundStyle(.orange).textSelection(.enabled).padding(12)
            }
            if searching && editing.drafts[document.id] == nil {
                HStack(spacing: 8) {
                    Picker("Search", selection: $semanticSearch) {
                        Text("Exact").tag(false)
                        Text("Semantic").tag(true)
                    }.labelsHidden().frame(width: 93)
                    TextField(semanticSearch ? "Find related concepts" : "Find words or phrases", text: $search)
                        .textFieldStyle(.roundedBorder).onSubmit { findNext(1) }
                    Text(
                        pdfControls.matches.isEmpty
                            ? "0" : "\(max(0, pdfControls.matchIndex + 1)) / \(pdfControls.matches.count)"
                    ).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    Button {
                        findNext(-1)
                    } label: {
                        Image(systemName: "arrow.up")
                    }.scholiaButtonStyle(.plain).help("Previous result")
                    Button {
                        findNext(1)
                    } label: {
                        Image(systemName: "arrow.down")
                    }.scholiaButtonStyle(.plain).help("Next result")
                    Button {
                        searching = false
                        search = ""
                    } label: {
                        Image(systemName: "xmark")
                    }.scholiaButtonStyle(.plain).help("Close search")
                }.padding(.horizontal, 13).padding(.bottom, 10)
            }
        }
    }
    private func saveCopy(_ document: StudyDocument) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = document.fileName
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try Data(contentsOf: workspace.store.file(for: document)).write(to: url, options: .atomic) } catch {
            workspace.error = error.localizedDescription
        }
    }
    private func readerFooter(_ document: StudyDocument) -> some View {
        HStack(spacing: 9) {
            Image(systemName: document.unreadablePages == 0 ? "checkmark.circle" : "doc.viewfinder").foregroundStyle(
                .secondary)
            Text(
                document.kind == .notebook
                    ? "\(document.pageCount) cells · Saved offline"
                    : document.kind == .preview
                        ? "Original file saved offline"
                        : document.unreadablePages == 0
                            ? "\(document.pageCount) \([StudyDocumentKind.office, .code].contains(document.kind) ? "sections" : "pages") indexed"
                            : "\(document.unreadablePages) image-only pages"
            )
            .font(.system(size: 10)).foregroundStyle(.secondary)
            Spacer()
            if editing.drafts[document.id] != nil {
                Text(
                    document.kind == .notebook
                        ? "Save to update tutor context · Saved outputs are not rerun" : "Save to update tutor context"
                )
                .font(.system(size: 10)).foregroundStyle(.secondary)
            } else if document.kind == .notebook {
                Text("Scroll to read").font(.system(size: 10)).foregroundStyle(.tertiary)
            } else {
                Button {
                    workspace.setPage(
                        pdfControls.pageTarget(workspace.currentPage, count: document.pageCount, direction: -1))
                } label: {
                    Image(systemName: "chevron.left")
                }.disabled(workspace.currentPage <= 1)
                TextField(
                    "Page", value: Binding(get: { workspace.currentPage }, set: { workspace.setPage($0) }),
                    format: .number
                )
                .textFieldStyle(.plain).multilineTextAlignment(.center).frame(width: 30).font(
                    .system(size: 11).monospacedDigit()
                ).accessibilityLabel("Current page")
                Text("/ \(document.pageCount)").font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary)
                Button {
                    workspace.setPage(
                        pdfControls.pageTarget(workspace.currentPage, count: document.pageCount, direction: 1))
                } label: {
                    Image(systemName: "chevron.right")
                }.disabled(workspace.currentPage >= document.pageCount)
            }
        }.scholiaButtonStyle(.plain).padding(.horizontal, 20).frame(height: 42).background(StudyPalette.paper(dark))
    }
    private func findNext(_ direction: Int) {
        if let page = pdfControls.nextMatch(direction) { workspace.setPage(page) }
    }
    private var welcome: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 23) {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 2).fill(Color.accentColor).frame(width: 22, height: 3)
                    Text(workspace.course == nil ? "A LITTLE SPACE TO THINK" : "YOUR COURSE WORKSPACE").font(
                        .system(size: 10, weight: .medium)
                    ).tracking(2).foregroundStyle(.secondary)
                }.padding(.top, 44)
                Text(workspace.course?.name ?? "Make room for\nunderstanding.")
                    .font(.system(size: workspace.course == nil ? 43 : 35, weight: .regular, design: .serif))
                    .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
                Text(
                    workspace.course == nil
                        ? "Your readings on one side. A thoughtful tutor on the other. Bring your course materials, and work through them at your own pace."
                        : "A place for your readings, questions, and the moments when things click. Open a document to start exploring, or ask a question across your course."
                )
                .font(.system(size: 14)).foregroundStyle(.secondary).lineSpacing(6).fixedSize(
                    horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    Button(action: workspace.course == nil ? createCourse : workspace.chooseDocuments) {
                        Label(workspace.course == nil ? "Create a workspace" : "Add documents", systemImage: "plus")
                            .padding(.horizontal, 8).padding(.vertical, 5)
                    }.scholiaButtonStyle(.borderedProminent)
                    if workspace.course == nil {
                        Button("Connect Canvas") { workspace.canvasPresented = true }.scholiaButtonStyle(.bordered)
                            .padding(.vertical, 5)
                    }
                }
                Divider().padding(.vertical, 12)
                if let course = workspace.course, !course.documents.isEmpty {
                    Text("ON YOUR READING LIST").font(.system(size: 9, weight: .semibold)).tracking(1.5)
                        .foregroundStyle(.secondary)
                    ForEach(course.documents) { document in
                        Button {
                            workspace.selectDocument(document.id)
                        } label: {
                            HStack(spacing: 13) {
                                Image(systemName: document.kind.symbol).font(.title2).foregroundStyle(Color.accentColor)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(document.title).font(.system(size: 13, weight: .medium))
                                    Text("\(document.pageCount) pages · Continue on page \(document.lastPage)").font(
                                        .caption
                                    ).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "arrow.up.right").foregroundStyle(.tertiary)
                            }.padding(16).background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
                        }.scholiaButtonStyle(.plain)
                    }
                } else {
                    welcomeStep(
                        "01", title: "Bring your materials",
                        detail: "Add PDFs, lecture slides, notes, and images—or connect your Canvas courses.")
                    welcomeStep(
                        "02", title: "Read, select, ask",
                        detail:
                            "Highlight a passage or frame a figure. The tutor follows your page and uses the wider document."
                    )
                    welcomeStep(
                        "03", title: "Make it your own",
                        detail: "Ask for an explanation, work through a hint, or test your understanding with practice."
                    )
                }
                Label("Your workspace is saved on this Mac", systemImage: "internaldrive").font(.system(size: 10))
                    .foregroundStyle(.tertiary).padding(.top, 18)
            }.padding(.horizontal, 42).padding(.bottom, 40).frame(maxWidth: 760, alignment: .leading)
        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(StudyPalette.paper(dark))
    }
    private func welcomeStep(_ number: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 17) {
            Text(number).font(.system(size: 11, design: .monospaced)).foregroundStyle(Color.accentColor).padding(
                .top, 3)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.system(size: 14, weight: .medium))
                Text(detail).font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(4).fixedSize(
                    horizontal: false, vertical: true)
            }
        }
    }
}

private struct StudyTutorPane: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    @EnvironmentObject private var app: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var composerFocused = false
    @State private var modelsPresented = false
    @State private var contextPresented = false
    @State private var followOutput = true
    private var dark: Bool { colorScheme == .dark }
    private var modelDefinition: ModelDefinition? { app.modelDefinition(for: app.activeProvider, id: app.activeModel) }
    private var visionAvailable: Bool {
        (modelDefinition?.supportsImages ?? (app.activeProvider.id != "opencode"))
            && (app.activeProvider.supportsImages || app.activeProvider.bridge?.imageSupportComesFromHealth == true)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                Image(systemName: "sparkle").font(.system(size: 16)).foregroundStyle(Color.accentColor)
                Text("Study companion").font(.system(size: 14, weight: .semibold, design: .serif))
                Spacer()
                Button {
                    workspace.newThread()
                } label: {
                    Image(systemName: "square.and.pencil")
                }.buttonStyle(ScholiaIconButtonStyle()).help("New conversation").disabled(workspace.course == nil)
            }.padding(.horizontal, 19).frame(height: 46)
            Divider()
            VStack(spacing: 10) {
                Picker("Teaching style", selection: $workspace.mode) {
                    ForEach(StudyTeachingMode.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented).scholiaPointingCursor().labelsHidden().disabled(
                    workspace.isCurrentThreadStreaming)
                Text(workspace.mode.summary).font(.system(size: 11)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                if workspace.mode == .practice {
                    Button("Start a saved practice session") { workspace.prepareStudyPrompt(.practice) }
                }
                Button {
                    contextPresented.toggle()
                } label: {
                    HStack(spacing: 6) {
                        Circle().fill(workspace.documentIndex != nil ? Color.accentColor : Color.secondary.opacity(0.4))
                            .frame(width: 5, height: 5)
                        Text(
                            workspace.document.map {
                                $0.kind == .notebook
                                    ? "Cell \(workspace.currentPage) · Full notebook context"
                                    : "Page \(workspace.currentPage) · \($0.pageCount) pages indexed"
                            } ?? (workspace.course == nil ? "Choose a course to begin" : "Course materials available")
                        )
                        .font(.system(size: 10)).lineLimit(1)
                        Spacer()
                        Image(systemName: "info.circle").font(.system(size: 11))
                    }.foregroundStyle(.secondary)
                }.scholiaButtonStyle(.plain)
                    .popover(isPresented: $contextPresented) { contextDetails }
            }.padding(.horizontal, 19).padding(.top, 17).padding(.bottom, 12)
            conversation
            if let error = workspace.error {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.circle").foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 7) {
                        Text(error).font(.caption).textSelection(.enabled)
                        if !workspace.messages.isEmpty && !workspace.isStreaming {
                            Button("Retry last question") { workspace.retry(using: app) }.font(.caption)
                        }
                    }
                    Spacer(minLength: 0)
                    Button {
                        workspace.error = nil
                    } label: {
                        Image(systemName: "xmark")
                    }.scholiaButtonStyle(.plain)
                }.padding(12).background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 9)).padding(
                    .horizontal, 16
                ).padding(.bottom, 8)
            }
            composer
        }.background(StudyPalette.paper(dark))
    }
    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    if workspace.messages.isEmpty { emptyConversation }
                    ForEach(workspace.messages) { message in messageView(message) }
                    Color.clear.frame(height: 1).id("study-chat-bottom")
                }.padding(.horizontal, 21).padding(.top, 20).padding(.bottom, 10)
            }
            .onChange(of: workspace.messages.count) { _, _ in
                followOutput = true
                proxy.scrollTo("study-chat-bottom", anchor: .bottom)
            }
            .onChange(of: workspace.messages.last?.content) { _, _ in
                if followOutput { proxy.scrollTo("study-chat-bottom", anchor: .bottom) }
            }
            .onChange(of: workspace.library.selectedThreadID) { _, _ in
                followOutput = true
                proxy.scrollTo("study-chat-bottom", anchor: .bottom)
            }
            .overlay(alignment: .bottomTrailing) {
                if workspace.isCurrentThreadStreaming {
                    Button {
                        followOutput.toggle()
                        if followOutput { proxy.scrollTo("study-chat-bottom", anchor: .bottom) }
                    } label: {
                        Image(systemName: followOutput ? "pause" : "arrow.down")
                    }.scholiaButtonStyle(.bordered).controlSize(.small).help(
                        followOutput ? "Pause following the answer" : "Follow the answer"
                    ).padding(10)
                }
            }
        }
    }
    private var emptyConversation: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "leaf").font(.system(size: 29, weight: .light)).foregroundStyle(Color.accentColor)
                .padding(.top, 20)
            Text("Let's make it click.").font(.system(size: 24, design: .serif))
            Text(
                workspace.document == nil
                    ? "Open a reading and bring your questions. We can unpack an idea, work through a problem, or practise together."
                    : "Ask about a passage, equation, or figure. I'll use this page and the rest of your reading to help you understand."
            )
            .font(.system(size: 12)).foregroundStyle(.secondary).lineSpacing(5).fixedSize(
                horizontal: false, vertical: true)
            VStack(spacing: 8) {
                suggestion(.explain, icon: "lightbulb")
                suggestion(.guide, icon: "point.topleft.down.to.point.bottomright.curvepath")
                suggestion(.practice, icon: "checkmark.bubble")
            }.padding(.top, 7)
            Text("Grounded in your materials. Room for your curiosity.").font(.system(size: 10)).foregroundStyle(
                .tertiary
            ).lineSpacing(3)
        }
    }
    private func suggestion(_ mode: StudyTeachingMode, icon: String) -> some View {
        Button {
            workspace.prepareStudyPrompt(mode)
            composerFocused = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: icon).frame(width: 18).foregroundStyle(Color.accentColor)
                Text(mode.starterTitle).font(.system(size: 11))
                Spacer()
                Image(systemName: "arrow.up.left").font(.system(size: 9)).foregroundStyle(.tertiary)
            }.padding(13).background(.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 9))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(.primary.opacity(0.055), lineWidth: 1))
        }.scholiaButtonStyle(.plain).disabled(workspace.course == nil)
    }
    private func messageView(_ message: ConversationMessage) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text(message.role == .user ? "YOU" : "SCHOLIA").font(.system(size: 9, weight: .semibold)).tracking(1.4)
                    .foregroundStyle(.secondary)
                Spacer()
                if !message.isStreaming {
                    if message.role == .user {
                        Button {
                            workspace.edit(message)
                            composerFocused = true
                        } label: {
                            Image(systemName: "pencil")
                        }.help("Edit and regenerate from this message").disabled(workspace.isStreaming)
                    }
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(message.content, forType: .string)
                    } label: {
                        Image(systemName: "doc.on.doc")
                    }.help("Copy message")
                }
            }.font(.system(size: 10)).scholiaButtonStyle(.plain)
            if let data = message.imageData { ConversationMessageImageView(data: data, compact: true) }
            if message.role == .user {
                Text(message.content).font(.system(size: 13)).lineSpacing(4).textSelection(.enabled).fixedSize(
                    horizontal: false, vertical: true)
            } else {
                if let reasoning = message.reasoning, !reasoning.isEmpty {
                    ProviderReasoningView(source: reasoning, compact: true)
                }
                if message.content.isEmpty && message.isStreaming {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Thinking with your materials…").font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    RichMarkdownView(source: message.content, compact: true)
                }
                if !message.isStreaming, let sources = workspace.thread?.sources[message.id.uuidString],
                    !sources.isEmpty
                {
                    let cited = StudyContextBuilder.citedSources(in: message.content, allowed: sources)
                    if !cited.isEmpty {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.turn.down.right").font(.system(size: 9)).foregroundStyle(.tertiary)
                            ForEach(cited.prefix(8)) { source in
                                Button("p. \(source.page)") { workspace.navigate(to: source) }
                                    .scholiaButtonStyle(.bordered).controlSize(.mini).help(
                                        "Read \(source.title), page \(source.page)")
                            }
                        }
                    }
                    DisclosureGroup {
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 95), alignment: .leading)], alignment: .leading,
                            spacing: 6
                        ) {
                            ForEach(sources) { source in
                                Button {
                                    workspace.navigate(to: source)
                                } label: {
                                    Text(
                                        source.documentID == workspace.document?.id
                                            ? "Page \(source.page)" : "\(source.title) · p. \(source.page)"
                                    )
                                    .font(.system(size: 10)).lineLimit(1)
                                }.scholiaButtonStyle(.bordered).controlSize(.mini).help(
                                    "\(source.title), page \(source.page)")
                            }
                        }.padding(.top, 7)
                    } label: {
                        Label("\(sources.count) pages provided", systemImage: "doc.text.magnifyingglass").font(
                            .system(size: 10)
                        ).foregroundStyle(.secondary)
                    }
                }
                if let metadata = message.metadata {
                    Text(metadata).font(.system(size: 9)).foregroundStyle(.tertiary).lineLimit(2)
                }
            }
        }.padding(message.role == .user ? 13 : 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                message.role == .user ? Color.accentColor.opacity(dark ? 0.12 : 0.06) : .clear,
                in: RoundedRectangle(cornerRadius: 12))
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if workspace.editingMessageID != nil {
                HStack {
                    Text("Editing · later replies will be replaced on send").font(.system(size: 10)).foregroundStyle(
                        .secondary)
                    Spacer()
                    Button("Cancel", action: workspace.cancelEdit).font(.caption).scholiaButtonStyle(.plain)
                }
            }
            if !workspace.selectedText.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "text.quote").foregroundStyle(Color.accentColor)
                    Text(workspace.selectedText).font(.system(size: 10)).lineLimit(3).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    Button {
                        workspace.selectedText = ""
                    } label: {
                        Image(systemName: "xmark")
                    }.scholiaButtonStyle(.plain)
                }.padding(9).background(Color.accentColor.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
            }
            if let data = workspace.draftImage {
                HStack(alignment: .top) {
                    ConversationMessageImageView(data: data, compact: true).frame(maxHeight: 90)
                    Button {
                        workspace.draftImage = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                    }.scholiaButtonStyle(.plain).help("Remove attached image")
                }
            }
            VStack(alignment: .leading, spacing: 9) {
                ComposerTextView(
                    text: $workspace.draft, isFocused: $composerFocused,
                    placeholder: workspace.course == nil
                        ? "Create a workspace to begin…" : "Ask about what you're reading…",
                    font: .systemFont(ofSize: 13), height: 70, isEnabled: workspace.course != nil,
                    onSubmit: { workspace.send(using: app) }, onPasteImage: workspace.attachImage)
                HStack(spacing: 9) {
                    Button(action: workspace.chooseQuestionImage) { Image(systemName: "plus") }.scholiaButtonStyle(
                        .plain
                    ).help("Attach an image").disabled(workspace.course == nil)
                    Button {
                        modelsPresented.toggle()
                    } label: {
                        HStack(spacing: 4) {
                            Text(modelDefinition?.label ?? app.activeModel).lineLimit(1).truncationMode(.middle)
                            Image(systemName: "chevron.down").font(.system(size: 8))
                        }.font(.system(size: 10)).foregroundStyle(.secondary)
                    }.scholiaButtonStyle(.plain).popover(isPresented: $modelsPresented) {
                        ScholiaModelPickerPopover(isPresented: $modelsPresented, usesExplainModel: true)
                            .environmentObject(app)
                    }
                    if let definition = modelDefinition, !definition.reasoningEfforts.isEmpty {
                        Menu {
                            ForEach(definition.reasoningEfforts, id: \.self) { effort in
                                Button(effort.capitalized) {
                                    app.settings.reasoningEfforts[app.activeProvider.id] = effort
                                    app.persistSettings()
                                }
                            }
                        } label: {
                            Image(systemName: "brain")
                        }.menuStyle(.borderlessButton).scholiaPointingCursor().frame(width: 18).help(
                            "Reasoning effort: \(app.settings.reasoningEfforts[app.activeProvider.id] ?? definition.defaultReasoningEffort ?? "default")"
                        )
                    }
                    Spacer(minLength: 0)
                    Button {
                        if workspace.isCurrentThreadStreaming {
                            workspace.stopAnswer()
                        } else {
                            workspace.send(using: app)
                        }
                    } label: {
                        Image(systemName: workspace.isCurrentThreadStreaming ? "stop.fill" : "arrow.up")
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).frame(
                                width: 29, height: 29
                            )
                            .background(
                                Color.accentColor.opacity(
                                    workspace.canSend || workspace.isCurrentThreadStreaming ? 1 : 0.4),
                                in: RoundedRectangle(cornerRadius: 8))
                    }.scholiaButtonStyle(.plain).disabled(!workspace.canSend && !workspace.isCurrentThreadStreaming)
                        .help(workspace.isCurrentThreadStreaming ? "Stop response" : "Send question")
                }
            }.padding(12).background(
                dark ? Color.primary.opacity(0.035) : .white, in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.primary.opacity(0.13), lineWidth: 1))
            HStack(spacing: 4) {
                Image(systemName: visionAvailable ? "eye" : "text.alignleft")
                Text(
                    visionAvailable
                        ? "Page visuals included with your question" : "Text model · select Vision for figures")
                Spacer(minLength: 0)
                Text("↵ send").foregroundStyle(.tertiary)
            }.font(.system(size: 9)).foregroundStyle(.secondary)
        }.padding(.horizontal, 17).padding(.top, 12).padding(.bottom, 17)
            .onChange(of: workspace.draft) { _, _ in workspace.saveDraft() }
            .onChange(of: workspace.draftImage) { _, _ in workspace.saveDraft() }
            .onChange(of: workspace.mode) { _, _ in workspace.saveDraft() }
    }
    private var contextDetails: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text("What the tutor can see").font(.headline)
            Text(
                "The current page, your selection, and downloaded document text are prepared locally for each question. Long readings use relevant pages from the complete text index. Catalog-only materials are downloaded when you open them."
            )
            .font(.caption).foregroundStyle(.secondary)
            Toggle("Include relevant course materials", isOn: $workspace.includeCourseContext).font(.caption)
            if !workspace.contextSummary.isEmpty { Text("Last question: \(workspace.contextSummary)").font(.caption) }
            Text(
                "Vision models also receive the current page and up to three requested or relevant page images. Your chosen provider receives this context only when you send a question."
            )
            .font(.caption).foregroundStyle(.secondary)
            if let document = workspace.document, document.unreadablePages > 0 {
                Text(
                    "\(document.unreadablePages) pages have no extracted text after OCR. Open those pages and use a vision model to inspect them."
                ).font(.caption).foregroundStyle(.orange)
            }
        }.padding(20).frame(width: 300)
    }
}

private struct StudyCanvasSheet: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var token = ""
    @State private var advanced = false
    @State private var downloadAll = false

    var body: some View {
        VStack(alignment: .leading, spacing: 17) {
            HStack(spacing: 12) {
                Image(systemName: "link.circle").font(.system(size: 31)).foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Bring your courses along.").font(.system(size: 25, design: .serif))
                    Text("Every course in one library. Download at your own pace.").font(.caption).foregroundStyle(
                        .secondary)
                }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            HStack {
                TextField("Canvas address", text: $workspace.canvasAddress).textFieldStyle(.roundedBorder).disabled(
                    workspace.canvasBusy || workspace.canvasSigningIn)
                Button(workspace.canvasSigningIn ? "Hide sign-in" : "Sign in") {
                    do {
                        workspace.canvasAddress = try CanvasAddress.origin(workspace.canvasAddress).absoluteString
                        workspace.canvasSigningIn.toggle()
                    } catch { workspace.canvasStatus = error.localizedDescription }
                }.disabled(workspace.canvasBusy)
                Button(downloadAll ? "Download everything" : "Index all courses") {
                    workspace.loadCanvasCourses(downloadAll: downloadAll)
                }.disabled(workspace.canvasBusy).scholiaButtonStyle(.borderedProminent)
            }
            if workspace.canvasSigningIn, let origin = try? CanvasAddress.origin(workspace.canvasAddress) {
                CanvasSignInView(origin: origin).frame(height: 420).clipShape(RoundedRectangle(cornerRadius: 10))
                Text(
                    "Complete your institution's sign-in above, then choose Index all courses. Scholia never receives your password."
                ).font(.caption).foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Picker("How to bring your courses into Scholia", selection: $downloadAll) {
                        Text("Index first · download on demand").tag(false)
                        Text("Download everything for offline study").tag(true)
                    }.pickerStyle(.radioGroup).scholiaPointingCursor().disabled(workspace.canvasBusy)
                    Text(
                        downloadAll
                            ? "Lists every course and downloads supported PDFs, images, pages, notes, and assignments. Large libraries can take a while; you can stop and resume."
                            : "Adds cards for all courses and a searchable list of materials. Nothing is downloaded until you open a material. Favorite the courses you use most."
                    )
                    .font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    if workspace.library.canvasUserID != nil {
                        Button("Browse course cards") {
                            workspace.showCourseLibrary()
                            dismiss()
                        }.scholiaButtonStyle(.bordered)
                    }
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                    .background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
            }
            if let status = workspace.canvasStatus {
                HStack(alignment: .top, spacing: 9) {
                    if workspace.canvasBusy { ProgressView().controlSize(.small) }
                    Text(status).font(.caption).textSelection(.enabled)
                    Spacer()
                    if workspace.canvasBusy { Button("Stop", action: workspace.cancelCanvas).font(.caption) }
                }.padding(11).background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            if !workspace.canvasWarnings.isEmpty {
                DisclosureGroup("\(workspace.canvasWarnings.count) Canvas notices") {
                    ScrollView {
                        Text(workspace.canvasWarnings.joined(separator: "\n")).font(.caption).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }.frame(maxHeight: 100)
                }.font(.caption)
            }
            if !workspace.canvasSigningIn {
                DisclosureGroup("Personal development connection", isExpanded: $advanced) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(
                            "For your own Canvas account, a personal access token can be used if embedded sign-in is unavailable. It is stored in macOS Keychain. A distributed integration requires institution-approved OAuth."
                        ).font(.caption).foregroundStyle(.secondary)
                        HStack {
                            SecureField("Personal access token", text: $token).textFieldStyle(.roundedBorder)
                            Button("Connect") {
                                workspace.loadCanvasCourses(token: token, downloadAll: downloadAll)
                                token = ""
                            }.disabled(
                                token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || workspace.canvasBusy)
                        }
                        if let origin = try? CanvasAddress.origin(workspace.canvasAddress) {
                            Link(
                                "Open Canvas account settings",
                                destination: origin.appendingPathComponent("profile/settings")
                            ).font(.caption)
                        }
                    }.padding(.top, 8)
                }.font(.caption)
            }
            HStack {
                Text("Course access is read-only. Nothing is submitted or changed in Canvas.").font(.system(size: 10))
                    .foregroundStyle(.secondary)
                Spacer()
                if workspace.library.canvasUserID != nil {
                    Button("Disconnect", action: workspace.disconnectCanvas).font(.caption).disabled(
                        workspace.canvasBusy)
                }
            }
        }.padding(27).frame(width: 690)
            .background(StudyPalette.paper(colorScheme == .dark))
            .tint(ScholiaVisualStyle.accentColor(for: colorScheme))
            .accentColor(ScholiaVisualStyle.accentColor(for: colorScheme))
            .interactiveDismissDisabled(workspace.canvasBusy)
    }
}
