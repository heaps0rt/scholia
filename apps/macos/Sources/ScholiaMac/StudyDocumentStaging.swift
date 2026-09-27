import Foundation

/// Keep extraction and indexing away from the saved original until they both succeed.
struct StudyDocumentStaging: Sendable {
    let store: StudyLibraryStore

    init(destination: StudyLibraryStore) {
        store = StudyLibraryStore(root: destination.root.appendingPathComponent("ImportStaging/\(UUID())"))
    }

    func discard() {
        try? FileManager.default.removeItem(at: store.root)
    }

    func commit(_ document: StudyDocument, to destination: StudyLibraryStore) throws {
        try Task.checkCancellation()
        let manager = FileManager.default
        let target = destination.directory(for: document.id)
        let backup = destination.root.appendingPathComponent("Revisions/\(document.id)/\(UUID())")
        let replacing = manager.fileExists(atPath: target.path)
        try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        if replacing {
            try manager.createDirectory(at: backup.deletingLastPathComponent(), withIntermediateDirectories: true)
            try manager.moveItem(at: target, to: backup)
        }
        do {
            try manager.moveItem(at: store.directory(for: document.id), to: target)
        } catch {
            if replacing { try? manager.moveItem(at: backup, to: target) }
            throw error
        }
    }
}
