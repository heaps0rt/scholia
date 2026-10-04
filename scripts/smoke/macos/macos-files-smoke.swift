import Foundation
@testable import ScholiaMac

private func check(_ condition: Bool, _ message: String) throws {
    if !condition { throw LocalFileToolError("FAIL: \(message)") }
}

private func json(_ result: LocalFileToolResult) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: Data(result.text.utf8)) as! [String: Any]
}

private final class FileProviderFixture: @unchecked Sendable {
    static let shared = FileProviderFixture()
    private let lock = NSLock()
    private var responses: [String] = []
    private var requests: [[String: Any]] = []
    private var creationBodies: [[String: Any]] = []

    func reset(_ responses: [String]) { lock.withLock { self.responses = responses; requests = []; creationBodies = [] } }
    var bodies: [[String: Any]] { lock.withLock { requests } }
    var sessions: [[String: Any]] { lock.withLock { creationBodies } }

    func respond(_ request: URLRequest) throws -> (String, Data) {
        try lock.withLock {
            var data = request.httpBody ?? Data()
            if data.isEmpty, let stream = request.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4_096)
                while stream.hasBytesAvailable {
                    let n = stream.read(&buffer, maxLength: buffer.count)
                    if n <= 0 { break }
                    data.append(contentsOf: buffer.prefix(n))
                }
            }
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            if request.url?.path == "/session" {
                creationBodies.append(body)
                return ("application/json", Data("{\"id\":\"fixture\"}".utf8))
            }
            if request.url?.path == "/event" { return ("text/event-stream", Data()) }
            requests.append(body)
            guard !responses.isEmpty else { throw LocalFileToolError("Unexpected extra provider request") }
            let text = responses.removeFirst()
            let response: [String: Any]
            if request.url?.path == "/session/fixture/message" {
                response = ["parts": [["type": "text", "text": text]]]
            } else if request.url?.path == "/anthropic" {
                response = ["content": [["type": "text", "text": text]]]
            } else if request.url?.path == "/ollama" {
                response = ["message": ["role": "assistant", "content": text], "done": true]
            } else {
                // Exercise token streaming, including a tool tag split across events.
                let chunks = stride(from: 0, to: text.count, by: 7).map { String(text.dropFirst($0).prefix(7)) }
                let events = try chunks.map { chunk -> String in
                    let event = try JSONSerialization.data(withJSONObject: ["choices": [["delta": ["content": chunk]]]])
                    return "data: \(String(decoding: event, as: UTF8.self))\n\n"
                }.joined() + "data: [DONE]\n\n"
                return ("text/event-stream", Data(events.utf8))
            }
            return ("application/json", try JSONSerialization.data(withJSONObject: response))
        }
    }
}

private final class FileProviderProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "files.fixture.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (type, data) = try FileProviderFixture.shared.respond(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@main
struct FilesSmoke {
    @MainActor static func main() async throws {
        let fixture = FileManager.default.temporaryDirectory.appendingPathComponent("scholia-file-tools-\(UUID())")
        try FileManager.default.createDirectory(at: fixture, withIntermediateDirectories: true)
        let root = fixture.resolvingSymlinksInPath()
        defer { try? FileManager.default.removeItem(at: root) }
        let documents = root.appendingPathComponent("Documents/Physics")
        try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
        let source = documents.appendingPathComponent("Lecture 3 – waves.txt")
        try Data("Waves travel at 42 m/s.".utf8).write(to: source)
        let policy = LocalFileAccessPolicy(read: true)
        let files = LocalFileTools(policy: policy, home: root)
        try check(try await files.resolve("~/Documents/Physics/../Physics/\(source.lastPathComponent)") == source, "tilde path")
        try check(try await files.resolve(source.absoluteString) == source, "file URL with encoded spaces")
        try check(try await files.resolve("documents/Physics").path == documents.path, "folder alias")

        let found = try json(await files.execute(.init(operation: "search", query: "lectur 3 waves", location: "Documents")))
        try check((found["matches"] as? [[String: Any]])?.first?["path"] as? String == source.path, "partial, typo-tolerant file lookup: \(found)")
        let nested = documents.appendingPathComponent("node_modules")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        try Data("ignored".utf8).write(to: nested.appendingPathComponent("buried-match.txt"))
        let hidden = try json(await files.execute(.init(operation: "search", query: "buried match")))
        try check((hidden["matches"] as? [[String: Any]])?.isEmpty == true, "skip dependency trees")
        let explicit = try json(await files.execute(.init(operation: "search", query: "buried match", location: nested.path)))
        try check((explicit["matches"] as? [[String: Any]])?.count == 1, "explicit location can search skipped folders")
        let listed = try json(await files.execute(.init(operation: "list", path: documents.path)))
        try check((listed["entries"] as? [[String: Any]])?.count == 2, "directory listing")
        let read = try json(await files.execute(.init(operation: "read", path: source.path)))
        let revision = read["revision"] as! String
        try check(read["text"] as? String == "Waves travel at 42 m/s.", "exact file reading")

        let newFile = documents.appendingPathComponent("answer.md")
        for operation in [
            LocalFileToolCall(operation: "write", path: newFile.path, content: "new"),
            LocalFileToolCall(operation: "write", path: source.path, content: "replace", revision: revision),
            LocalFileToolCall(operation: "mkdir", path: documents.appendingPathComponent("blocked").path)
        ] { try await rejected(files, operation, containing: "Write access is off") }
        try check(!FileManager.default.fileExists(atPath: newFile.path), "read-only cannot create")
        policy.update(read: true, write: true)
        _ = try await files.execute(.init(operation: "write", path: newFile.path, content: "Created notes"))
        try check(try String(contentsOf: newFile, encoding: .utf8) == "Created notes", "create file")
        try await rejected(files, .init(operation: "write", path: newFile.path, content: "unread overwrite"), containing: "Read the existing file")
        _ = try await files.execute(.init(operation: "write", path: source.path, content: "Edited waves", revision: revision))
        try check(try String(contentsOf: source, encoding: .utf8) == "Edited waves", "replace after read")
        let reread = try json(await files.execute(.init(operation: "read", path: source.path)))
        try Data("External change".utf8).write(to: source)
        try await rejected(files, .init(operation: "write", path: source.path, content: "clobber", revision: reread["revision"] as? String), containing: "changed since")

        let big = documents.appendingPathComponent("large.txt")
        try Data(String(repeating: "a", count: 24_020).utf8).write(to: big)
        let first = try json(await files.execute(.init(operation: "read", path: big.path)))
        try check(first["nextOffset"] as? Int == 24_000, "bounded reads expose continuation")
        try await rejected(files, .init(operation: "write", path: big.path, content: "partial", revision: first["revision"] as? String), containing: "Read the existing file")
        let last = try json(await files.execute(.init(operation: "read", path: big.path, offset: 24_000)))
        _ = try await files.execute(.init(operation: "write", path: big.path, content: "complete", revision: last["revision"] as? String))
        try check(try String(contentsOf: big, encoding: .utf8) == "complete", "complete paged read allows editing")
        try await rejected(files, .init(operation: "write", path: documents.appendingPathComponent("bad.pdf").path, content: "text"), containing: "binary")
        let linked = documents.appendingPathComponent("linked.txt")
        try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: source)
        let linkRead = try json(await files.execute(.init(operation: "read", path: linked.path)))
        try check(linkRead["path"] as? String == source.path, "symlink resolves to actual target")
        policy.update(read: true, write: false)
        try await rejected(files, .init(operation: "write", path: source.path, content: "revoked", revision: linkRead["revision"] as? String), containing: "Write access is off")
        policy.update(read: false, write: true)
        try await rejected(files, .init(operation: "read", path: source.path), containing: "File access is off")
        try check(!policy.current.write, "write cannot outlive read grant")

        var settings = AppSettings()
        var saved = try JSONSerialization.jsonObject(with: JSONEncoder().encode(settings)) as! [String: Any]
        saved.removeValue(forKey: "localFileAccessEnabled")
        saved.removeValue(forKey: "localFileWriteAccessEnabled")
        settings = try JSONDecoder().decode(AppSettings.self, from: JSONSerialization.data(withJSONObject: saved))
        try check(settings.resolvedLocalFileAccessEnabled && !settings.resolvedLocalFileWriteAccessEnabled, "old settings migrate to read-only")
        try check(try LocalFileToolCall.parse("Example: <scholia_file_tool>{\"operation\":\"write\"}</scholia_file_tool>") == nil, "embedded examples cannot execute")

        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [FileProviderProtocol.self]
        let session = URLSession(configuration: sessionConfig)
        defer { session.invalidateAndCancel() }
        let client = ProviderClient(session: session)
        policy.update(read: true, write: false)
        for id in ["openai", "anthropic", "ollama", "opencode"] {
            let provider = ProviderCatalog.provider(id: id)
            let path = id == "opencode" ? "" : "/\(id)"
            let config = ProviderConfiguration(provider: provider, model: provider.defaultModel,
                endpoint: "https://files.fixture.test\(path)", apiKey: "fixture", language: .english,
                reasoningEffort: nil, fastClaudeMode: false, localFileAccess: policy)
            let request = LocalFileToolCall.opening + String(decoding: try JSONEncoder().encode(LocalFileToolCall(operation: "read", path: source.path)), as: UTF8.self) + LocalFileToolCall.closing
            FileProviderFixture.shared.reset([request, "The file says: External change."])
            var streamed = ""
            let output = try await client.complete(capture: nil, messages: [.init(role: .user, content: "Read \(source.path)")], configuration: config,
                onToken: { streamed += $0 })
            try check(output.text == "The file says: External change." && streamed == output.text, "\(id): tool call stays hidden; final answer streams exactly once")
            let bodies = FileProviderFixture.shared.bodies
            try check(bodies.count == 2, "\(id): provider is called again with file result")
            let second = String(decoding: try JSONSerialization.data(withJSONObject: bodies[1]), as: UTF8.self)
            try check(second.contains("External change"), "\(id): model receives real file contents")
            if id == "opencode" {
                let permissions = FileProviderFixture.shared.sessions.first?["permission"] as? [[String: String]]
                try check(permissions == [["permission": "*", "pattern": "*", "action": "deny"]], "opencode native tools cannot bypass policy")
            }
        }
        print("PASS: path resolution, approximate search, file reads, pagination, read-only defaults, live revocation, safe creation/replacement, stale revisions, and 4 provider tool loops with streaming")
    }

    static func rejected(_ files: LocalFileTools, _ call: LocalFileToolCall, containing expected: String) async throws {
        do {
            _ = try await files.execute(call)
        } catch {
            try check(error.localizedDescription.contains(expected), "expected '\(expected)', got '\(error.localizedDescription)'")
            return
        }
        throw LocalFileToolError("FAIL: operation unexpectedly permitted: \(call.operation)")
    }
}
