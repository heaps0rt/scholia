import Foundation

/// A serial, coalescing writer keeps JSON encoding and disk I/O off the UI thread.
/// Flush remains synchronous at lifecycle boundaries so the latest draft is durable.
final class StudyLibraryWriter: @unchecked Sendable {
    private let store: StudyLibraryStore
    private let queue = DispatchQueue(label: "app.scholia.library-writer", qos: .utility)
    private let lock = NSLock()
    private var pending: StudyLibrary?
    private var running = false
    init(store: StudyLibraryStore) { self.store = store }

    func save(_ library: StudyLibrary, onError: @escaping @Sendable (String) -> Void) {
        let start = lock.withLock {
            pending = library
            guard !running else { return false }
            running = true
            return true
        }
        guard start else { return }
        queue.async { [self] in
            while let snapshot = lock.withLock({ () -> StudyLibrary? in
                guard let value = pending else {
                    running = false
                    return nil
                }
                pending = nil
                return value
            }) {
                do { try store.save(snapshot) } catch { onError(error.localizedDescription) }
            }
        }
    }
    func flush(_ library: StudyLibrary) throws {
        try queue.sync {
            lock.withLock { pending = nil }
            try store.save(library)
        }
    }
}
