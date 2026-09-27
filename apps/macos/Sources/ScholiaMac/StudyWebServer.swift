@preconcurrency import AppKit
import Foundation
@preconcurrency import Network

/// The browser is another view of the native workspace, with the same credentials,
/// provider runtime and local storage. Only loopback connections are accepted.
@MainActor
final class StudyWebServer {
    private let app: AppModel
    private let workspace: StudyWorkspaceModel
    private let assets: URL
    private let sendQuestion: (() -> Void)?
    private let practiceProvider: (ProviderConfiguration, StudyCompletion)?
    private let token = UUID().uuidString + UUID().uuidString
    private var listener: NWListener?
    private var pendingOpen = false
    private(set) var address: URL?

    init(
        app: AppModel, workspace: StudyWorkspaceModel, assets: URL? = nil,
        practiceProvider: (ProviderConfiguration, StudyCompletion)? = nil, sendQuestion: (() -> Void)? = nil
    ) {
        self.app = app
        self.workspace = workspace
        self.sendQuestion = sendQuestion
        self.practiceProvider = practiceProvider
        self.assets = assets ?? Bundle.main.resourceURL!.appendingPathComponent("StudyWeb")
    }

    func open() {
        if let address {
            NSWorkspace.shared.open(address)
            return
        }
        start(openBrowser: true)
    }

    func start(openBrowser: Bool = false, port: UInt16 = 8792) {
        pendingOpen = pendingOpen || openBrowser
        guard listener == nil else { return }
        do {
            guard FileManager.default.fileExists(atPath: assets.appendingPathComponent("index.html").path) else {
                throw StudyError.message(
                    "The website assets are missing. Rebuild Scholia with npm run build:web, then build the Mac app.")
            }
            let parameters = NWParameters.tcp
            parameters.requiredLocalEndpoint = .hostPort(
                host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port) ?? .any)
            let server = try NWListener(using: parameters)
            listener = server
            server.stateUpdateHandler = { [weak self] state in
                Task { @MainActor in
                    guard let self else { return }
                    if case .ready = state, let port = server.port {
                        self.address = URL(string: "http://127.0.0.1:\(port.rawValue)")
                        if self.pendingOpen, let address = self.address {
                            NSWorkspace.shared.open(address)
                            self.pendingOpen = false
                        }
                    } else if case .failed(let error) = state {
                        self.workspace.error = "Could not start Scholia's website: \(error.localizedDescription)"
                        self.listener?.cancel()
                        self.listener = nil
                    }
                }
            }
            server.newConnectionHandler = { [weak self] connection in
                let reader = StudyHTTPRequestReader(connection: connection) { request in
                    Task { @MainActor in
                        guard let self else {
                            connection.cancel()
                            return
                        }
                        let response = await self.respond(request)
                        connection.send(
                            content: response.serialized(), completion: .contentProcessed { _ in connection.cancel() })
                    }
                }
                reader.start()
            }
            server.start(queue: .global(qos: .userInitiated))
        } catch { workspace.error = error.localizedDescription }
    }
    func stop() {
        listener?.cancel()
        listener = nil
        address = nil
    }

    private func respond(_ request: StudyHTTPRequest) async -> StudyHTTPResponse {
        guard let address, request.headers["host"] == address.host! + ":" + String(address.port!) else {
            return .error(403, "Invalid host")
        }
        let path = request.path.components(separatedBy: "?")[0]
        if let origin = request.headers["origin"], origin != address.absoluteString {
            return .error(403, "This website cannot access Scholia")
        }
        if request.headers["sec-fetch-site"] == "cross-site" { return .error(403, "Cross-site request refused") }
        if path.hasPrefix("/api/") {
            guard request.headers["x-scholia-token"] == token else {
                return .error(403, "Reopen this website from Scholia")
            }
            do {
                if path == "/api/state", request.method == "GET" { return try state() }
                if path == "/api/learning", request.method == "GET" {
                    return StudyHTTPResponse(
                        data: try JSONEncoder().encode(workspace.learning.view(library: workspace.library)))
                }
                if path.hasPrefix("/api/edit/"), request.method == "GET" {
                    guard let id = UUID(uuidString: String(path.dropFirst("/api/edit/".count))),
                        let document = workspace.library.courses.flatMap(\.documents).first(where: { $0.id == id })
                    else { return .error(404, "Document not found") }
                    let store = workspace.store
                    let draft = try await Task.detached { try StudyDocumentEditing.read(document, store: store) }.value
                    return StudyHTTPResponse(data: try JSONEncoder().encode(draft))
                }
                if path.hasPrefix("/api/index/"), request.method == "GET" {
                    guard let id = UUID(uuidString: String(path.dropFirst("/api/index/".count))),
                        let document = workspace.library.courses.flatMap(\.documents).first(where: { $0.id == id })
                    else { return .error(404, "Document not found") }
                    return StudyHTTPResponse(data: try JSONEncoder().encode(workspace.store.index(for: document)))
                }
                if path.hasPrefix("/api/image/"), request.method == "GET" {
                    let parts = path.dropFirst("/api/image/".count).split(separator: "/").map(String.init)
                    guard parts.count == 2, let id = UUID(uuidString: parts[0]),
                        let document = workspace.library.courses.flatMap(\.documents).first(where: { $0.id == id }),
                        let index = try? workspace.store.index(for: document),
                        index.pages.contains(where: { ($0.images ?? []).contains(parts[1]) }),
                        parts[1] == URL(fileURLWithPath: parts[1]).lastPathComponent
                    else { return .error(404, "Image not found") }
                    return StudyHTTPResponse(
                        data: try Data(contentsOf: workspace.store.directory(for: id).appendingPathComponent(parts[1])),
                        type: "image/jpeg")
                }
                if path.hasPrefix("/api/document/"), request.method == "GET" {
                    guard let id = UUID(uuidString: String(path.dropFirst("/api/document/".count))),
                        let document = workspace.library.courses.flatMap(\.documents).first(where: { $0.id == id })
                    else { return .error(404, "Document not found") }
                    let store = workspace.store
                    let data = try await Task.detached { try Data(contentsOf: store.file(for: document)) }.value
                    return StudyHTTPResponse(
                        data: data,
                        type: document.kind == .pdf
                            ? "application/pdf"
                            : document.kind == .image
                                ? "image/jpeg"
                                : [.office, .preview].contains(document.kind)
                                    ? "application/octet-stream"
                                    : document.kind == .notebook ? "application/json" : "text/plain; charset=utf-8")
                }
                guard ["/api/action", "/api/learning"].contains(path), request.method == "POST",
                    request.headers["content-type"]?.hasPrefix("application/json") == true
                else { return .error(405, "Use a JSON POST request") }
                let raw = request.body
                let command = try await Task.detached { try JSONDecoder().decode(StudyWebCommand.self, from: raw) }
                    .value
                try await act(command)
                if path == "/api/learning" {
                    return StudyHTTPResponse(
                        data: try JSONEncoder().encode(workspace.learning.view(library: workspace.library)))
                }
                return try state()
            } catch { return .error(400, error.localizedDescription) }
        }
        guard request.method == "GET", let decoded = path.removingPercentEncoding, !decoded.contains(".."),
            !decoded.contains("\\"), !decoded.contains("\0")
        else { return .error(404, "Not found") }
        let name = decoded == "/" ? "index.html" : String(decoded.dropFirst())
        let file = assets.appendingPathComponent(name)
        guard file.standardizedFileURL.path.hasPrefix(assets.standardizedFileURL.path + "/") else {
            return .error(404, "Not found")
        }
        do {
            var data = try await Task.detached { try Data(contentsOf: file) }.value
            if name == "index.html" {
                data = Data(
                    (String(data: data, encoding: .utf8) ?? "").replacingOccurrences(
                        of: "__SCHOLIA_TOKEN__", with: token
                    ).utf8)
            }
            let types = [
                "html": "text/html; charset=utf-8", "js": "text/javascript", "mjs": "text/javascript",
                "css": "text/css", "svg": "image/svg+xml", "png": "image/png", "gif": "image/gif",
                "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf",
            ]
            return StudyHTTPResponse(data: data, type: types[file.pathExtension] ?? "application/octet-stream")
        } catch { return .error(404, "Not found") }
    }

    private func state() throws -> StudyHTTPResponse {
        // Do not serialize settings, provider secrets, cookies, tokens, or inactive chat bodies.
        var library = workspace.library
        for ci in library.courses.indices {
            library.courses[ci].favorite = library.courses[ci].isFavorite
            for ti in library.courses[ci].threads.indices {
                library.courses[ci].threads[ti].messages = []
                library.courses[ci].threads[ti].sources = [:]
                library.courses[ci].threads[ti].draft = ""
                library.courses[ci].threads[ti].draftImage = nil
            }
        }
        let models = ProviderCatalog.providers.flatMap { provider in
            app.verifiedModels(for: provider).map {
                StudyWebModel(id: $0.id, label: $0.label, providerID: provider.id, provider: provider.name)
            }
        }
        let data = try JSONEncoder().encode(
            StudyWebState(
                library: library, showingLibrary: workspace.isShowingLibrary,
                semesters: workspace.semesterGroups, selectedSemesterID: workspace.selectedSemesterID,
                materialGroups: workspace.course.map { StudyMaterialOrganizer.groups(for: $0) } ?? [],
                materialFiles: workspace.course.map { StudyMaterialOrganizer.files(for: $0) } ?? [],
                messages: workspace.messages, sources: workspace.thread?.sources ?? [:], page: workspace.currentPage,
                pageText: workspace.currentPageText, draft: workspace.draft, draftImage: workspace.draftImage,
                mode: workspace.mode.rawValue, editing: workspace.editingMessageID, models: models,
                providerID: app.activeProvider.id,
                modelID: app.settings.models[app.activeProvider.id] ?? app.activeProvider.defaultModel,
                canSend: workspace.canSend, streaming: workspace.isStreaming,
                busy: workspace.canvasBusy || workspace.isImporting,
                loadingDocument: workspace.document != nil && workspace.documentIndex == nil && workspace.error == nil,
                status: workspace.activity ?? workspace.canvasStatus, warnings: workspace.canvasWarnings,
                error: workspace.error,
                context: workspace.contextSummary, includeCourse: workspace.includeCourseContext,
                assignmentText: workspace.assignmentText, assignmentPDFs: workspace.assignmentPDFs,
                assignmentNotice: workspace.assignmentNotice,
                draftOwner: workspace.draftOwner, learningRevision: workspace.learning.state.sequence,
                reviewDue: workspace.learning.state.due().count))
        return StudyHTTPResponse(data: data)
    }

    private func act(_ command: StudyWebCommand) async throws {
        func uuid(_ value: String?) throws -> UUID {
            guard let value, let id = UUID(uuidString: value) else {
                throw StudyError.message("Invalid workspace identifier")
            }
            return id
        }
        switch command.action {
        case "practiceGenerate":
            try workspace.validateDraftOwner(command.owner)
            if let text = command.selection { workspace.selectedText = String(text.prefix(16_000)) }
            if let provider = practiceProvider {
                workspace.preparePractice(
                    count: command.count ?? 3, scope: command.text ?? "", openBook: command.enabled ?? false,
                    configuration: provider.0, complete: provider.1)
            } else {
                workspace.startPractice(
                    using: app, count: command.count ?? 3, scope: command.text ?? "", openBook: command.enabled ?? false
                )
            }
        case "practice":
            guard let learning = command.learning else { throw StudyError.message("Missing practice action.") }
            try workspace.practiceCommand(
                learning, using: app, configuration: practiceProvider?.0, complete: practiceProvider?.1)
        case "saveDocument":
            guard let draft = command.edit,
                workspace.course?.documents.contains(where: { $0.id == draft.documentID }) == true
            else { throw StudyError.message("Open the document's course before saving changes.") }
            try await workspace.saveDocumentEdits(draft)
        case "library": workspace.showCourseLibrary()
        case "libraryView":
            guard let value = command.id, let mode = StudyCourseLibraryViewMode(rawValue: value) else {
                throw StudyError.message("Unknown course view")
            }
            workspace.setCourseLibraryView(mode)
        case "semester": workspace.selectSemester(command.id ?? "all")
        case "course": workspace.selectCourse(try uuid(command.id))
        case "resume":
            let id = try uuid(command.id)
            guard workspace.library.courses.contains(where: { $0.documents.contains(where: { $0.id == id }) }) else {
                throw StudyError.message("This reading is no longer in your library.")
            }
            workspace.resumeReading(id)
        case "create": workspace.createCourse(name: command.name ?? "", code: command.code ?? "")
        case "favorite": workspace.toggleFavorite(try uuid(command.id))
        case "materials": workspace.showCourseMaterials()
        case "document":
            let id = try uuid(command.id)
            guard workspace.course?.documents.contains(where: { $0.id == id }) == true else {
                throw StudyError.message("Document is outside this course")
            }
            workspace.selectDocument(id)
        case "material":
            guard let course = workspace.course, let material = course.materials.first(where: { $0.id == command.id })
            else { throw StudyError.message("Material not found") }
            workspace.openCanvasMaterial(material, courseID: course.id)
        case "assignmentVisibility":
            let courseID = try uuid(command.courseID)
            guard let id = command.id,
                workspace.library.courses.contains(where: {
                    $0.id == courseID && $0.materials.contains(where: { $0.id == id && $0.kind == .assignments })
                })
            else { throw StudyError.message("Assignment not found") }
            workspace.setAssignmentHidden(id, courseID: courseID, hidden: command.enabled == true)
        case "assignment":
            let courseID = try uuid(command.courseID)
            guard let course = workspace.library.courses.first(where: { $0.id == courseID }),
                let material = course.materials.first(where: { $0.id == command.id && $0.kind == .assignments })
            else { throw StudyError.message("Assignment not found") }
            workspace.openAssignment(material, courseID: courseID)
        case "assignmentPDF":
            guard workspace.course?.id == (try uuid(command.courseID)),
                workspace.assignment?.id == command.assignmentID,
                let id = command.id, workspace.assignmentPDFs.contains(where: { $0.id == id })
            else { throw StudyError.message("Reopen the assignment before choosing its PDF.") }
            workspace.openAssignmentPDF(id)
        case "page":
            try workspace.validateDraftOwner(command.owner)
            workspace.setPage(command.page ?? 1)
        case "source":
            let id = try uuid(command.id)
            guard let document = workspace.course?.documents.first(where: { $0.id == id }) else {
                throw StudyError.message("Source not found in this course")
            }
            workspace.navigate(to: StudySource(documentID: id, title: document.title, page: command.page ?? 1))
        case "thread": workspace.selectThread(try uuid(command.id))
        case "newThread": workspace.newThread()
        case "edit":
            let id = try uuid(command.id)
            if let message = workspace.messages.first(where: { $0.id == id }) { workspace.edit(message) }
        case "cancelEdit": workspace.cancelEdit()
        case "draft", "send":
            try workspace.validateDraftOwner(command.owner)
            if command.action == "send", workspace.isStreaming {
                throw StudyError.message("Wait for the current answer to finish.")
            }
            workspace.draft = String((command.text ?? "").prefix(200_000))
            workspace.selectedText = String((command.selection ?? "").prefix(16_000))
            if let mode = command.mode.flatMap(StudyTeachingMode.init(rawValue:)) { workspace.mode = mode }
            if let encoded = command.image {
                guard encoded.count < 34_000_000, let data = Data(base64Encoded: encoded),
                    let image = NSImage(data: data)
                else { throw StudyError.message("Invalid question image") }
                workspace.attachImage(image)
            } else if command.clearImage == true {
                workspace.draftImage = nil
            }
            workspace.saveDraft()
            if command.action == "send" {
                guard workspace.canSend else {
                    throw StudyError.message("Wait for the document to finish opening or the current answer to finish.")
                }
                if let sendQuestion { sendQuestion() } else { workspace.send(using: app) }
            }
        case "stop": workspace.stopAnswer()
        case "context": workspace.includeCourseContext = command.enabled ?? true
        case "model": app.selectStudyModel(command.id ?? "", providerID: command.providerID ?? "")
        case "index", "downloadAll":
            if let id = command.id {
                workspace.syncCanvasCourses(courseIDs: [try uuid(id)], downloadAll: command.action == "downloadAll")
            } else {
                workspace.loadCanvasCourses(downloadAll: command.action == "downloadAll")
            }
        case "connect":
            if let origin = command.origin { workspace.canvasAddress = try CanvasAddress.origin(origin).absoluteString }
            workspace.loadCanvasCourses(token: command.token, downloadAll: command.enabled ?? false)
        case "signIn":
            app.openStudyWorkspace()
            workspace.canvasPresented = true
            workspace.canvasSigningIn = true
        case "cancelSync":
            workspace.cancelCanvas()
            workspace.cancelImport()
        case "native": app.openStudyWorkspace()
        case "quickChat": app.showQuickAsk()
        case "clearError": workspace.error = nil
        case "import":
            guard !workspace.isImporting, let value = command.data, value.count <= 134_000_000,
                let data = Data(base64Encoded: value), data.count <= StudyDocumentImporter.maximumBytes,
                let name = command.name
            else { throw StudyError.message("Choose a document smaller than 100 MB and wait for the current import.") }
            guard workspace.course != nil else { throw StudyError.message("Open a course before adding a document") }
            workspace.importBrowserDocument(data: data, name: name)
        default: throw StudyError.message("Unknown action")
        }
    }
}

private struct StudyWebCommand: Decodable, Sendable {
    var action: String
    var id: String?
    var name: String?
    var code: String?
    var text: String?
    var selection: String?
    var page: Int?
    var mode: String?
    var providerID: String?
    var image: String?
    var clearImage: Bool?
    var origin: String?
    var token: String?
    var enabled: Bool?
    var data: String?
    var edit: StudyEditDraft?
    var courseID: String?
    var assignmentID: String?
    var owner: StudyDraftOwner?
    var learning: LearningCommand?
    var count: Int?
}
private struct StudyWebModel: Encodable {
    var id: String
    var label: String
    var providerID: String
    var provider: String
}
private struct StudyWebState: Encodable {
    var library: StudyLibrary
    var showingLibrary: Bool
    var semesters: [StudySemesterGroup]
    var selectedSemesterID: String
    var materialGroups: [StudyMaterialGroup]
    var materialFiles: [StudyMaterialEntry]
    var messages: [ConversationMessage]
    var sources: [String: [StudySource]]
    var page: Int
    var pageText: String
    var draft: String
    var draftImage: Data?
    var mode: String
    var editing: UUID?
    var models: [StudyWebModel]
    var providerID: String
    var modelID: String
    var canSend: Bool
    var streaming: Bool
    var busy: Bool
    var loadingDocument: Bool
    var status: String?
    var warnings: [String]
    var error: String?
    var context: String
    var includeCourse: Bool
    var assignmentText: String
    var assignmentPDFs: [CanvasMaterialReference]
    var assignmentNotice: String?
    var draftOwner: StudyDraftOwner
    var learningRevision: Int
    var reviewDue: Int
}

struct StudyHTTPRequest: Sendable {
    var method: String
    var path: String
    var headers: [String: String]
    var body: Data
}
struct StudyHTTPResponse: Sendable {
    var status = 200
    var data: Data
    var type = "application/json"
    static func error(_ status: Int, _ message: String) -> Self {
        Self(status: status, data: (try? JSONSerialization.data(withJSONObject: ["error": message])) ?? Data())
    }
    func serialized() -> Data {
        let policy =
            "default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        let head =
            "HTTP/1.1 \(status) \(status == 200 ? "OK" : "Error")\r\nContent-Type: \(type)\r\nContent-Length: \(data.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: \(policy)\r\nConnection: close\r\n\r\n"
        return Data(head.utf8) + data
    }
}

/// One bounded HTTP/1.1 request per connection; mutable state stays on its queue.
private final class StudyHTTPRequestReader: @unchecked Sendable {
    let connection: NWConnection
    let completion: @Sendable (StudyHTTPRequest) -> Void
    private let queue = DispatchQueue(label: "app.scholia.study-web.request")
    private var buffer = Data()
    private var headerEnd: Int?
    private var length = 0
    private var method = ""
    private var path = ""
    private var headers: [String: String] = [:]
    private var done = false
    init(connection: NWConnection, completion: @escaping @Sendable (StudyHTTPRequest) -> Void) {
        self.connection = connection
        self.completion = completion
    }
    func start() {
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 45) { [weak self] in if self?.done == false { self?.reject(408) } }
        receive()
    }
    private func reject(_ status: Int) {
        done = true
        connection.send(
            content: StudyHTTPResponse.error(status, "Invalid or oversized request").serialized(),
            completion: .contentProcessed { [connection] _ in connection.cancel() })
    }
    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [self] data, _, finished, error in
            guard !done else { return }
            if let data { buffer.append(data) }
            if headerEnd == nil {
                if let range = buffer.range(of: Data("\r\n\r\n".utf8)) {
                    guard range.lowerBound <= 16_384,
                        let header = String(data: buffer[..<range.lowerBound], encoding: .utf8)
                    else {
                        reject(400)
                        return
                    }
                    let lines = header.components(separatedBy: "\r\n")
                    let parts = lines[0].split(separator: " ")
                    guard parts.count == 3, parts[1].hasPrefix("/"), parts[2] == "HTTP/1.1" else {
                        reject(400)
                        return
                    }
                    method = String(parts[0])
                    path = String(parts[1])
                    headerEnd = range.upperBound
                    for line in lines.dropFirst() {
                        guard let colon = line.firstIndex(of: ":") else {
                            reject(400)
                            return
                        }
                        let key = String(line[..<colon]).lowercased()
                        guard headers[key] == nil else {
                            reject(400)
                            return
                        }
                        headers[key] = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
                    }
                    guard headers["transfer-encoding"] == nil, let count = Int(headers["content-length"] ?? "0"),
                        count >= 0, count <= 135_000_000
                    else {
                        reject(413)
                        return
                    }
                    length = count
                } else if buffer.count > 16_384 {
                    reject(431)
                    return
                }
            }
            if let end = headerEnd, buffer.count >= end + length {
                done = true
                completion(
                    StudyHTTPRequest(
                        method: method, path: path, headers: headers, body: buffer.subdata(in: end..<(end + length))))
            } else if finished || error != nil {
                done = true
                connection.cancel()
            } else {
                receive()
            }
        }
    }
}
