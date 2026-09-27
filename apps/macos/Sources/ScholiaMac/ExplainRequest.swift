import Foundation

enum CaptureKind: String, Codable, CaseIterable, Sendable {
    case text
    case latex
    case mail
    case image
}

struct SourceContext: Codable, Equatable, Sendable {
    var title: String?
    var url: URL?
    var context: String?
    var parentContext: String?
}

struct ExplainRequest: Codable, Equatable, Sendable {
    var kind: CaptureKind
    var question: String
    var selection: String?
    var imageDataURL: String?
    var source: SourceContext?

    private enum CodingKeys: String, CodingKey {
        case kind
        case question
        case selection
        case imageDataURL = "imageDataUrl"
        case source
    }

    init(
        kind: CaptureKind,
        question: String,
        selection: String? = nil,
        imageDataURL: String? = nil,
        source: SourceContext? = nil
    ) {
        self.kind = kind
        self.question = question
        self.selection = selection
        self.imageDataURL = imageDataURL
        self.source = source
    }
}

struct CapturedContent: Identifiable, Equatable, Sendable {
    let id: UUID
    var kind: CaptureKind
    var text: String?
    var imageData: Data?
    var imageMimeType: String?
    var applicationName: String?
    var applicationBundleIdentifier: String?
    var applicationPID: pid_t?
    var windowTitle: String?
    var sourceURL: String?
    var context: String?
    var selectionBounds: CGRect?
    var parentContext: String?
    var capturedAt: Date

    init(
        id: UUID = UUID(),
        kind: CaptureKind,
        text: String? = nil,
        imageData: Data? = nil,
        imageMimeType: String? = nil,
        applicationName: String? = nil,
        applicationBundleIdentifier: String? = nil,
        applicationPID: pid_t? = nil,
        windowTitle: String? = nil,
        sourceURL: String? = nil,
        context: String? = nil,
        selectionBounds: CGRect? = nil,
        parentContext: String? = nil,
        capturedAt: Date = Date()
    ) {
        self.id = id
        self.kind = kind
        self.text = text
        self.imageData = imageData
        self.imageMimeType = imageMimeType
        self.applicationName = applicationName
        self.applicationBundleIdentifier = applicationBundleIdentifier
        self.applicationPID = applicationPID
        self.windowTitle = windowTitle
        self.sourceURL = sourceURL
        self.context = context
        self.selectionBounds = selectionBounds
        self.parentContext = parentContext
        self.capturedAt = capturedAt
    }

    var sourceTitle: String {
        [applicationName, windowTitle]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .uniqued()
            .joined(separator: " — ")
    }

    var imageDataURL: String? {
        guard let imageData, let imageMimeType else { return nil }
        return "data:\(imageMimeType);base64,\(imageData.base64EncodedString())"
    }
}

/// Documents carry extracted text; images carry a prepared raster. Document
/// bytes are never serialized as provider file blocks.
struct MessageAttachment: Identifiable, Codable, Equatable, Sendable {
    var id: UUID = UUID()
    var fileName: String
    var mimeType: String
    var byteCount: Int
    var extractedText: String
    var imageData: Data? = nil

    var isImage: Bool { imageData != nil && mimeType.hasPrefix("image/") }

    var formattedByteCount: String {
        ByteCountFormatter.string(fromByteCount: Int64(byteCount), countStyle: .file)
    }
}

struct ConversationMessage: Identifiable, Codable, Equatable, Sendable {
    enum Role: String, Codable, Sendable {
        case user
        case assistant
    }

    let id: UUID
    var role: Role
    var content: String
    var imageData: Data?
    var imageMimeType: String?
    var attachments: [MessageAttachment]?
    var reasoning: String?
    var isStreaming: Bool
    var metadata: String?

    init(
        id: UUID = UUID(),
        role: Role,
        content: String,
        imageData: Data? = nil,
        imageMimeType: String? = nil,
        attachments: [MessageAttachment]? = nil,
        reasoning: String? = nil,
        isStreaming: Bool = false,
        metadata: String? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.imageData = imageData
        self.imageMimeType = imageMimeType
        self.attachments = attachments
        self.reasoning = reasoning
        self.isStreaming = isStreaming
        self.metadata = metadata
    }
}

private extension Array where Element == String {
    func uniqued() -> [String] {
        var seen = Set<String>()
        return filter { seen.insert($0).inserted }
    }
}
