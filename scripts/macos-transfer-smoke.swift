import Foundation
@testable import ScholiaMac

extension StudyWorkspaceSmoke {
    static func checkDataTransfer() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [TransferFixtureProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        func receive(_ path: String, limit: Int) async throws -> (Data, HTTPURLResponse) {
            let request = URLRequest(url: URL(string: "https://canvas.example.test/transfer/\(path)")!)
            return try await CanvasDataTransfer(limit: limit, downloads: true).receive(request, session: session)
        }
        let expected = Data((0..<196_608).map { UInt8($0 % 251) })
        for path in ["declared", "streamed"] {
            let (data, response) = try await receive(path, limit: expected.count)
            precondition(response.statusCode == 200 && data == expected, "Chunk boundaries must not alter file bytes")
        }
        for path in ["declared", "streamed"] {
            do {
                _ = try await receive(path, limit: expected.count - 1)
                preconditionFailure("Reject files above the limit, whether or not Content-Length is present")
            } catch {
                precondition(error.localizedDescription.contains("size limit"), "Oversized responses must report a size error")
            }
        }
        let (body, forbidden) = try await receive("forbidden", limit: 1)
        precondition(forbidden.statusCode == 403 && body.isEmpty, "HTTP errors must remain available without buffering an error body")

        let waitingURL = URL(string: "https://canvas.example.test/transfer/wait-\(UUID())")!
        let waiting = Task {
            try await CanvasDataTransfer(limit: 1_000_000, downloads: true)
                .receive(URLRequest(url: waitingURL), session: session)
        }
        for _ in 0..<100 where !TransferFixtureProtocol.state.started(waitingURL) {
            try await Task.sleep(for: .milliseconds(10))
        }
        precondition(TransferFixtureProtocol.state.started(waitingURL), "The cancellation fixture must begin receiving")
        let cancellationStart = ContinuousClock.now
        waiting.cancel()
        do {
            _ = try await waiting.value
            preconditionFailure("Cancelling a download must not return partial bytes")
        } catch is CancellationError {
            // The transfer normalizes Task cancellation before the session callback arrives.
        }
        precondition(cancellationStart.duration(to: .now) < .seconds(1), "Cancellation must not wait for the server to finish")
        for _ in 0..<100 where !TransferFixtureProtocol.state.stopped(waitingURL) {
            try await Task.sleep(for: .milliseconds(10))
        }
        precondition(TransferFixtureProtocol.state.stopped(waitingURL), "Task cancellation must also stop the underlying network request")

        let alreadyCancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await receive("declared", limit: expected.count)
        }
        do {
            _ = try await alreadyCancelled.value
            preconditionFailure("Cancellation before receive must not start a successful download")
        } catch is CancellationError {}
        print("PASS: chunked downloads preserve bytes, enforce declared and streamed limits, retain HTTP status, and cancel the network task")
        try await checkDocumentStaging()
    }

    private static func checkDocumentStaging() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("scholia-staging-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let destination = StudyLibraryStore(root: root)
        func bytes(_ url: URL) throws -> Data { try Data(contentsOf: url) }
        let originalData = Data("Original course notes".utf8)
        let replacementData = Data("Updated course notes".utf8)
        let original = try StudyDocumentImporter.read(data: originalData, name: "Lecture.md", store: destination)
        let staging = StudyDocumentStaging(destination: destination)
        defer { staging.discard() }
        let replacement = try StudyDocumentImporter.read(data: replacementData, name: "Lecture.md", store: staging.store, id: original.id)
        var savedBytes = try bytes(destination.file(for: original))
        precondition(savedBytes == originalData, "Indexing a replacement must leave the saved document untouched")
        let cancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            try staging.commit(replacement, to: destination)
        }
        do {
            try await cancelled.value
            preconditionFailure("A cancelled import must not commit its replacement")
        } catch is CancellationError {}
        savedBytes = try bytes(destination.file(for: original))
        precondition(savedBytes == originalData)

        let missing = StudyDocumentStaging(destination: destination)
        defer { missing.discard() }
        do {
            try missing.commit(replacement, to: destination)
            preconditionFailure("A missing staged file must fail")
        } catch {}
        savedBytes = try bytes(destination.file(for: original))
        precondition(savedBytes == originalData, "A failed commit must restore the original directory")

        try staging.commit(replacement, to: destination)
        savedBytes = try bytes(destination.file(for: replacement))
        let savedIndex = try destination.index(for: replacement)
        precondition(savedBytes == replacementData)
        precondition(savedIndex.pages.first?.text == "Updated course notes")
        let revisions = try FileManager.default.contentsOfDirectory(
            at: root.appendingPathComponent("Revisions/\(original.id)"), includingPropertiesForKeys: nil)
        precondition(revisions.count == 1)
        let previousBytes = try bytes(revisions[0].appendingPathComponent(original.fileName))
        precondition(previousBytes == originalData, "Successful replacements must retain the previous original")
        print("PASS: staged document refresh preserves originals on cancellation and failed commits, then installs data and index together")
    }
}

private final class TransferFixtureState: @unchecked Sendable {
    private let lock = NSLock()
    private var startedURLs = Set<URL>()
    private var stoppedURLs = Set<URL>()

    func start(_ url: URL) { _ = lock.withLock { startedURLs.insert(url) } }
    func stop(_ url: URL) { _ = lock.withLock { stoppedURLs.insert(url) } }
    func started(_ url: URL) -> Bool { lock.withLock { startedURLs.contains(url) } }
    func stopped(_ url: URL) -> Bool { lock.withLock { stoppedURLs.contains(url) } }
}

private final class TransferFixtureProtocol: URLProtocol, @unchecked Sendable {
    static let state = TransferFixtureState()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url!
        let name = url.lastPathComponent
        let data = Data((0..<196_608).map { UInt8($0 % 251) })
        let headers = name == "declared" ? ["Content-Length": String(data.count)] : [:]
        let response = HTTPURLResponse(url: url, statusCode: name == "forbidden" ? 403 : 200,
                                       httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if name.hasPrefix("wait-") {
            client?.urlProtocol(self, didLoad: Data([1]))
            Self.state.start(url)
            return
        }
        for offset in stride(from: 0, to: data.count, by: 65_536) {
            client?.urlProtocol(self, didLoad: data.subdata(in: offset..<min(offset + 65_536, data.count)))
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {
        if let url = request.url { Self.state.stop(url) }
    }
}
