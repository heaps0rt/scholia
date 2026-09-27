@preconcurrency import AppKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

typealias StudyCompletion =
    @MainActor (
        [ConversationMessage], ProviderConfiguration, @escaping @MainActor @Sendable (String) -> Void
    ) async throws -> CompletionResult

@MainActor
final class StudyWorkspaceModel: ObservableObject {
    @Published var library: StudyLibrary
    @Published private(set) var documentIndex: StudyDocumentIndex?
    @Published var currentPage = 1
    @Published var selectedText = ""
    @Published var draftImage: Data?
    @Published var selectingFigure = false
    @Published var includeCourseContext = true
    @Published var error: String?
    @Published var activity: String?
    @Published private(set) var isImporting = false
    @Published private(set) var streamingThreadID: UUID?
    @Published private(set) var contextSummary = ""
    @Published var canvasPresented = false
    @Published var canvasSigningIn = false
    @Published var canvasAddress = "https://canvas.ntnu.no"
    @Published var canvasCourses: [CanvasCourseSummary] = []
    @Published var canvasStatus: String?
    @Published var canvasWarnings: [String] = []
    @Published var canvasBusy = false
    @Published private(set) var fetchingMaterialID: String?
    @Published private(set) var canvasActivityCourseID: UUID?
    @Published var mode: StudyTeachingMode = .explain
    @Published var draft = ""
    @Published var practicePresented = false
    @Published var practiceScreen = "setup"
    let learning: StudyLearningModel
    var practiceTask: Task<Void, Never>?
    var practiceTicket: UUID?
    @Published private(set) var editingMessageID: UUID?
    @Published private(set) var assignmentText = ""
    @Published private(set) var assignmentNotice: String?
    @Published private(set) var assignmentFileNotices: [String: String] = [:]

    let store: StudyLibraryStore
    let documentEditing: StudyEditingState
    private var canSave = true
    private var answerTask: Task<Void, Never>?
    private var importTask: Task<Void, Never>?
    private var indexTask: Task<Void, Never>?
    private var canvasTask: Task<Void, Never>?
    private var activeAnswerID: UUID?
    private var canvasClient: CanvasClient?
    private var canvasAccount: CanvasAccount?
    private var connectedOrigin: URL?
    private var saveTask: Task<Void, Never>?
    private let libraryWriter: StudyLibraryWriter
    @Published private var backRoutes: [StudyNavigation] = []
    @Published private var forwardRoutes: [StudyNavigation] = []
    @Published var preloadFrequentCourses =
        UserDefaults.standard.object(forKey: "study.preloadFrequentCourses") as? Bool ?? true
    {
        didSet {
            UserDefaults.standard.set(preloadFrequentCourses, forKey: "study.preloadFrequentCourses")
            if !preloadFrequentCourses { cancelPreloading() }
        }
    }
    @Published private(set) var preloadStatus: String?
    private var preloadTask: Task<Void, Never>?
    private var preloadTicket: UUID?
    private var restoringNavigation = false
    var canGoBack: Bool { !backRoutes.isEmpty }
    var canGoForward: Bool { !forwardRoutes.isEmpty }
    private var navigation: StudyNavigation {
        StudyNavigation(
            library: isShowingLibrary, course: course?.id, document: document?.id, assignment: assignment?.id,
            assignmentFile: library.selectedAssignmentFileID, thread: thread?.id, page: currentPage)
    }
    private func recordNavigation() {
        guard !restoringNavigation else { return }
        saveDraft()
        if backRoutes.last != navigation { backRoutes.append(navigation) }
        if backRoutes.count > 80 { backRoutes.removeFirst() }
        forwardRoutes.removeAll()
    }
    func goBack() {
        saveDraft()
        guard let target = backRoutes.popLast() else { return }
        forwardRoutes.append(navigation)
        restoreNavigation(target)
    }
    func goForward() {
        saveDraft()
        guard let target = forwardRoutes.popLast() else { return }
        backRoutes.append(navigation)
        restoreNavigation(target)
    }
    private func restoreNavigation(_ target: StudyNavigation) {
        restoringNavigation = true
        defer { restoringNavigation = false }
        saveBeforeNavigating()
        cancelPracticePreparation()
        cancelPreloading()
        let course = library.courses.first { $0.id == target.course }
        library.selectedCourseID = course?.id
        library.showingCourseLibrary = target.library || course == nil
        library.selectedDocumentID = course?.documents.first { $0.id == target.document }?.id
        library.selectedAssignmentID = course?.materials.first { $0.id == target.assignment }?.id
        library.selectedAssignmentFileID = target.assignmentFile
        library.selectedThreadID = course?.threads.first { $0.id == target.thread }?.id
        restoreThread()
        loadSelectedDocument()
        loadAssignmentText()
        setPage(target.page)
        save()
    }
    private func saveBeforeNavigating() {
        saveDraft()
        saveTask?.cancel()
        documentEditing.flush()
        save()
    }
    private func cancelPreloading() {
        preloadTask?.cancel()
        preloadTask = nil
        preloadTicket = nil
        preloadStatus = nil
    }

    private func visitedCourse() {
        cancelPreloading()
        guard let ci = courseIndex(), !isShowingLibrary else { return }
        let last = library.courses[ci].lastVisitedAt ?? .distantPast
        if Date().timeIntervalSince(last) > 60 {
            library.courses[ci].visitCount = (library.courses[ci].visitCount ?? 0) + 1
            library.courses[ci].lastVisitedAt = Date()
        }
        guard preloadFrequentCourses, let course, !StudyCoursePreloading.candidates(in: course).isEmpty else { return }
        let ticket = UUID()
        preloadTicket = ticket
        preloadTask = Task(priority: .utility) { [weak self] in
            do {
                try await Task.sleep(for: .seconds(3))
                guard let self else { return }
                defer {
                    // A cancelled task can finish after a new visit has scheduled another.
                    if preloadTicket == ticket {
                        preloadStatus = nil
                        preloadTask = nil
                        preloadTicket = nil
                    }
                }
                guard canPreload(courseID: course.id, ticket: ticket) else { return }
                let client = try await connectedClient(for: course)
                for item in StudyCoursePreloading.candidates(in: course) {
                    try Task.checkCancellation()
                    guard canPreload(courseID: course.id, ticket: ticket) else { return }
                    preloadStatus = "Saving \(item.title) for offline use…"
                    _ = try await fetchMaterial(item, courseID: course.id, client: client, background: true)
                }
            } catch {
                // Expired sign-in or failed background transfers must not interrupt reading.
                if let self, preloadTicket == ticket {
                    preloadStatus = nil
                    preloadTask = nil
                    preloadTicket = nil
                }
            }
        }
    }

    private func canPreload(courseID: UUID, ticket: UUID) -> Bool {
        preloadTicket == ticket && preloadFrequentCourses && !isShowingLibrary
            && !canvasBusy && !isImporting && !isStreaming && course?.id == courseID
            && !ProcessInfo.processInfo.isLowPowerModeEnabled
            && ProcessInfo.processInfo.thermalState.rawValue < ProcessInfo.ThermalState.serious.rawValue
    }

    private struct SemesterInput: Equatable {
        var id: UUID
        var name: String
        var code: String
        var term: String?
        var favorite: Bool
        init(_ course: StudyCourse) {
            id = course.id
            name = course.name
            code = course.code
            term = course.term
            favorite = course.isFavorite
        }
    }
    private var semesterCache: (input: [SemesterInput], current: StudySemester, groups: [StudySemesterGroup])?

    init(store: StudyLibraryStore = StudyLibraryStore()) {
        self.store = store
        libraryWriter = StudyLibraryWriter(store: store)
        learning = StudyLearningModel(root: store.root)
        documentEditing = StudyEditingState(store: store)
        do { library = try store.load() } catch {
            library = StudyLibrary()
            canSave = false
            self.error =
                "Could not open your study library: \(error.localizedDescription) The original library has been preserved."
        }
        canvasAddress = library.canvasOrigin
        canvasStatus = library.canvasRefreshSummary
        canvasWarnings = library.courses.flatMap { course in
            (course.catalogWarnings ?? []).map { "\(course.code.isEmpty ? course.name : course.code): \($0)" }
        }
        if let course = library.courses.first(where: { $0.id == library.selectedCourseID }) {
            if let thread = course.threads.first(where: { $0.id == library.selectedThreadID }) {
                draft = thread.draft
                draftImage = thread.draftImage
                mode = thread.mode
            }
        } else {
            library.selectedCourseID = library.courses.first?.id
            library.selectedDocumentID = nil
            library.selectedThreadID = nil
        }
        loadSelectedDocument()
        loadAssignmentText()
    }

    var isShowingLibrary: Bool { library.showingCourseLibrary ?? (library.selectedCourseID == nil) }
    var courseLibraryView: StudyCourseLibraryViewMode { library.courseLibraryView ?? .all }
    var semesterGroups: [StudySemesterGroup] {
        let input = library.courses.map(SemesterInput.init)
        let current = StudySemester.current()
        if let cache = semesterCache, cache.input == input, cache.current == current { return cache.groups }
        let groups = StudySemesterGroup.make(courses: sortedCourses)
        semesterCache = (input, current, groups)
        return groups
    }
    var selectedSemesterID: String {
        let id = library.selectedSemesterID ?? "all"
        return id == "all" || semesterGroups.contains(where: { $0.id == id }) ? id : "all"
    }
    func setCourseLibraryView(_ mode: StudyCourseLibraryViewMode) {
        library.courseLibraryView = mode
        save()
    }
    func selectSemester(_ id: String) {
        guard id == "all" || semesterGroups.contains(where: { $0.id == id }) else { return }
        library.selectedSemesterID = id
        save()
    }
    var sortedCourses: [StudyCourse] {
        library.courses.sorted {
            if $0.isFavorite != $1.isFavorite { return $0.isFavorite }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }
    var recentReadings: [StudyRecentReading] { StudyRecentReading.inCourses(library.courses) }
    func resumeReading(_ documentID: UUID) {
        guard let target = library.courses.first(where: { $0.documents.contains(where: { $0.id == documentID }) })
        else { return }
        recordNavigation()
        if course?.id != target.id { selectCourse(target.id, recordHistory: false) }
        selectDocument(documentID, recordHistory: false)
    }
    func prepareStudyPrompt(_ teachingMode: StudyTeachingMode) {
        if teachingMode == .practice {
            mode = .practice
            saveDraft()
            practiceScreen = "setup"
            practicePresented = true
            return
        }
        let prompt = teachingMode.starter(document: document)
        mode = teachingMode
        if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            draft = prompt
        } else if !draft.contains(prompt) {
            draft += "\n\n" + prompt
        }
        saveDraft()
    }
    func sidebarCourses(matching query: String) -> [StudyCourse] {
        if !query.isEmpty {
            return sortedCourses.filter { ($0.name + " " + $0.code).localizedCaseInsensitiveContains(query) }
        }
        var visible = Array(sortedCourses.prefix(7))
        if let course, !visible.contains(where: { $0.id == course.id }) { visible.append(course) }
        return visible
    }
    func showCourseLibrary() {
        recordNavigation()
        cancelPreloading()
        cancelPracticePreparation()
        saveBeforeNavigating()
        library.showingCourseLibrary = true
        library.selectedAssignmentID = nil
        save()
    }
    func showCourseMaterials() {
        recordNavigation()
        cancelPracticePreparation()
        saveBeforeNavigating()
        library.selectedDocumentID = nil
        library.selectedThreadID = nil
        library.selectedAssignmentID = nil
        restoreThread()
        loadSelectedDocument()
        save()
    }
    func setAssignmentHidden(_ id: String, courseID: UUID, hidden: Bool) {
        guard let index = library.courses.firstIndex(where: { $0.id == courseID }),
            library.courses[index].materials.contains(where: { $0.id == id && $0.kind == .assignments })
        else { return }
        var ids = Set(library.courses[index].hiddenAssignmentIDs ?? [])
        if hidden { ids.insert(id) } else { ids.remove(id) }
        library.courses[index].hiddenAssignmentIDs = ids.sorted()
        save()
    }

    func toggleFavorite(_ id: UUID) {
        guard let ci = library.courses.firstIndex(where: { $0.id == id }) else { return }
        library.courses[ci].favorite = !library.courses[ci].isFavorite
        save()
    }

    var course: StudyCourse? { library.courses.first { $0.id == library.selectedCourseID } }
    var document: StudyDocument? { course?.documents.first { $0.id == library.selectedDocumentID } }
    var assignment: CanvasMaterialReference? {
        course?.materials.first { $0.id == library.selectedAssignmentID && $0.kind == .assignments }
    }
    var assignmentFiles: [CanvasMaterialReference] {
        guard let course, let assignment else { return [] }
        return (assignment.assignment?.linkedFileIDs ?? []).map { id in
            course.materials.first(where: { $0.id == "files:\(id)" })
                ?? CanvasMaterialReference(
                    id: "files:\(id)", kind: .files, remoteID: id, title: "Canvas file \(id)",
                    sourceURL: "\(course.canvasOrigin ?? "")/courses/\(course.canvasID ?? 0)/files/\(id)", version: "")
        }
    }
    var assignmentPDFs: [CanvasMaterialReference] {
        assignmentFiles.filter { file in
            (file.fileName ?? file.title).lowercased().hasSuffix(".pdf")
                || course?.documents.contains(where: { $0.sourceKey == file.id && $0.kind == .pdf }) == true
        }
    }
    func assignmentFileStatus(_ file: CanvasMaterialReference) -> String {
        if fetchingMaterialID == file.id { return "Preparing…" }
        if let notice = assignmentFileNotices[file.id] { return notice }
        if let saved = course?.documents.first(where: { $0.sourceKey == file.id }),
            FileManager.default.fileExists(atPath: store.file(for: saved).path)
        {
            let availability =
                saved.kind == .preview || saved.unreadablePages == saved.pageCount
                ? "Saved · no readable text for companion" : "Ready for companion"
            return document?.id == saved.id ? "Open · \(availability)" : availability
        }
        return file.unavailableReason ?? "Not downloaded"
    }
    var thread: StudyThread? { course?.threads.first { $0.id == library.selectedThreadID } }
    var messages: [ConversationMessage] { thread?.messages ?? [] }
    var isStreaming: Bool { streamingThreadID != nil }
    var isCurrentThreadStreaming: Bool { streamingThreadID != nil && streamingThreadID == library.selectedThreadID }
    var currentPageText: String { documentIndex?.pages.first { $0.number == currentPage }?.text ?? "" }
    var canSend: Bool {
        course != nil && (document == nil || documentIndex != nil) && !isStreaming
            && (assignment == nil || !canvasBusy)
            && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draftImage != nil)
    }

    func save() {
        guard canSave else { return }
        libraryWriter.save(library) { [weak self] message in
            Task { @MainActor in self?.error = "Could not save your workspace: \(message)" }
        }
    }
    func saveDraft() {
        if let ci = courseIndex() {
            if threadIndex(in: ci) == nil && (!draft.isEmpty || draftImage != nil) {
                let thread = StudyThread(documentID: document?.id, mode: mode)
                library.courses[ci].threads.append(thread)
                library.selectedThreadID = thread.id
            }
            if let ti = threadIndex(in: ci) {
                library.courses[ci].threads[ti].draft = draft
                library.courses[ci].threads[ti].draftImage = draftImage
                library.courses[ci].threads[ti].mode = mode
            }
        }
        scheduleSave()
    }
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            self?.save()
        }
    }
    func flush() {
        saveDraft()
        saveTask?.cancel()
        documentEditing.flush()
        guard canSave else { return }
        do { try libraryWriter.flush(library) } catch {
            self.error = "Could not save your workspace: \(error.localizedDescription)"
        }
    }

    func createCourse(name: String, code: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, canSave else { return }
        let course = StudyCourse(name: String(name.prefix(180)), code: String(code.prefix(40)))
        library.courses.append(course)
        selectCourse(course.id)
    }
    func renameCourse(name: String, code: String) {
        guard let ci = courseIndex(), !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        library.courses[ci].name = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(180))
        library.courses[ci].code = String(code.prefix(40))
        save()
    }
    func removeCourse(_ id: UUID) {
        guard !isStreaming, !isImporting, !canvasBusy else { return }
        library.courses.removeAll { $0.id == id }
        if library.selectedCourseID == id { selectCourse(library.courses.first?.id) }
        save()
    }
    func selectCourse(_ id: UUID?, recordHistory: Bool = true) {
        if recordHistory { recordNavigation() }
        cancelPracticePreparation()
        saveBeforeNavigating()
        library.selectedAssignmentID = nil
        library.selectedCourseID = id
        library.showingCourseLibrary = id == nil
        library.selectedDocumentID = nil
        library.selectedThreadID = course?.threads.last(where: { $0.documentID == library.selectedDocumentID })?.id
        restoreThread()
        loadSelectedDocument()
        visitedCourse()
        save()
    }
    func selectDocument(_ id: UUID, assignmentID: String? = nil, recordHistory: Bool = true) {
        if recordHistory { recordNavigation() }
        cancelPracticePreparation()
        saveBeforeNavigating()
        library.selectedAssignmentID = assignmentID
        library.showingCourseLibrary = false
        library.selectedDocumentID = id
        library.selectedThreadID = course?.threads.last(where: { $0.documentID == id })?.id
        restoreThread()
        loadSelectedDocument()
        save()
    }
    func removeDocument(_ id: UUID) {
        guard !isStreaming, !isImporting, !canvasBusy, let ci = courseIndex() else { return }
        library.courses[ci].documents.removeAll { $0.id == id }
        if library.selectedDocumentID == id {
            library.selectedDocumentID = nil
            library.selectedThreadID = nil
            restoreThread()
            loadSelectedDocument()
        }
        save()
    }
    func selectThread(_ id: UUID) {
        recordNavigation()
        saveBeforeNavigating()
        guard let thread = course?.threads.first(where: { $0.id == id }) else { return }
        library.selectedAssignmentID = nil
        library.selectedThreadID = id
        library.selectedDocumentID = thread.documentID
        restoreThread()
        loadSelectedDocument()
        save()
    }
    func newThread() {
        guard let ci = courseIndex() else { return }
        flush()
        let thread = StudyThread(documentID: document?.id, mode: mode)
        library.courses[ci].threads.append(thread)
        library.selectedThreadID = thread.id
        draft = ""
        draftImage = nil
        selectedText = ""
        error = nil
        contextSummary = ""
        editingMessageID = nil
        save()
    }
    func removeThread(_ id: UUID) {
        guard id != streamingThreadID, let ci = courseIndex() else { return }
        library.courses[ci].threads.removeAll { $0.id == id }
        if library.selectedThreadID == id {
            library.selectedThreadID = nil
            restoreThread()
        }
        save()
    }
    private func restoreThread() {
        draft = thread?.draft ?? ""
        mode = thread?.mode ?? .explain
        draftImage = thread?.draftImage
        selectedText = ""
        contextSummary = ""
        error = nil
        editingMessageID = nil
    }
    func setPage(_ page: Int) {
        guard let document else { return }
        let nextPage = min(max(1, page), max(1, document.pageCount))
        guard nextPage != currentPage else { return }
        cancelPracticePreparation()
        currentPage = nextPage
        selectedText = ""
        if let ci = courseIndex(), let di = library.courses[ci].documents.firstIndex(where: { $0.id == document.id }) {
            library.courses[ci].documents[di].lastPage = currentPage
            library.courses[ci].documents[di].lastOpenedAt = Date()
        }
        scheduleSave()
    }
    func navigate(to source: StudySource) {
        guard course?.documents.contains(where: { $0.id == source.documentID }) == true else { return }
        recordNavigation()
        // Keep the conversation and assignment context when following an included-file citation.
        let target = course?.documents.first { $0.id == source.documentID }
        let linkedKeys = Set((assignment?.assignment?.linkedFileIDs ?? []).map { "files:\($0)" })
        if let key = target?.sourceKey, key == assignment?.id || linkedKeys.contains(key) {
            library.selectedAssignmentFileID = linkedKeys.contains(key) ? key : nil
        } else {
            library.selectedAssignmentID = nil
            library.selectedAssignmentFileID = nil
        }
        library.selectedDocumentID = source.documentID
        loadSelectedDocument()
        setPage(source.page)
    }
    private func loadSelectedDocument() {
        cancelPracticePreparation()
        indexTask?.cancel()
        documentIndex = nil
        selectedText = ""
        selectingFigure = false
        currentPage = document?.lastPage ?? 1
        guard let document else { return }
        if !isShowingLibrary, let ci = courseIndex(),
            let di = library.courses[ci].documents.firstIndex(where: { $0.id == document.id })
        {
            library.courses[ci].documents[di].lastOpenedAt = Date()
            scheduleSave()
        }
        let store = store
        indexTask = Task { [weak self] in
            let result = await Task.detached { Result { try store.index(for: document) } }.value
            guard let self, !Task.isCancelled, self.document?.id == document.id else { return }
            switch result {
            case .success(let index): self.documentIndex = index
            case .failure(let error): self.error = "Could not load \(document.title): \(error.localizedDescription)"
            }
        }
    }
    func chooseDocuments() {
        guard course != nil, !isImporting else { return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.item]
        panel.prompt = "Add to course"
        panel.begin { [weak self] response in
            guard response == .OK else { return }
            Task { @MainActor in self?.importDocuments(panel.urls) }
        }
    }
    func importDocuments(_ urls: [URL]) {
        guard let courseID = course?.id, !isImporting, canSave else { return }
        isImporting = true
        error = nil
        let store = store
        importTask = Task { [weak self] in
            guard let self else { return }
            defer {
                isImporting = false
                activity = nil
            }
            for url in urls {
                if Task.isCancelled { break }
                activity = "Reading \(url.lastPathComponent)…"
                do {
                    let job = Task.detached(priority: .userInitiated) {
                        try StudyDocumentImporter.read(url: url, store: store)
                    }
                    let document = try await withTaskCancellationHandler(
                        operation: { try await job.value }, onCancel: { job.cancel() })
                    guard let ci = library.courses.firstIndex(where: { $0.id == courseID }) else { break }
                    library.courses[ci].documents.append(document)
                    if library.selectedCourseID == courseID { selectDocument(document.id) }
                    save()
                } catch is CancellationError { break } catch {
                    self.error = "\(url.lastPathComponent): \(error.localizedDescription)"
                }
            }
        }
    }
    func cancelImport() { importTask?.cancel() }
    func importBrowserDocument(data: Data, name: String) {
        guard let courseID = course?.id, !isImporting, canSave else { return }
        isImporting = true
        error = nil
        activity = "Reading \(name)…"
        let store = store
        importTask = Task { [weak self] in
            guard let self else { return }
            defer {
                isImporting = false
                activity = nil
            }
            do {
                let job = Task.detached { try StudyDocumentImporter.read(data: data, name: name, store: store) }
                let document = try await withTaskCancellationHandler(
                    operation: { try await job.value }, onCancel: { job.cancel() })
                guard let ci = library.courses.firstIndex(where: { $0.id == courseID }) else { return }
                library.courses[ci].documents.append(document)
                if library.selectedCourseID == courseID { selectDocument(document.id) }
                save()
            } catch is CancellationError {} catch { self.error = error.localizedDescription }
        }
    }
    func saveDocumentEdits(_ draft: StudyEditDraft) async throws {
        guard canSave, !isImporting, !canvasBusy, !isStreaming else {
            throw StudyError.message(
                "Wait for the current import, Canvas check or answer to finish before saving changes.")
        }
        guard
            let courseID = library.courses.first(where: { $0.documents.contains(where: { $0.id == draft.documentID }) }
            )?.id,
            let document = library.courses.first(where: { $0.id == courseID })?.documents.first(where: {
                $0.id == draft.documentID
            })
        else { throw StudyError.message("This document is no longer in the library.") }
        isImporting = true
        activity = "Saving local changes…"
        error = nil
        defer {
            isImporting = false
            activity = nil
        }
        let store = store
        let saved = try await Task.detached(priority: .userInitiated) {
            try StudyDocumentEditing.save(draft, document: document, store: store)
        }.value
        guard let ci = library.courses.firstIndex(where: { $0.id == courseID }),
            let di = library.courses[ci].documents.firstIndex(where: { $0.id == saved.id })
        else { return }
        library.courses[ci].documents[di] = saved
        if self.document?.id == saved.id { loadSelectedDocument() }
        save()
    }

    func attachImage(_ image: NSImage) {
        guard let data = ImageEncoding.jpegData(from: image) else {
            error = "The image could not be read."
            return
        }
        draftImage = data
    }
    func chooseQuestionImage() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            Task { @MainActor in
                guard let data = ImageEncoding.jpegData(fileAt: url) else {
                    self?.error = "The image could not be read or exceeds 25 MB."
                    return
                }
                self?.draftImage = data
            }
        }
    }

    func send(using app: AppModel, question: String? = nil) {
        if let question { draft = question }
        guard canSend, document == nil || documentIndex != nil else { return }
        let configuration: ProviderConfiguration
        do { configuration = try app.studyProviderConfiguration() } catch {
            self.error = error.localizedDescription
            return
        }
        submit(configuration: configuration) { messages, configuration, onToken in
            try await app.completeStudy(messages: messages, configuration: configuration, onToken: onToken)
        }
    }

    func submit(configuration: ProviderConfiguration, complete: @escaping StudyCompletion) {
        guard canSend, let course, document == nil || documentIndex != nil else { return }
        if draftImage != nil && !configuration.studyImageInputAllowed {
            error = "This model cannot read images. Choose a vision model from the model picker."
            return
        }
        if thread == nil { saveDraft() }
        guard let ci = courseIndex(), let ti = threadIndex(in: ci) else { return }
        if let editingMessageID,
            let position = library.courses[ci].threads[ti].messages.firstIndex(where: { $0.id == editingMessageID })
        {
            library.courses[ci].threads[ti].messages.removeSubrange(position...)
        }
        editingMessageID = nil
        let question =
            draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Explain this image in the context of the document."
            : draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let user = ConversationMessage(
            role: .user, content: question, imageData: draftImage, imageMimeType: draftImage == nil ? nil : "image/jpeg"
        )
        library.courses[ci].threads[ti].messages.append(user)
        if library.courses[ci].threads[ti].messages.count == 1 {
            library.courses[ci].threads[ti].title = String(question.prefix(70))
        }
        library.courses[ci].threads[ti].mode = mode
        library.courses[ci].threads[ti].draft = ""
        library.courses[ci].threads[ti].draftImage = nil
        library.courses[ci].threads[ti].updatedAt = Date()
        let requestMessages = library.courses[ci].threads[ti].messages
        let threadID = library.courses[ci].threads[ti].id
        let assistantID = UUID()
        library.courses[ci].threads[ti].messages.append(
            ConversationMessage(id: assistantID, role: .assistant, content: "", isStreaming: true))
        streamingThreadID = threadID
        activeAnswerID = assistantID
        draft = ""
        draftImage = nil
        error = nil
        let doc = document
        let index = documentIndex
        let page = currentPage
        let selection = selectedText
        let store = store
        let includeCourse = includeCourseContext
        let assignment = assignment
        let assignmentFileNotices = assignmentFileNotices
        let mode = mode
        contextSummary = "Reading your sources…"
        save()
        answerTask = Task { [weak self] in
            guard let self else { return }
            do {
                let prepared = await Task.detached(priority: .userInitiated) {
                    let pack = StudyContextBuilder.build(
                        document: doc, index: index, currentPage: page, question: question,
                        selection: selection, course: course, store: store, includeCourse: includeCourse,
                        assignment: assignment, assignmentFileNotices: assignmentFileNotices)
                    let images =
                        configuration.studyImageInputAllowed
                        ? doc.map { StudyContextBuilder.pageImages(document: $0, pages: pack.imagePages, store: store) }
                            ?? [] : []
                    return (pack, images)
                }.value
                try Task.checkCancellation()
                contextSummary =
                    prepared.0.summary
                    + (prepared.1.isEmpty
                        ? " · Text context" : " · \(prepared.1.count) page image\(prepared.1.count == 1 ? "" : "s")")
                mutateThread(courseID: course.id, threadID: threadID) {
                    $0.sources[assistantID.uuidString] = prepared.0.sources
                }
                let result = try await complete(
                    StudyContextBuilder.requestMessages(
                        requestMessages, pack: prepared.0, mode: mode, images: prepared.1),
                    configuration
                ) { [weak self] token in
                    guard let self, self.activeAnswerID == assistantID else { return }
                    self.updateMessage(courseID: course.id, threadID: threadID, messageID: assistantID) {
                        $0.content += token
                    }
                }
                guard activeAnswerID == assistantID else { return }
                updateMessage(courseID: course.id, threadID: threadID, messageID: assistantID) {
                    $0.content = result.text
                    $0.reasoning = result.reasoning
                    $0.isStreaming = false
                    $0.metadata = "\(result.model) · \(prepared.0.summary)"
                }
            } catch {
                guard activeAnswerID == assistantID else { return }
                if !(error is CancellationError) { self.error = error.localizedDescription }
                updateMessage(courseID: course.id, threadID: threadID, messageID: assistantID) {
                    $0.isStreaming = false
                    $0.metadata = error is CancellationError ? "Stopped" : "Response interrupted"
                }
                mutateThread(courseID: course.id, threadID: threadID) {
                    $0.messages.removeAll { $0.id == assistantID && $0.content.isEmpty }
                }
            }
            guard activeAnswerID == assistantID else { return }
            streamingThreadID = nil
            activeAnswerID = nil
            save()
        }
    }
    func stopAnswer() { answerTask?.cancel() }
    func retry(using app: AppModel) {
        guard !isStreaming, let ci = courseIndex(), let ti = threadIndex(in: ci),
            let ui = library.courses[ci].threads[ti].messages.lastIndex(where: { $0.role == .user })
        else { return }
        let user = library.courses[ci].threads[ti].messages[ui]
        library.courses[ci].threads[ti].messages.removeSubrange(ui...)
        draft = user.content
        draftImage = user.imageData
        send(using: app)
    }
    func edit(_ message: ConversationMessage) {
        guard !isStreaming, messages.contains(where: { $0.id == message.id }) else { return }
        draft = message.content
        draftImage = message.imageData
        editingMessageID = message.id
        saveDraft()
    }
    func cancelEdit() {
        editingMessageID = nil
        draft = ""
        draftImage = nil
        saveDraft()
    }

    func importConversation(_ conversation: StoredConversation) {
        guard let ci = courseIndex() else { return }
        var thread = StudyThread(title: conversation.title, documentID: document?.id)
        thread.messages = conversation.messages
        library.courses[ci].threads.append(thread)
        selectThread(thread.id)
    }

    /// Connecting indexes every course first. Downloading bodies/files is a separate opt-in.
    func loadCanvasCourses(token: String? = nil, downloadAll: Bool = false, clientOverride: CanvasClient? = nil) {
        guard !canvasBusy, canSave else { return }
        canvasBusy = true
        canvasStatus = "Finding your Canvas courses…"
        canvasWarnings = []
        canvasTask = Task { [weak self] in
            guard let self else { return }
            defer {
                canvasBusy = false
                canvasActivityCourseID = nil
                fetchingMaterialID = nil
                save()
            }
            do {
                let origin = try CanvasAddress.origin(canvasAddress)
                let client: CanvasClient
                if let clientOverride {
                    client = clientOverride
                } else if let token, !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    client = CanvasClient(origin: origin, token: token.trimmingCharacters(in: .whitespacesAndNewlines))
                } else {
                    client = try await CanvasSession.client(origin: origin)
                }
                let account = try await client.account()
                if let previous = canvasClient, connectedOrigin == origin, canvasAccount?.id == account.id {
                    await client.reuseMetadata(from: previous)
                }
                let courses = try await client.courses()
                try Task.checkCancellation()
                if clientOverride == nil, let token, !token.isEmpty {
                    try ProviderKeychain.set(
                        token.trimmingCharacters(in: .whitespacesAndNewlines), for: "canvas:\(origin.absoluteString)")
                }
                canvasClient = client
                canvasAccount = account
                connectedOrigin = origin
                canvasCourses = courses
                let firstConnection = library.canvasUserID == nil
                library.canvasOrigin = origin.absoluteString
                library.canvasUserID = account.id
                library.canvasUserName = account.name
                canvasAddress = origin.absoluteString
                canvasSigningIn = false
                var ids: [UUID] = []
                var newCourses = 0
                var changedCourses = 0
                var unavailableCourses = 0
                for remote in courses {
                    if let ci = library.courses.firstIndex(where: {
                        $0.canvasID == remote.id && $0.canvasOrigin == origin.absoluteString
                            && $0.canvasUserID == account.id
                    }) {
                        if let favorite = remote.favorite { library.courses[ci].canvasFavorite = favorite }
                        if library.courses[ci].name != remote.name || library.courses[ci].code != remote.code
                            || library.courses[ci].term != remote.term || library.courses[ci].canvasAvailable == false
                        {
                            changedCourses += 1
                            library.courses[ci].name = remote.name
                            library.courses[ci].code = remote.code
                            library.courses[ci].term = remote.term
                        }
                        if library.courses[ci].canvasAvailable != true { library.courses[ci].canvasAvailable = true }
                        ids.append(library.courses[ci].id)
                    } else {
                        let course = StudyCourse(
                            name: remote.name, code: remote.code, canvasID: remote.id,
                            canvasOrigin: origin.absoluteString, canvasUserID: account.id,
                            canvasFavorite: remote.favorite, term: remote.term, canvasAvailable: true)
                        library.courses.append(course)
                        ids.append(course.id)
                        newCourses += 1
                    }
                }
                let present = Set(ids)
                for ci in library.courses.indices
                where library.courses[ci].canvasOrigin == origin.absoluteString
                    && library.courses[ci].canvasUserID == account.id && !present.contains(library.courses[ci].id)
                {
                    if library.courses[ci].canvasAvailable != false {
                        unavailableCourses += 1
                        library.courses[ci].canvasAvailable = false
                    }
                }
                if firstConnection { showCourseLibrary() } else { save() }
                let courseChanges = [
                    (newCourses, "new courses"), (changedCourses, "course details updated"),
                    (unavailableCourses, "courses no longer listed"),
                ]
                .filter { $0.0 > 0 }.map { "\($0.0) \($0.1)" }.joined(separator: " · ")
                try await syncCatalogs(ids, client: client, downloadAll: downloadAll, courseChanges: courseChanges)
            } catch is CancellationError {
                canvasStatus = "Stopped. Course cards and completed downloads are saved."
            } catch { canvasStatus = error.localizedDescription }
        }
    }

    func syncCanvasCourses(courseIDs: [UUID], downloadAll: Bool = false) {
        guard !canvasBusy, canSave, !courseIDs.isEmpty else { return }
        canvasBusy = true
        canvasWarnings = []
        canvasStatus = "Connecting to Canvas…"
        canvasTask = Task { [weak self] in
            guard let self else { return }
            defer {
                canvasBusy = false
                canvasActivityCourseID = nil
                fetchingMaterialID = nil
                save()
            }
            do {
                guard let course = library.courses.first(where: { $0.id == courseIDs[0] }) else { return }
                let client = try await connectedClient(for: course)
                try await syncCatalogs(courseIDs, client: client, downloadAll: downloadAll)
            } catch is CancellationError { canvasStatus = "Stopped. Completed work is saved." } catch {
                canvasStatus = error.localizedDescription
            }
        }
    }

    private func connectedClient(for course: StudyCourse) async throws -> CanvasClient {
        guard let value = course.canvasOrigin, let userID = course.canvasUserID else {
            throw StudyError.message("Connect this course to Canvas first.")
        }
        let origin = try CanvasAddress.origin(value)
        if let canvasClient, connectedOrigin == origin, canvasAccount?.id == userID { return canvasClient }
        let client = try await CanvasSession.client(origin: origin)
        let account = try await client.account()
        guard account.id == userID else {
            throw StudyError.message("Sign into the Canvas account that owns this course, then try again.")
        }
        canvasClient = client
        canvasAccount = account
        connectedOrigin = origin
        return client
    }

    private func syncCatalogs(_ ids: [UUID], client: CanvasClient, downloadAll: Bool, courseChanges: String = "")
        async throws
    {
        var catalogCount = 0
        var downloadCount = 0
        var changes = CanvasCatalogChanges()
        for (position, id) in ids.enumerated() {
            try Task.checkCancellation()
            guard let ci = library.courses.firstIndex(where: { $0.id == id }),
                let remoteID = library.courses[ci].canvasID
            else { continue }
            let course = library.courses[ci]
            guard course.canvasOrigin == connectedOrigin?.absoluteString, course.canvasUserID == canvasAccount?.id
            else { continue }
            canvasActivityCourseID = id
            canvasStatus = "Checking \(position + 1)/\(ids.count) · \(course.displayName)…"
            do {
                let catalog = try await client.catalog(courseID: remoteID)
                try Task.checkCancellation()
                let merged = CanvasCatalogChanges.reconcile(previous: course.canvasMaterials, catalog: catalog)
                if library.courses[ci].canvasMaterials != merged.items {
                    library.courses[ci].canvasMaterials = merged.items
                }
                library.courses[ci].catalogChanges = merged.changes
                if merged.changes.count > 0 { library.courses[ci].catalogChangedAt = Date() }
                library.courses[ci].catalogUpdatedAt = Date()
                library.courses[ci].catalogWarnings = catalog.warnings
                changes.added += merged.changes.added
                changes.updated += merged.changes.updated
                changes.removed += merged.changes.removed
                canvasWarnings += catalog.warnings.map { "\(course.code.isEmpty ? course.name : course.code): \($0)" }
                catalogCount += 1
                save()
                if downloadAll {
                    for (i, reference) in catalog.items.enumerated() {
                        try Task.checkCancellation()
                        canvasStatus =
                            "Downloading \(position + 1)/\(ids.count) courses · \(i + 1)/\(catalog.items.count) · \(reference.title)"
                        if let reason = reference.unavailableReason {
                            canvasWarnings.append("\(reference.title): \(reason)")
                            continue
                        }
                        if let cached = library.courses[ci].documents.first(where: { $0.sourceKey == reference.id }),
                            !reference.version.isEmpty, cached.sourceVersion == reference.version,
                            FileManager.default.fileExists(atPath: store.file(for: cached).path)
                        {
                            continue
                        }
                        do {
                            _ = try await fetchMaterial(reference, courseID: id, client: client)
                            downloadCount += 1
                        } catch {
                            try Task.checkCancellation()
                            canvasWarnings.append("\(reference.title): \(error.localizedDescription)")
                        }
                    }
                    library.courses[ci].syncedAt = Date()
                }
            } catch {
                try Task.checkCancellation()
                canvasWarnings.append("\(course.name): \(error.localizedDescription)")
            }
        }
        var summary = "\(catalogCount) courses checked. "
        if !courseChanges.isEmpty { summary += courseChanges + ". " }
        summary +=
            changes.summary.map { "Materials: \($0)." }
            ?? (canvasWarnings.isEmpty ? "No material changes." : "No changes in the available material metadata.")
        if downloadAll { summary += " \(downloadCount) materials downloaded or updated." }
        if !canvasWarnings.isEmpty { summary += " Some Canvas sections could not be checked." }
        canvasStatus = summary
        library.canvasRefreshSummary = summary
        library.canvasCheckedAt = Date()
    }

    func openCanvasMaterial(_ reference: CanvasMaterialReference, courseID: UUID) {
        cancelPreloading()
        if reference.kind == .assignments {
            openAssignment(reference, courseID: courseID)
            return
        }
        guard let course = library.courses.first(where: { $0.id == courseID }) else { return }
        if let document = course.documents.first(where: { $0.sourceKey == reference.id }),
            reference.version.isEmpty || document.sourceVersion == reference.version,
            FileManager.default.fileExists(atPath: store.file(for: document).path)
        {
            if self.course?.id != courseID { selectCourse(courseID) }
            selectDocument(document.id)
            return
        }
        guard !canvasBusy, canSave else { return }
        canvasBusy = true
        canvasWarnings = []
        canvasActivityCourseID = courseID
        canvasStatus = "Downloading \(reference.title)…"
        error = nil
        let openingDocumentID = library.selectedDocumentID
        let openingAssignmentID = library.selectedAssignmentID
        canvasTask = Task { [weak self] in
            guard let self else { return }
            defer {
                canvasBusy = false
                canvasActivityCourseID = nil
                fetchingMaterialID = nil
                save()
            }
            do {
                let client = try await connectedClient(for: course)
                let document = try await fetchMaterial(reference, courseID: courseID, client: client)
                if self.course?.id == courseID, !isShowingLibrary,
                    library.selectedDocumentID == openingDocumentID, library.selectedAssignmentID == openingAssignmentID
                {
                    selectDocument(document.id)
                }
                canvasStatus = "\(document.title) is saved for offline reading and tutor context."
            } catch is CancellationError { canvasStatus = "Download stopped. Your library is saved." } catch {
                canvasStatus = error.localizedDescription
                self.error = error.localizedDescription
            }
        }
    }

    private func loadAssignmentText() {
        assignmentText = ""
        guard let assignment, let document = course?.documents.first(where: { $0.sourceKey == assignment.id }),
            let index = try? store.index(for: document)
        else { return }
        assignmentText = index.pages.map(\.text).joined(separator: "\n\n")
        let heading = "# \(assignment.title)\n"
        if assignmentText.hasPrefix(heading) { assignmentText.removeFirst(heading.count) }
        assignmentText = assignmentText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Keep the assignment selected while its reader and companion files become available.
    func openAssignment(
        _ reference: CanvasMaterialReference, courseID: UUID, fileID: String? = nil, clientOverride: CanvasClient? = nil
    ) {
        guard reference.kind == .assignments, let target = library.courses.first(where: { $0.id == courseID }),
            let remoteID = target.canvasID
        else { return }
        let requestedFileID =
            fileID
            ?? (self.course?.id == courseID && assignment?.id == reference.id ? library.selectedAssignmentFileID : nil)
        recordNavigation()
        selectCourse(courseID, recordHistory: false)
        library.selectedAssignmentID = reference.id
        library.selectedAssignmentFileID = requestedFileID
        assignmentNotice = nil
        assignmentFileNotices = [:]
        loadAssignmentText()
        save()
        guard reference.unavailableReason == nil else {
            assignmentNotice = reference.unavailableReason
            return
        }
        let initial =
            requestedFileID.flatMap { id in assignmentFiles.first { $0.id == id } }
            ?? assignmentPDFs.first ?? assignmentFiles.first
        if let initial, let cached = target.documents.first(where: { $0.sourceKey == initial.id }),
            FileManager.default.fileExists(atPath: store.file(for: cached).path)
        {
            library.selectedAssignmentFileID = initial.id
            selectDocument(cached.id, assignmentID: reference.id, recordHistory: false)
        }
        guard !canvasBusy, canSave else {
            assignmentNotice = "A sync is running. Retry after it finishes to prepare missing assignment files."
            return
        }
        canvasBusy = true
        canvasActivityCourseID = courseID
        error = nil
        canvasStatus = "Preparing \(reference.title)…"
        let openingDocumentID = library.selectedDocumentID
        let openingFileID = library.selectedAssignmentFileID
        canvasTask = Task { [weak self] in
            guard let self else { return }
            defer {
                canvasBusy = false
                canvasActivityCourseID = nil
                fetchingMaterialID = nil
                save()
            }
            @MainActor func stillSelected() -> Bool {
                self.course?.id == courseID && library.selectedAssignmentID == reference.id && !isShowingLibrary
            }
            var resolvedClient = clientOverride
            @MainActor func client() async throws -> CanvasClient {
                if let resolvedClient { return resolvedClient }
                let connected = try await connectedClient(for: target)
                resolvedClient = connected
                return connected
            }
            @MainActor func cached(_ material: CanvasMaterialReference) -> StudyDocument? {
                guard
                    let document = library.courses.first(where: { $0.id == courseID })?.documents.first(where: {
                        $0.sourceKey == material.id
                    }), material.version.isEmpty || document.sourceVersion == material.version,
                    FileManager.default.fileExists(atPath: store.file(for: document).path)
                else { return nil }
                return document
            }
            do {
                if cached(reference) == nil || reference.assignment?.linkedFileIDs == nil {
                    _ = try await fetchMaterial(reference, courseID: courseID, client: client())
                }
                try Task.checkCancellation()
                guard stillSelected() else { return }
                loadAssignmentText()
                let linkedIDs = assignment?.assignment?.linkedFileIDs ?? []
                var resolveIDs = Array(linkedIDs.prefix(50))
                if let fileID, let id = linkedIDs.first(where: { "files:\($0)" == fileID }), !resolveIDs.contains(id) {
                    resolveIDs.insert(id, at: 0)
                }
                for id in resolveIDs {
                    try Task.checkCancellation()
                    guard stillSelected() else { return }
                    if course?.materials.first(where: { $0.id == "files:\(id)" })?.fileName != nil { continue }
                    do {
                        let file = try await client().fileReference(id: id, courseID: remoteID)
                        guard let ci = library.courses.firstIndex(where: { $0.id == courseID }) else { return }
                        if let mi = library.courses[ci].canvasMaterials?.firstIndex(where: { $0.id == file.id }) {
                            library.courses[ci].canvasMaterials?[mi] = file
                        } else {
                            library.courses[ci].canvasMaterials = library.courses[ci].materials + [file]
                        }
                    } catch {
                        try Task.checkCancellation()
                        if stillSelected() {
                            assignmentFileNotices["files:\(id)"] = "Unavailable: \(error.localizedDescription)"
                        }
                    }
                }
                guard stillSelected() else { return }
                let files = assignmentFiles
                let selected =
                    requestedFileID.flatMap { id in files.first { $0.id == id } }
                    ?? assignmentPDFs.first ?? files.first
                var expectedFileID = openingFileID
                if library.selectedDocumentID == openingDocumentID && library.selectedAssignmentFileID == openingFileID
                {
                    library.selectedAssignmentFileID = selected?.id
                    expectedFileID = selected?.id
                }
                let automaticIDs = Set(files.prefix(50).map(\.id))
                let ordered = selected.map { [$0] } ?? []
                var automaticBytes = 0
                for file in ordered + files.filter({ $0.id != selected?.id }) {
                    try Task.checkCancellation()
                    guard stillSelected() else { return }
                    let explicitlyOpened = file.id == fileID
                    let existing = cached(file)
                    if !explicitlyOpened && !automaticIDs.contains(file.id) {
                        if existing == nil {
                            assignmentFileNotices[file.id] =
                                "Not prepared: automatic limit is 50 files. Open to download."
                        }
                        continue
                    }
                    if existing == nil, !explicitlyOpened {
                        if let size = file.byteCount, size > 20_000_000 {
                            assignmentFileNotices[file.id] = "Not prepared: larger than 20 MB. Open to download."
                            continue
                        }
                        if automaticBytes >= 50_000_000 || (file.byteCount ?? 0) > 50_000_000 - automaticBytes {
                            assignmentFileNotices[file.id] =
                                "Not prepared: assignment download limit reached. Open to download."
                            continue
                        }
                    }
                    if let reason = file.unavailableReason {
                        assignmentFileNotices[file.id] = reason
                        continue
                    }
                    if file.fileName == nil, assignmentFileNotices[file.id] != nil { continue }
                    let limit =
                        explicitlyOpened
                        ? StudyDocumentImporter.maximumBytes : min(20_000_000, 50_000_000 - automaticBytes)
                    var received = 0
                    do {
                        let saved: StudyDocument
                        if let existing {
                            saved = try await indexCachedAssignmentText(existing, file: file, courseID: courseID)
                        } else {
                            saved = try await fetchMaterial(
                                file, courseID: courseID, client: client(), maximumBytes: limit
                            ) { received = $0 }
                        }
                        if !explicitlyOpened { automaticBytes += received }
                        guard stillSelected() else { return }
                        if file.id == selected?.id, library.selectedDocumentID == openingDocumentID,
                            library.selectedAssignmentFileID == expectedFileID
                        {
                            selectDocument(saved.id, assignmentID: reference.id, recordHistory: false)
                        }
                    } catch {
                        try Task.checkCancellation()
                        if !explicitlyOpened { automaticBytes += received == 0 ? limit : received }
                        if stillSelected() {
                            assignmentFileNotices[file.id] = "Unavailable: \(error.localizedDescription)"
                        }
                    }
                }
                if stillSelected() {
                    if !assignmentFileNotices.isEmpty {
                        assignmentNotice =
                            "Some included files are not ready for the companion. See each file's status."
                    }
                    canvasStatus = "\(reference.title) is ready."
                }
            } catch {
                if stillSelected() {
                    loadAssignmentText()
                    assignmentNotice =
                        error is CancellationError
                        ? "Preparation stopped. Saved instructions and files are still available."
                        : "Could not prepare this assignment. \(error.localizedDescription)"
                    canvasStatus = assignmentNotice
                }
            }
        }
    }

    func openAssignmentFile(_ id: String) {
        guard let assignment, let course, assignmentFiles.contains(where: { $0.id == id }) else { return }
        openAssignment(assignment, courseID: course.id, fileID: id)
    }

    func openAssignmentPDF(_ id: String) { openAssignmentFile(id) }

    private func indexCachedAssignmentText(
        _ document: StudyDocument, file: CanvasMaterialReference, courseID: UUID
    ) async throws -> StudyDocument {
        guard document.kind == .preview else { return document }
        let store = store
        let name = file.fileName ?? document.originalFileName ?? document.fileName
        guard !StudyFileFormats.previewExtensions.contains(URL(fileURLWithPath: name).pathExtension.lowercased()) else {
            return document
        }
        let staging = StudyDocumentStaging(destination: store)
        defer { staging.discard() }
        let job = Task.detached(priority: .utility) { () throws -> StudyDocument? in
            let data = try Data(contentsOf: store.file(for: document))
            guard StudyDocumentImporter.safePlainText(data) != nil else { return nil }
            return try StudyDocumentImporter.read(data: data, name: name, store: staging.store, id: document.id)
        }
        guard
            let indexed = try await withTaskCancellationHandler(
                operation: { try await job.value }, onCancel: { job.cancel() })
        else {
            return document
        }
        try Task.checkCancellation()
        guard let ci = library.courses.firstIndex(where: { $0.id == courseID }),
            let di = library.courses[ci].documents.firstIndex(where: { $0.id == document.id })
        else { throw CancellationError() }
        try staging.commit(indexed, to: store)
        var saved = document
        saved.kind = indexed.kind
        saved.fileName = indexed.fileName
        saved.pageCount = indexed.pageCount
        saved.unreadablePages = indexed.unreadablePages
        saved.contentHash = indexed.contentHash
        saved.contentNotice = indexed.contentNotice
        saved.originalFileName = name
        library.courses[ci].documents[di] = saved
        return saved
    }

    private func fetchMaterial(
        _ reference: CanvasMaterialReference, courseID: UUID, client: CanvasClient, background: Bool = false,
        maximumBytes: Int = StudyDocumentImporter.maximumBytes, onDownload: ((Int) -> Void)? = nil
    ) async throws -> StudyDocument {
        guard var ci = library.courses.firstIndex(where: { $0.id == courseID }),
            let remoteID = library.courses[ci].canvasID
        else { throw StudyError.message("Course not found.") }
        if !background { fetchingMaterialID = reference.id }
        let item = try await client.material(reference, courseID: remoteID)
        try Task.checkCancellation()
        guard let currentIndex = library.courses.firstIndex(where: { $0.id == courseID }) else {
            throw CancellationError()
        }
        ci = currentIndex
        let previous = library.courses[ci].documents.first(where: { $0.sourceKey == reference.id })
        if let mi = library.courses[ci].canvasMaterials?.firstIndex(where: { $0.id == reference.id }) {
            if !item.version.isEmpty { library.courses[ci].canvasMaterials?[mi].version = item.version }
            if let details = item.assignment { library.courses[ci].canvasMaterials?[mi].assignment = details }
        }
        if let previous, !item.version.isEmpty, previous.sourceVersion == item.version,
            FileManager.default.fileExists(atPath: store.file(for: previous).path)
        {
            return previous
        }
        let data: Data
        if let text = item.text {
            data = Data(text.utf8)
        } else if let url = item.downloadURL {
            data = try await client.download(url, limit: background ? min(10_000_000, maximumBytes) : maximumBytes)
        } else {
            throw StudyError.message("This material is unavailable.")
        }
        onDownload?(data.count)
        try Task.checkCancellation()
        // Preserve local edits separately when a newer Canvas original arrives.
        let preserveLocal = previous?.locallyEditedAt != nil
        let documentID = preserveLocal ? UUID() : previous?.id ?? UUID()
        let staging = StudyDocumentStaging(destination: store)
        defer { staging.discard() }
        let job = Task.detached(priority: background ? .utility : .userInitiated) {
            try StudyDocumentImporter.read(data: data, name: item.fileName, store: staging.store, id: documentID)
        }
        var document = try await withTaskCancellationHandler(
            operation: { try await job.value }, onCancel: { job.cancel() })
        try Task.checkCancellation()
        guard let finalIndex = library.courses.firstIndex(where: { $0.id == courseID }) else {
            throw CancellationError()
        }
        ci = finalIndex
        try staging.commit(document, to: store)
        document.title = item.title
        document.sourceKey = reference.id
        document.sourceURL = item.sourceURL
        document.sourceVersion = item.version
        document.lastPage = min(previous?.lastPage ?? 1, document.pageCount)
        if !preserveLocal { document.lastOpenedAt = previous?.lastOpenedAt }
        if preserveLocal, let previous,
            let di = library.courses[ci].documents.firstIndex(where: { $0.id == previous.id })
        {
            library.courses[ci].documents[di].sourceKey = nil
            library.courses[ci].documents[di].title = previous.title + " (local edits)"
        }
        if let di = library.courses[ci].documents.firstIndex(where: { $0.id == documentID }) {
            library.courses[ci].documents[di] = document
        } else {
            library.courses[ci].documents.append(document)
        }
        if self.document?.id == documentID { loadSelectedDocument() }
        save()
        return document
    }

    func cancelCanvas() {
        canvasTask?.cancel()
        cancelPreloading()
    }
    func disconnectCanvas() {
        cancelPreloading()
        guard !canvasBusy else { return }
        Task {
            do {
                let origin = try CanvasAddress.origin(library.canvasOrigin)
                try await CanvasSession.disconnect(origin: origin)
                canvasClient = nil
                canvasAccount = nil
                connectedOrigin = nil
                canvasCourses = []
                library.canvasUserID = nil
                library.canvasUserName = nil
                canvasStatus = "Disconnected. Your course cards, favorites, and downloaded documents remain available."
                save()
            } catch { canvasStatus = error.localizedDescription }
        }
    }
    private func courseIndex() -> Int? { library.courses.firstIndex { $0.id == library.selectedCourseID } }
    private func threadIndex(in ci: Int) -> Int? {
        library.courses[ci].threads.firstIndex { $0.id == library.selectedThreadID }
    }
    private func mutateThread(courseID: UUID, threadID: UUID, change: (inout StudyThread) -> Void) {
        guard let ci = library.courses.firstIndex(where: { $0.id == courseID }),
            let ti = library.courses[ci].threads.firstIndex(where: { $0.id == threadID })
        else { return }
        change(&library.courses[ci].threads[ti])
    }
    private func updateMessage(
        courseID: UUID, threadID: UUID, messageID: UUID, change: (inout ConversationMessage) -> Void
    ) {
        mutateThread(courseID: courseID, threadID: threadID) { thread in
            if let i = thread.messages.firstIndex(where: { $0.id == messageID }) { change(&thread.messages[i]) }
        }
    }
}
