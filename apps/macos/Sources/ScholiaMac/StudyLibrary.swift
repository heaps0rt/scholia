@preconcurrency import AppKit
import Foundation
import ImageIO
import PDFKit
import Vision

enum StudyDocumentKind: String, Codable, Sendable {
    case pdf, text, image, code, notebook, office, preview
    var symbol: String {
        switch self {
        case .pdf, .office: "doc.richtext"
        case .text, .preview: "doc.text"
        case .image: "photo"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .notebook: "book.closed"
        }
    }
}

struct StudyPage: Codable, Equatable, Sendable {
    var number: Int
    var text: String
    var images: [String]?
}

struct StudyDocument: Codable, Identifiable, Equatable, Sendable {
    var id = UUID()
    var title: String
    var kind: StudyDocumentKind
    var fileName: String
    var pageCount: Int
    var unreadablePages: Int = 0
    var lastPage: Int = 1
    var addedAt = Date()
    var sourceURL: String?
    var sourceKey: String?
    var sourceVersion: String?
    var contentHash: String?
    var contentNotice: String?
    var locallyEditedAt: Date?
    var lastOpenedAt: Date?
    var originalFileName: String?

    var readingPosition: String {
        let unit = kind == .notebook ? "Cell" : [.code, .office].contains(kind) ? "Section" : "Page"
        return "\(unit) \(min(max(1, lastPage), max(1, pageCount))) of \(max(1, pageCount))"
    }
}

struct StudyRecentReading: Identifiable {
    let courseID: UUID
    let courseName: String
    let document: StudyDocument
    var id: UUID { document.id }

    static func inCourses(_ courses: [StudyCourse], limit: Int = 3) -> [Self] {
        courses.flatMap { course in
            course.documents.filter { $0.lastOpenedAt != nil }.map {
                Self(
                    courseID: course.id, courseName: course.code.isEmpty ? course.displayName : course.code,
                    document: $0)
            }
        }.sorted {
            if $0.document.lastOpenedAt != $1.document.lastOpenedAt {
                return $0.document.lastOpenedAt! > $1.document.lastOpenedAt!
            }
            return $0.id.uuidString < $1.id.uuidString
        }.prefix(max(0, limit)).map { $0 }
    }
}

struct StudyDocumentIndex: Codable, Sendable {
    var pages: [StudyPage]
}

struct StudySource: Codable, Equatable, Identifiable, Sendable {
    var documentID: UUID
    var title: String
    var page: Int
    var id: String { "\(documentID.uuidString):\(page)" }
}

enum StudyTeachingMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case explain = "Explain"
    case guide = "Guide me"
    case practice = "Practice"
    var id: String { rawValue }
    var summary: String {
        switch self {
        case .explain: "Build intuition with clear explanations and examples."
        case .guide: "Work it out with one hint at a time."
        case .practice: "Try a question, then get feedback on your answer."
        }
    }
    var starterTitle: String {
        switch self {
        case .explain: "Explain the key idea"
        case .guide: "Work through an example"
        case .practice: "Check my understanding"
        }
    }
    func starter(document: StudyDocument?) -> String {
        let scope =
            document.map {
                $0.kind == .notebook
                    ? "this notebook cell" : [.code, .office].contains($0.kind) ? "this section" : "this page"
            } ?? "the downloaded course materials"
        switch self {
        case .explain: return "Explain the key idea in \(scope), with an intuitive example."
        case .guide:
            return
                "Help me work through an example from \(scope), one step at a time. Start with a hint and wait for my attempt."
        case .practice:
            return
                "Ask me one question to test my understanding of \(scope). Wait for my answer before giving feedback or a solution."
        }
    }
    var instruction: String {
        switch self {
        case .explain:
            "Answer the question directly, then build intuition with a short worked example when helpful. Define unfamiliar symbols and preserve the document's notation."
        case .guide:
            "Establish what the student tried, then offer the smallest useful next step: a conceptual cue, a method cue, then a partial step. Give a direct explanation, worked example or full solution when explicitly requested. Do not require every response to end in a question. Accept equivalent reasoning and language differences; state uncertainty."
        case .practice:
            "Help the student practise this material. Ask one concrete question at a time, wait for their attempt, then give specific feedback and adapt the next question. Do not reveal the solution before an attempt unless requested."
        }
    }
}

struct StudyThread: Codable, Identifiable, Sendable {
    var id = UUID()
    var title = "New conversation"
    var documentID: UUID?
    var mode: StudyTeachingMode = .explain
    var messages: [ConversationMessage] = []
    var sources: [String: [StudySource]] = [:]
    var draft = ""
    var draftImage: Data?
    var updatedAt = Date()
}

struct StudyCourse: Codable, Identifiable, Sendable {
    var id = UUID()
    var name: String
    var code: String = ""
    var documents: [StudyDocument] = []
    var threads: [StudyThread] = []
    var canvasID: Int?
    var canvasOrigin: String?
    var canvasUserID: Int?
    var syncedAt: Date?
    // Optional additions keep version-1 libraries readable without losing local work.
    var favorite: Bool?
    var canvasFavorite: Bool?
    var canvasMaterials: [CanvasMaterialReference]?
    var catalogUpdatedAt: Date?
    var catalogWarnings: [String]?
    var term: String?
    var canvasAvailable: Bool?
    var catalogChanges: CanvasCatalogChanges?
    var catalogChangedAt: Date?
    var visitCount: Int?
    var lastVisitedAt: Date?
    var hiddenAssignmentIDs: [String]?

    var displayName: String {
        let prefix = code + " :: "
        guard !code.isEmpty, name.hasPrefix(prefix) else { return name }
        let title = String(name.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? name : title
    }
    var isFavorite: Bool { favorite ?? canvasFavorite ?? false }
    var displayCode: String {
        code.replacingOccurrences(
            of: "-(?:\\d{2}[HV])(?:-\\d{2}[HV])*$", with: "", options: [.regularExpression, .caseInsensitive])
    }
    var materials: [CanvasMaterialReference] { canvasMaterials ?? [] }
    var canvasURL: URL? {
        guard let canvasOrigin, let canvasID, let origin = try? CanvasAddress.origin(canvasOrigin) else { return nil }
        return origin.appendingPathComponent("courses/\(canvasID)")
    }
    var remoteOnlyMaterials: [CanvasMaterialReference] {
        let cached = Set(documents.compactMap(\.sourceKey))
        return materials.filter { !cached.contains($0.id) }
    }
    func updateAvailable(for document: StudyDocument) -> CanvasMaterialReference? {
        guard let key = document.sourceKey, let reference = materials.first(where: { $0.id == key }),
            !reference.version.isEmpty, reference.version != document.sourceVersion
        else { return nil }
        return reference
    }
}

struct StudyLibrary: Codable, Sendable {
    var version = 1
    var courses: [StudyCourse] = []
    var selectedCourseID: UUID?
    var selectedDocumentID: UUID?
    var selectedThreadID: UUID?
    var canvasOrigin = "https://canvas.ntnu.no"
    var canvasUserID: Int?
    var canvasUserName: String?
    var showingCourseLibrary: Bool?
    var courseLibraryView: StudyCourseLibraryViewMode?
    var selectedSemesterID: String?
    var canvasCheckedAt: Date?
    var canvasRefreshSummary: String?
    var selectedAssignmentID: String?
    var selectedAssignmentFileID: String?
}

enum StudyError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let message) = self { message } else { nil } }
}

struct StudyLibraryStore: Sendable {
    let root: URL

    init(root: URL? = nil) {
        self.root =
            root
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Scholia/Study", isDirectory: true)
    }

    func load() throws -> StudyLibrary {
        let file = root.appendingPathComponent("library.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return StudyLibrary() }
        var library = try JSONDecoder().decode(StudyLibrary.self, from: Data(contentsOf: file))
        guard library.version == 1 else {
            throw StudyError.message("This library was created by a newer Scholia version.")
        }
        for ci in library.courses.indices {
            for ti in library.courses[ci].threads.indices {
                library.courses[ci].threads[ti].messages = library.courses[ci].threads[ti].messages.compactMap {
                    message in
                    guard message.isStreaming else { return message }
                    guard !message.content.isEmpty else { return nil }
                    var copy = message
                    copy.isStreaming = false
                    copy.metadata = "Response interrupted when Scholia closed"
                    return copy
                }
            }
        }
        return library
    }

    func save(_ library: StudyLibrary) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(library).write(to: root.appendingPathComponent("library.json"), options: .atomic)
    }

    func directory(for id: UUID) -> URL { root.appendingPathComponent("Documents/\(id.uuidString)", isDirectory: true) }
    func file(for document: StudyDocument) -> URL {
        directory(for: document.id).appendingPathComponent(URL(fileURLWithPath: document.fileName).lastPathComponent)
    }
    func index(for document: StudyDocument) throws -> StudyDocumentIndex {
        try JSONDecoder().decode(
            StudyDocumentIndex.self,
            from: Data(contentsOf: directory(for: document.id).appendingPathComponent("index.json")))
    }
    func write(document: StudyDocument, index: StudyDocumentIndex, data: Data) throws {
        try FileManager.default.createDirectory(at: directory(for: document.id), withIntermediateDirectories: true)
        try data.write(to: file(for: document), options: .atomic)
        try JSONEncoder().encode(index).write(
            to: directory(for: document.id).appendingPathComponent("index.json"), options: .atomic)
    }
}

enum StudyDocumentImporter {
    static let maximumBytes = 100_000_000
    static let maximumCharacters = 8_000_000
    static let textExtensions: Set<String> = ["txt", "md", "markdown", "tex", "csv", "json", "html", "htm"]
    static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "heic", "webp", "tiff"]
    static var supportedExtensions: Set<String> {
        textExtensions.union(imageExtensions).union(StudyFileFormats.codeExtensions).union(
            StudyFileFormats.officeExtensions
        ).union(StudyFileFormats.previewExtensions).union(["pdf", "tsv", "log", "bib", "srt", "vtt"])
    }

    static func read(url: URL, store: StudyLibraryStore) throws -> StudyDocument {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, let size = values.fileSize, size <= maximumBytes else {
            throw StudyError.message("Choose a document smaller than 100 MB.")
        }
        return try read(data: Data(contentsOf: url), name: url.lastPathComponent, store: store)
    }

    static func read(data: Data, name: String, store: StudyLibraryStore, id: UUID = UUID()) throws -> StudyDocument {
        guard !data.isEmpty, data.count <= maximumBytes else {
            throw StudyError.message("The document is empty or exceeds 100 MB.")
        }
        let ext = URL(fileURLWithPath: name).pathExtension.lowercased()
        let title = URL(fileURLWithPath: name).deletingPathExtension().lastPathComponent
        var pages: [StudyPage] = []
        var unreadable = 0
        let kind: StudyDocumentKind
        let original: Data
        let fileName: String
        var extractedImages: [String: Data] = [:]
        var contentNotice: String?
        if ext == "pdf" {
            guard let pdf = PDFDocument(data: data), !pdf.isLocked, pdf.pageCount > 0, pdf.pageCount <= 4_000 else {
                throw StudyError.message(
                    "This PDF is locked, damaged, or exceeds 4,000 pages. Unlock it before importing.")
            }
            kind = .pdf
            original = data
            fileName = "original.pdf"
            var characters = 0
            for i in 0..<pdf.pageCount {
                try Task.checkCancellation()
                guard let page = pdf.page(at: i) else {
                    throw StudyError.message("PDF page \(i + 1) could not be opened.")
                }
                var text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if text.count < 20 { text = (try? recognize(page: page)) ?? text }
                if text.isEmpty { unreadable += 1 }
                characters += text.utf16.count
                guard characters <= maximumCharacters else {
                    throw StudyError.message(
                        "The document exceeds 8 million text characters. Split it into smaller documents.")
                }
                pages.append(StudyPage(number: i + 1, text: text))
            }
        } else if imageExtensions.contains(ext) {
            guard
                let source = CGImageSourceCreateWithData(
                    data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
                let cg = CGImageSourceCreateThumbnailAtIndex(
                    source, 0,
                    [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: 1_800,
                    ] as CFDictionary),
                let jpeg = ImageEncoding.jpegData(from: cg)
            else { throw StudyError.message("This image could not be decoded.") }
            kind = .image
            original = jpeg
            fileName = "original.jpg"
            let text = (try? recognize(image: cg)) ?? ""
            pages = [StudyPage(number: 1, text: text)]
            unreadable = text.isEmpty ? 1 : 0
        } else if ext == "ipynb" {
            let contents = try StudyFileFormats.notebook(data)
            kind = .notebook
            original = data
            fileName = "original.ipynb"
            pages = contents.pages
            extractedImages = contents.images
            contentNotice = contents.notice
        } else if StudyFileFormats.officeExtensions.contains(ext) {
            let contents = try StudyFileFormats.office(data, extension: ext)
            kind = .office
            original = data
            fileName = "original.\(ext)"
            pages = contents.pages
            extractedImages = contents.images
            contentNotice = contents.notice
        } else if StudyFileFormats.codeExtensions.contains(ext)
            || ["makefile", "dockerfile", ".gitignore"].contains(name.lowercased())
        {
            guard let text = String(data: data, encoding: .utf8), !text.contains("\0"),
                text.utf16.count <= maximumCharacters
            else { throw StudyError.message("Choose a UTF-8 source file smaller than 8 million characters.") }
            kind = .code
            original = data
            fileName = "original" + (ext.isEmpty ? ".txt" : ".\(ext)")
            pages = StudyFileFormats.code(text, name: name)
        } else if textExtensions.contains(ext) || ["tsv", "log", "bib", "srt", "vtt"].contains(ext)
            || (ext.isEmpty && String(data: data, encoding: .utf8)?.contains("\0") == false)
        {
            guard var text = String(data: data, encoding: .utf8), text.utf16.count <= maximumCharacters else {
                throw StudyError.message("Choose a UTF-8 text document with fewer than 8 million characters.")
            }
            if ["html", "htm"].contains(ext) { text = StudyHTML.plainText(text) }
            kind = .text
            original = Data(text.utf8)
            fileName = "original.md"
            // Stable, paragraph-sized reading pages also give text sources useful citations.
            var chunk = ""
            for rawParagraph in text.components(separatedBy: "\n\n") {
                var paragraph = rawParagraph[...]
                while let end = paragraph.index(paragraph.startIndex, offsetBy: 5_000, limitedBy: paragraph.endIndex),
                    end < paragraph.endIndex
                {
                    if !chunk.isEmpty {
                        pages.append(StudyPage(number: pages.count + 1, text: chunk))
                        chunk = ""
                    }
                    pages.append(StudyPage(number: pages.count + 1, text: String(paragraph[..<end])))
                    paragraph = paragraph[end...]
                }
                if chunk.count + paragraph.count > 5_000 && !chunk.isEmpty {
                    pages.append(StudyPage(number: pages.count + 1, text: chunk))
                    chunk = ""
                }
                chunk += (chunk.isEmpty ? "" : "\n\n") + String(paragraph)
            }
            if !chunk.isEmpty { pages.append(StudyPage(number: pages.count + 1, text: chunk)) }
            if pages.isEmpty { pages = [StudyPage(number: 1, text: "")] }
        } else {
            kind = .preview
            original = data
            fileName = "original" + (ext.isEmpty ? ".bin" : ".\(ext)")
            contentNotice =
                "This file is available in the Mac app's original preview. Its contents have not been text-indexed; attach a screenshot or export to PDF for visual questions."
            pages = [StudyPage(number: 1, text: "")]
        }
        let document = StudyDocument(
            id: id, title: title, kind: kind, fileName: fileName, pageCount: pages.count, unreadablePages: unreadable,
            contentHash: StudyDocumentEditing.revision(original), contentNotice: contentNotice,
            originalFileName: URL(fileURLWithPath: name).lastPathComponent)
        try store.write(document: document, index: StudyDocumentIndex(pages: pages), data: original)
        for (name, image) in extractedImages {
            try image.write(to: store.directory(for: id).appendingPathComponent(name), options: .atomic)
        }
        return document
    }

    private static func recognize(page: PDFPage) throws -> String {
        let image = page.thumbnail(of: NSSize(width: 1_800, height: 1_800), for: .mediaBox)
        guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return "" }
        return try recognize(image: cg)
    }
    private static func recognize(image: CGImage) throws -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.automaticallyDetectsLanguage = true
        try VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }
}

enum StudyHTML {
    /// Never uses WebKit/NSAttributedString HTML import: imported course markup cannot execute or fetch resources.
    static func plainText(_ html: String) -> String {
        var text = html.replacingOccurrences(
            of: "(?is)<(script|style|iframe|object)\\b[^>]*>.*?</\\1>", with: "", options: .regularExpression)
        text = text.replacingOccurrences(
            of: "(?i)<(?:br|/p|/div|/li|/h[1-6]|/tr)\\b[^>]*>", with: "\n\n", options: .regularExpression)
        text = text.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        for (entity, value) in [
            ("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&amp;", "&"),
        ] {
            text = text.replacingOccurrences(of: entity, with: value)
        }
        if let regex = try? NSRegularExpression(pattern: "&#(x[0-9a-fA-F]+|[0-9]+);") {
            for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
                guard let range = Range(match.range, in: text), let digitsRange = Range(match.range(at: 1), in: text)
                else { continue }
                let digits = String(text[digitsRange])
                let value = digits.hasPrefix("x") ? UInt32(digits.dropFirst(), radix: 16) : UInt32(digits)
                if let value, let scalar = UnicodeScalar(value) { text.replaceSubrange(range, with: String(scalar)) }
            }
        }
        return text.replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression).trimmingCharacters(
            in: .whitespacesAndNewlines)
    }
}
