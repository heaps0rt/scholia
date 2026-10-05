@preconcurrency import AppKit
import Foundation
import PDFKit
import Vision

enum AttachmentReadError: LocalizedError {
    case unreadable(String)
    case tooMuchText

    var errorDescription: String? {
        switch self {
        case .unreadable(let detail): detail
        case .tooMuchText:
            "This document exceeds 200,000 characters. Split it into smaller files; no partial text was attached."
        }
    }
}

enum MessageAttachmentIngestion {
    static let maximumInputBytes = 10_000_000
    static let maximumExtractedUTF16Units = 200_000
    static let maximumAttachmentsPerMessage = 20

    private static let textFileExtensions: Set<String> = [
        "txt", "md", "markdown", "json", "csv", "tsv", "tex", "bib", "log", "xml",
        "yml", "yaml", "toml", "ini", "cfg", "conf", "swift", "py", "js", "ts",
        "tsx", "jsx", "rb", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp",
        "cs", "php", "sh", "zsh", "bash", "sql", "html", "css", "scss", "r",
        "m", "ipynb", "srt", "vtt"
    ]

    private static let textApplicationMIMETypes: Set<String> = [
        "application/json", "application/ld+json", "application/xml",
        "application/yaml", "application/x-yaml", "application/toml",
        "application/javascript", "application/sql", "application/x-ndjson"
    ]

    static func supportsExtractedText(fileName: String, mimeType: String?) -> Bool {
        let cleanMime = normalizedMIMEType(mimeType)
        let pathExtension = (fileName as NSString).pathExtension.lowercased()
        if cleanMime == "application/pdf" || (cleanMime.isEmpty && pathExtension == "pdf") {
            return true
        }
        if cleanMime.hasPrefix("image/") { return false }
        if cleanMime.hasPrefix("text/") || textApplicationMIMETypes.contains(cleanMime) { return true }
        // File URLs normally arrive without a MIME type, so their extension is
        // authoritative. A declared, incompatible MIME type is never bypassed
        // merely because an attacker supplied a text-looking filename.
        return cleanMime.isEmpty && textFileExtensions.contains(pathExtension)
    }

    /// Extracts bounded text from supported file data. Returns nil for anything
    /// Scholia cannot attach safely (raw bytes are never forwarded anywhere).
    static func ingest(data: Data, fileName: String, mimeType: String?) -> MessageAttachment? {
        try? read(data: data, fileName: fileName, mimeType: mimeType)
    }

    static func read(data: Data, fileName: String, mimeType: String?) throws -> MessageAttachment {
        let boundedName = sanitizedFileName(fileName)
        let name = boundedName.isEmpty ? "Attachment" : boundedName
        guard !data.isEmpty, data.count <= maximumInputBytes else {
            throw AttachmentReadError.unreadable("The file is empty or exceeds 10 MB.")
        }

        let cleanMime = normalizedMIMEType(mimeType)
        let pathExtension = (name as NSString).pathExtension.lowercased()

        if cleanMime == "application/pdf" || (cleanMime.isEmpty && pathExtension == "pdf") {
            return try extractedPDF(data: data, fileName: name)
        }
        if supportsExtractedText(fileName: name, mimeType: cleanMime)
            || (cleanMime.isEmpty && pathExtension.isEmpty && looksLikeUTF8Text(data)) {
            return try extractedPlainText(data: data, fileName: name, mimeType: cleanMime.isEmpty ? "text/plain" : cleanMime)
        }
        throw AttachmentReadError.unreadable("Unsupported file type. Attach a PDF, image, or UTF-8 text file.")
    }

    static func ingest(fileAt url: URL) -> MessageAttachment? {
        try? read(fileAt: url)
    }

    static func read(fileAt url: URL) throws -> MessageAttachment {
        guard url.isFileURL,
              let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
              values.isRegularFile == true,
              let size = values.fileSize,
              size >= 0, size <= maximumInputBytes,
              let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
            throw AttachmentReadError.unreadable("The file could not be read or exceeds 10 MB.")
        }
        return try read(data: data, fileName: url.lastPathComponent, mimeType: nil)
    }

    /// Reads PDF data and returns its bounded text content.
    static func extractPDFText(data: Data) -> String? {
        try? readPDFText(data: data)
    }

    private static func readPDFText(data: Data) throws -> String {
        guard let document = PDFDocument(data: data), !document.isLocked, document.pageCount > 0 else {
            throw AttachmentReadError.unreadable("The PDF is locked or could not be opened.")
        }
        var pieces: [String] = []
        var total = 0
        for index in 0..<document.pageCount {
            try Task.checkCancellation()
            guard let page = document.page(at: index) else {
                throw AttachmentReadError.unreadable("PDF page \(index + 1) could not be read.")
            }
            var text = page.string ?? ""
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                text = try recognizedText(on: page)
            }
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw AttachmentReadError.unreadable("PDF page \(index + 1) has no readable text, even after OCR. No partial document was attached.")
            }
            pieces.append(text)
            total += text.utf16.count + (pieces.count > 1 ? 2 : 0)
            guard total <= maximumExtractedUTF16Units else { throw AttachmentReadError.tooMuchText }
        }
        return pieces.joined(separator: "\n\n")
    }

    private static func recognizedText(on page: PDFPage) throws -> String {
        let thumbnail = page.thumbnail(of: NSSize(width: 2_000, height: 2_000), for: .mediaBox)
        var bounds = CGRect(origin: .zero, size: thumbnail.size)
        guard let image = thumbnail.cgImage(forProposedRect: &bounds, context: nil, hints: nil) else {
            throw AttachmentReadError.unreadable("A scanned PDF page could not be rendered for OCR.")
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.automaticallyDetectsLanguage = true
        try VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }

    private static func extractedPDF(data: Data, fileName: String) throws -> MessageAttachment {
        let text = try readPDFText(data: data)
        return MessageAttachment(
            fileName: fileName,
            mimeType: "application/pdf",
            byteCount: data.count,
            extractedText: text
        )
    }

    private static func extractedPlainText(data: Data, fileName: String, mimeType: String) throws -> MessageAttachment {
        guard let text = String(data: data, encoding: .utf8),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AttachmentReadError.unreadable("The file has no readable UTF-8 text.")
        }
        guard text.utf16.count <= maximumExtractedUTF16Units else { throw AttachmentReadError.tooMuchText }
        return MessageAttachment(
            fileName: fileName,
            mimeType: mimeType,
            byteCount: data.count,
            extractedText: text
        )
    }

    private static func looksLikeUTF8Text(_ data: Data) -> Bool {
        guard let sample = String(data: data.prefix(8_192), encoding: .utf8) else { return false }
        let scalars = sample.unicodeScalars
        var controlCount = 0
        for scalar in scalars where scalar.value < 32 && scalar != "\n" && scalar != "\r" && scalar != "\t" {
            controlCount += 1
        }
        return controlCount * 20 <= scalars.count
    }

    private static func normalizedMIMEType(_ value: String?) -> String {
        String(value?.split(separator: ";", maxSplits: 1).first ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    private static func sanitizedFileName(_ value: String) -> String {
        let withoutControls = value.unicodeScalars.map { scalar in
            CharacterSet.controlCharacters.contains(scalar) ? " " : String(scalar)
        }.joined()
        return String(
            withoutControls.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").prefix(200)
        )
    }
}
