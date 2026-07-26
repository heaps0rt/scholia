import Foundation

enum CaptureKind: String, Codable, CaseIterable, Sendable {
    case text
    case latex
    case image
}

struct SourceContext: Codable, Equatable, Sendable {
    var title: String?
    var url: URL?
    var context: String?
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
