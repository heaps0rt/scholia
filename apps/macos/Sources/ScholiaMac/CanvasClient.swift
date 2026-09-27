import CryptoKit
import Foundation
import SwiftUI
import WebKit

struct CanvasAccount: Sendable {
    var id: Int
    var name: String
}
struct CanvasCourseSummary: Identifiable, Sendable {
    var id: Int
    var name: String
    var code: String
    var term: String?
    var favorite: Bool? = nil
}
enum CanvasMaterialKind: String, Codable, Hashable, Sendable {
    case syllabus, pages, files, assignments
}

/// A catalog entry contains no downloaded content or expiring signed URLs.
struct CanvasMaterialReference: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var kind: CanvasMaterialKind
    var remoteID: String
    var title: String
    var fileName: String?
    var sourceURL: String
    var version: String
    var byteCount: Int?
    var moduleID: Int?
    var moduleTitle: String?
    var modulePosition: Int?
    var moduleItemPosition: Int?
    var assignment: CanvasAssignmentDetails?

    var unavailableReason: String? {
        if assignment?.locked == true { return "Locked in Canvas" }
        guard kind == .files else { return nil }
        if let byteCount, byteCount > StudyDocumentImporter.maximumBytes { return "Larger than 100 MB" }
        return nil  // Other files retain their original for the Mac app's Quick Look preview.
    }
    var symbol: String { kind == .files ? "doc.richtext" : kind == .assignments ? "checklist" : "doc.text" }
}
struct CanvasMaterialCatalog: Sendable {
    var items: [CanvasMaterialReference]
    var warnings: [String]
    var completeKinds: Set<CanvasMaterialKind> = []
    var moduleOrderComplete = false
}
struct CanvasMaterial: Identifiable, Sendable {
    var id: String
    var title: String
    var fileName: String
    var text: String?
    var downloadURL: URL?
    var sourceURL: String
    var version: String
    var assignment: CanvasAssignmentDetails?
}
struct CanvasMaterialList: Sendable {
    var items: [CanvasMaterial]
    var warnings: [String]
}

enum CanvasAddress {
    static func origin(_ value: String) throws -> URL {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: trimmed.contains("://") ? trimmed : "https://" + trimmed),
            parts.scheme == "https", let host = parts.host, !host.isEmpty,
            parts.user == nil, parts.password == nil, parts.port == nil || parts.port == 443
        else {
            throw StudyError.message("Enter your Canvas HTTPS address, such as canvas.ntnu.no.")
        }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else { throw StudyError.message("This Canvas address is invalid.") }
        return url
    }
    static func sameOrigin(_ url: URL, _ origin: URL) -> Bool {
        url.scheme == "https" && url.host?.lowercased() == origin.host?.lowercased()
            && (url.port ?? 443) == (origin.port ?? 443) && url.user == nil && url.password == nil
    }
    static func nextPage(_ header: String?, current: URL, origin: URL) -> URL? {
        guard
            let part = header?.components(separatedBy: ",").first(where: {
                $0.range(of: ";\\s*rel=\"?next\"?", options: .regularExpression) != nil
            }),
            let left = part.firstIndex(of: "<"), let right = part.firstIndex(of: ">"), left < right,
            let url = URL(string: String(part[part.index(after: left)..<right]), relativeTo: current)?.absoluteURL,
            sameOrigin(url, origin), url.path == current.path
        else { return nil }
        return url
    }
}

/// API redirects are refused. Download redirects may use signed HTTPS storage
/// URLs, but never carry a Canvas credential to another host.
final class CanvasRedirectPolicy: NSObject, URLSessionTaskDelegate, Sendable {
    let downloads: Bool
    init(downloads: Bool) { self.downloads = downloads }
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        guard downloads, let url = request.url, url.scheme == "https", url.user == nil, url.password == nil else {
            completionHandler(nil)
            return
        }
        var safe = request
        safe.setValue(nil, forHTTPHeaderField: "Authorization")
        safe.setValue(nil, forHTTPHeaderField: "Cookie")
        safe.httpShouldHandleCookies = false
        completionHandler(safe)
    }
}

actor CanvasClient {
    private struct CachedResponse: Sendable {
        var data: Data
        var response: HTTPURLResponse
    }
    let origin: URL
    private let cookieHeader: String
    private let token: String
    private let apiSession: URLSession
    private let downloadSession: URLSession
    private var metadataCache: [String: CachedResponse] = [:]
    private var cacheOrder: [String] = []
    private var cacheBytes = 0
    private var retryAfter: Date?

    /// Only called after both clients have authenticated as the same account.
    func reuseMetadata(from previous: CanvasClient) async {
        guard previous !== self, previous.origin == origin else { return }
        let (entries, order, bytes) = await previous.cachedMetadata()
        metadataCache = entries
        cacheOrder = order
        cacheBytes = bytes
    }
    private func cachedMetadata() -> ([String: CachedResponse], [String], Int) {
        (metadataCache, cacheOrder, cacheBytes)
    }
    private func cache(_ data: Data, response: HTTPURLResponse, key: String) {
        cacheBytes -= metadataCache.removeValue(forKey: key)?.data.count ?? 0
        cacheOrder.removeAll { $0 == key }
        guard
            response.value(forHTTPHeaderField: "ETag") != nil
                || response.value(forHTTPHeaderField: "Last-Modified") != nil
        else { return }
        metadataCache[key] = CachedResponse(data: data, response: response)
        cacheBytes += data.count
        cacheOrder.append(key)
        while cacheBytes > 32_000_000 || cacheOrder.count > 600 {
            let oldest = cacheOrder.removeFirst()
            cacheBytes -= metadataCache.removeValue(forKey: oldest)?.data.count ?? 0
        }
    }

    init(origin: URL, cookieHeader: String = "", token: String = "", session: URLSession? = nil) {
        self.origin = origin
        self.cookieHeader = cookieHeader
        self.token = token
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.timeoutIntervalForRequest = 40
        config.timeoutIntervalForResource = 180
        apiSession =
            session
            ?? URLSession(configuration: config, delegate: CanvasRedirectPolicy(downloads: false), delegateQueue: nil)
        downloadSession =
            session
            ?? URLSession(configuration: config, delegate: CanvasRedirectPolicy(downloads: true), delegateQueue: nil)
    }

    func account() async throws -> CanvasAccount {
        let item = try await object("/api/v1/users/self/profile")
        guard let id = item["id"] as? Int, let name = item["name"] as? String else {
            throw StudyError.message("Canvas did not return an account. Sign in and try again.")
        }
        return CanvasAccount(id: id, name: name)
    }

    func courses() async throws -> [CanvasCourseSummary] {
        // No enrollment-state filter: include accessible past courses as well as current ones.
        // include[]=favorites returns the user's explicit stars, not Canvas's default dashboard selection.
        let records = try await list(
            "/api/v1/courses?include[]=term&include[]=favorites&state[]=available&state[]=completed")
        var seen = Set<Int>()
        return records.compactMap { item in
            guard let id = item["id"] as? Int, let name = item["name"] as? String,
                item["workflow_state"] as? String != "deleted", seen.insert(id).inserted
            else { return nil }
            return CanvasCourseSummary(
                id: id, name: name, code: item["course_code"] as? String ?? "",
                term: (item["term"] as? [String: Any])?["name"] as? String,
                favorite: item["is_favorite"] as? Bool)
        }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    func catalog(courseID: Int) async throws -> CanvasMaterialCatalog {
        let prefix = "/api/v1/courses/\(courseID)"
        let source = origin.absoluteString + "/courses/\(courseID)"
        var warnings: [String] = []
        var completeKinds: Set<CanvasMaterialKind> = []
        var moduleOrderComplete = false
        var candidates: [String: CanvasMaterialReference] = [:]
        func add(_ kind: CanvasMaterialKind, _ id: String, _ record: [String: Any]) {
            let key = "\(kind.rawValue):\(id)"
            guard candidates[key] == nil, Self.listable(record, kind: kind) else { return }
            let title =
                record["title"] as? String ?? record["display_name"] as? String ?? record["name"] as? String ?? id
            candidates[key] = CanvasMaterialReference(
                id: key, kind: kind, remoteID: id, title: title,
                fileName: record["filename"] as? String, sourceURL: source + "/\(kind.rawValue)/\(Self.component(id))",
                version: Self.materialVersion(record, kind: kind), byteCount: record["size"] as? Int,
                assignment: kind == .assignments && record["submission_types"] != nil
                    ? CanvasAssignmentDetails(record: record, origin: origin, courseID: courseID) : nil)
        }
        for collection in ["pages", "files", "assignments", "modules"] {
            try Task.checkCancellation()
            do {
                let include =
                    collection == "modules"
                    ? "?include[]=items" : collection == "assignments" ? "?include[]=submission" : ""
                var records = try await list(prefix + "/" + collection + include)
                if collection == "modules" {
                    moduleOrderComplete = true
                    records.sort { ($0["position"] as? Int ?? 0) < ($1["position"] as? Int ?? 0) }
                }
                if let kind = CanvasMaterialKind(rawValue: collection) { completeKinds.insert(kind) }
                for record in records where Self.listable(record, kind: CanvasMaterialKind(rawValue: collection)) {
                    if collection == "modules" {
                        guard let moduleID = record["id"] as? Int, record["state"] as? String != "locked" else {
                            continue
                        }
                        do {
                            let inline = record["items"] as? [[String: Any]] ?? []
                            let items =
                                inline.count >= (record["items_count"] as? Int ?? Int.max)
                                ? inline : try await list(prefix + "/modules/\(moduleID)/items")
                            for (itemIndex, item) in items.enumerated() where Self.accessible(item) {
                                if (item["content_details"] as? [String: Any])?["locked_for_user"] as? Bool == true {
                                    continue
                                }
                                var key: String?
                                switch item["type"] as? String {
                                case "Page":
                                    if let slug = item["page_url"] as? String {
                                        add(.pages, slug, item)
                                        key = "pages:\(slug)"
                                    }
                                case "File":
                                    if let id = item["content_id"] as? Int {
                                        add(.files, String(id), item)
                                        key = "files:\(id)"
                                    }
                                case "Assignment":
                                    if let id = item["content_id"] as? Int {
                                        let assignmentKey = "assignments:\(id)"
                                        key = assignmentKey
                                        if candidates[assignmentKey] == nil {
                                            do {
                                                let detail = try await object(
                                                    prefix + "/assignments/\(id)?include[]=submission", revalidate: true
                                                )
                                                add(.assignments, String(id), detail)
                                            } catch {
                                                try Task.checkCancellation()
                                                add(.assignments, String(id), item)
                                                warnings.append("Assignment \(id): \(error.localizedDescription)")
                                            }
                                        }
                                    }
                                default: break
                                }
                                if let key, candidates[key]?.moduleID == nil {
                                    candidates[key]?.moduleID = moduleID
                                    candidates[key]?.moduleTitle = record["name"] as? String ?? "Module \(moduleID)"
                                    candidates[key]?.modulePosition =
                                        record["position"] as? Int ?? records.firstIndex(where: {
                                            ($0["id"] as? Int) == moduleID
                                        }) ?? 0
                                    candidates[key]?.moduleItemPosition = item["position"] as? Int ?? itemIndex
                                }
                            }
                        } catch {
                            moduleOrderComplete = false
                            try Task.checkCancellation()
                            warnings.append("Module \(moduleID): \(error.localizedDescription)")
                        }
                    } else if collection == "pages", let slug = record["url"] as? String {
                        add(.pages, slug, record)
                    } else if let id = record["id"] as? Int, let kind = CanvasMaterialKind(rawValue: collection) {
                        add(kind, String(id), record)
                    }
                }
            } catch {
                try Task.checkCancellation()
                warnings.append("\(collection.capitalized): \(error.localizedDescription)")
            }
        }
        do {
            let info = try await object(prefix + "?include[]=syllabus_body", revalidate: true)
            completeKinds.insert(.syllabus)
            if let body = info["syllabus_body"] as? String,
                !StudyHTML.plainText(body).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            {
                candidates["syllabus"] = CanvasMaterialReference(
                    id: "syllabus", kind: .syllabus, remoteID: "syllabus", title: "Course syllabus",
                    sourceURL: source + "/assignments/syllabus",
                    version: SHA256.hash(data: Data(body.utf8)).map { String(format: "%02x", $0) }.joined())
            }
        } catch {
            try Task.checkCancellation()
            warnings.append("Syllabus: \(error.localizedDescription)")
        }
        let items = candidates.values.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        return CanvasMaterialCatalog(
            items: items, warnings: warnings, completeKinds: completeKinds, moduleOrderComplete: moduleOrderComplete)
    }

    func material(_ reference: CanvasMaterialReference, courseID: Int) async throws -> CanvasMaterial {
        let prefix = "/api/v1/courses/\(courseID)"
        if reference.kind == .syllabus {
            let info = try await object(prefix + "?include[]=syllabus_body")
            let body = info["syllabus_body"] as? String ?? ""
            let text = StudyHTML.plainText(body)
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw StudyError.message("This course has no syllabus text.")
            }
            return CanvasMaterial(
                id: reference.id, title: reference.title, fileName: "Course syllabus.md", text: text,
                sourceURL: reference.sourceURL,
                version: SHA256.hash(data: Data(body.utf8)).map { String(format: "%02x", $0) }.joined())
        }
        let item = try await object(
            prefix + "/\(reference.kind.rawValue)/\(Self.component(reference.remoteID))"
                + (reference.kind == .assignments ? "?include[]=submission" : ""))
        guard Self.accessible(item) else {
            throw StudyError.message("This material is not currently available in Canvas.")
        }
        let title =
            item["title"] as? String ?? item["display_name"] as? String ?? item["name"] as? String ?? reference.title
        let version = Self.materialVersion(item, kind: reference.kind)
        if reference.kind == .files {
            let name = item["filename"] as? String ?? title
            var resolved = reference
            resolved.fileName = name
            resolved.byteCount = item["size"] as? Int
            if let reason = resolved.unavailableReason { throw StudyError.message(reason) }
            guard let value = item["url"] as? String, let url = URL(string: value), url.scheme == "https",
                url.user == nil, url.password == nil
            else {
                throw StudyError.message("Canvas did not provide a valid download address.")
            }
            return CanvasMaterial(
                id: reference.id, title: title, fileName: name, downloadURL: url, sourceURL: reference.sourceURL,
                version: version)
        }
        let body = item[reference.kind == .pages ? "body" : "description"] as? String ?? ""
        let due = (item["due_at"] as? String).map { "\n\nDue: \($0)" } ?? ""
        return CanvasMaterial(
            id: reference.id, title: title, fileName: "\(title).md",
            text: "# \(title)\n\n" + StudyHTML.plainText(body) + due, sourceURL: reference.sourceURL, version: version,
            assignment: reference.kind == .assignments
                ? CanvasAssignmentDetails(record: item, origin: origin, courseID: courseID) : nil)
    }

    func fileReference(id: String, courseID: Int) async throws -> CanvasMaterialReference {
        guard let number = Int(id), number > 0 else { throw StudyError.message("Invalid Canvas file.") }
        let item = try await object("/api/v1/courses/\(courseID)/files/\(number)")
        guard Self.accessible(item) else {
            throw StudyError.message("This attachment is not currently available in Canvas.")
        }
        let name = item["filename"] as? String ?? item["display_name"] as? String ?? "File \(number)"
        return CanvasMaterialReference(
            id: "files:\(number)", kind: .files, remoteID: String(number),
            title: item["display_name"] as? String ?? name, fileName: name,
            sourceURL: origin.absoluteString + "/courses/\(courseID)/files/\(number)",
            version: Self.materialVersion(item, kind: .files), byteCount: item["size"] as? Int)
    }

    private static func component(_ value: String) -> String {
        value.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))) ?? value
    }
    private static func materialVersion(_ item: [String: Any], kind: CanvasMaterialKind) -> String {
        let version = item["updated_at"] as? String ?? item["modified_at"] as? String ?? ""
        // A student's deadline override can change without updated_at changing.
        // Invalidate the downloaded description's appended Due line as well.
        guard kind == .assignments, item["submission_types"] != nil else { return version }
        return version + "|due:" + (item["due_at"] as? String ?? "none")
    }

    func download(_ url: URL, limit: Int = StudyDocumentImporter.maximumBytes) async throws -> Data {
        guard url.scheme == "https", url.user == nil, url.password == nil else {
            throw StudyError.message("Canvas returned an invalid download address.")
        }
        var request = URLRequest(url: url)
        request.httpShouldHandleCookies = false
        if CanvasAddress.sameOrigin(url, origin) { authorize(&request) }
        return try await fetch(
            request, session: downloadSession, limit: min(limit, StudyDocumentImporter.maximumBytes), downloads: true
        ).0
    }

    private static func accessible(_ item: [String: Any]) -> Bool {
        item["published"] as? Bool != false && item["locked_for_user"] as? Bool != true
            && item["hidden_for_user"] as? Bool != true
    }
    private static func listable(_ item: [String: Any], kind: CanvasMaterialKind?) -> Bool {
        // A locked assignment still has a useful deadline; its content stays locked.
        kind == .assignments
            ? item["published"] as? Bool != false && item["hidden_for_user"] as? Bool != true
            : accessible(item)
    }
    private func authorize(_ request: inout URLRequest) {
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else if !cookieHeader.isEmpty {
            request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        }
    }
    private func request(_ path: String, revalidate: Bool = false) async throws -> (Any, HTTPURLResponse) {
        guard let url = URL(string: path, relativeTo: origin)?.absoluteURL, CanvasAddress.sameOrigin(url, origin),
            url.path.hasPrefix("/api/v1/")
        else {
            throw StudyError.message("Canvas returned an invalid API address.")
        }
        var request = URLRequest(url: url)
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        authorize(&request)
        let cached = revalidate ? metadataCache[url.absoluteString] : nil
        if let tag = cached?.response.value(forHTTPHeaderField: "ETag") {
            request.setValue(tag, forHTTPHeaderField: "If-None-Match")
        } else if let modified = cached?.response.value(forHTTPHeaderField: "Last-Modified") {
            request.setValue(modified, forHTTPHeaderField: "If-Modified-Since")
        }
        let (data, response) = try await fetch(
            request, session: apiSession, limit: 8_000_000, allowNotModified: cached != nil)
        if response.statusCode == 304, let cached {
            let oldHeaders = cached.response.allHeaderFields.reduce(into: [String: String]()) {
                $0[String(describing: $1.key).lowercased()] = String(describing: $1.value)
            }
            let headers = response.allHeaderFields.reduce(into: oldHeaders) {
                $0[String(describing: $1.key).lowercased()] = String(describing: $1.value)
            }
            let merged =
                HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)
                ?? cached.response
            cache(cached.data, response: merged, key: url.absoluteString)
            return (try JSONSerialization.jsonObject(with: cached.data), merged)
        }
        guard response.mimeType?.contains("json") == true else {
            throw StudyError.message("Sign in to Canvas, then choose Index all courses.")
        }
        let value = try JSONSerialization.jsonObject(with: data)
        if revalidate { cache(data, response: response, key: url.absoluteString) }
        return (value, response)
    }
    private func object(_ path: String, revalidate: Bool = false) async throws -> [String: Any] {
        guard let value = try await request(path, revalidate: revalidate).0 as? [String: Any] else {
            throw StudyError.message("Canvas returned an invalid object.")
        }
        return value
    }
    private func list(_ path: String) async throws -> [[String: Any]] {
        var next: String? = path + (path.contains("?") ? "&" : "?") + "per_page=100"
        var result: [[String: Any]] = []
        var visited = Set<String>()
        while let page = next {
            guard visited.insert(page).inserted, visited.count <= 50 else {
                throw StudyError.message("Canvas pagination exceeded its limit. Some course items could not be listed.")
            }
            let (value, response) = try await request(page, revalidate: true)
            guard let items = value as? [[String: Any]], let current = response.url else {
                throw StudyError.message("Canvas returned an invalid list.")
            }
            result += items
            let link = response.value(forHTTPHeaderField: "Link")
            let nextURL = CanvasAddress.nextPage(link, current: current, origin: origin)
            if link?.contains("rel=\"next\"") == true && nextURL == nil {
                throw StudyError.message("Canvas returned an unsafe pagination address.")
            }
            next = nextURL?.absoluteString
        }
        return result
    }
    private func fetch(
        _ request: URLRequest, session: URLSession, limit: Int, allowNotModified: Bool = false, downloads: Bool = false,
        attempt: Int = 0
    ) async throws -> (Data, HTTPURLResponse) {
        if let retryAfter, retryAfter > Date() {
            throw StudyError.message("Canvas is rate limiting requests. Wait a moment before refreshing again.")
        }
        let (data, http) = try await CanvasDataTransfer(limit: limit, downloads: downloads).receive(
            request, session: session)
        if http.statusCode == 429 {
            let raw = http.value(forHTTPHeaderField: "Retry-After") ?? ""
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
            let requested = Double(raw) ?? formatter.date(from: raw)?.timeIntervalSinceNow ?? Double(2 << attempt)
            let delay = requested.isFinite ? max(1, min(86_400, requested)) : 60
            retryAfter = Date().addingTimeInterval(delay)
            guard attempt < 2, delay <= 60 else {
                throw StudyError.message(
                    "Canvas is rate limiting requests. Try refreshing again in \(Int(delay)) seconds.")
            }
            try await Task.sleep(for: .seconds(delay))
            return try await fetch(
                request, session: session, limit: limit, allowNotModified: allowNotModified, downloads: downloads,
                attempt: attempt + 1)
        }
        if allowNotModified && http.statusCode == 304 { return (Data(), http) }
        guard (200..<300).contains(http.statusCode) else {
            switch http.statusCode {
            case 401, 302: throw StudyError.message("Your Canvas sign-in has expired. Sign in again.")
            case 403: throw StudyError.message("Canvas has not granted access to this resource.")
            case 429: throw StudyError.message("Canvas is rate limiting requests. Wait a moment, then sync again.")
            default: throw StudyError.message("Canvas returned HTTP \(http.statusCode).")
            }
        }
        return (data, http)
    }
}

@MainActor
enum CanvasSession {
    static func client(origin: URL) async throws -> CanvasClient {
        let token = try ProviderKeychain.value(for: "canvas:\(origin.absoluteString)")
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        let host = origin.host?.lowercased() ?? ""
        let applicable = cookies.filter {
            let domain = $0.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            return (host == domain || host.hasSuffix("." + domain)) && ($0.expiresDate ?? .distantFuture) > Date()
        }
        return CanvasClient(
            origin: origin, cookieHeader: HTTPCookie.requestHeaderFields(with: applicable)["Cookie"] ?? "", token: token
        )
    }
    static func disconnect(origin: URL) async throws {
        try ProviderKeychain.set("", for: "canvas:\(origin.absoluteString)")
        let store = WKWebsiteDataStore.default().httpCookieStore
        for cookie in await store.allCookies() {
            let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
            if origin.host == domain || origin.host?.hasSuffix("." + domain) == true {
                await store.deleteCookie(cookie)
            }
        }
    }
}

struct CanvasSignInView: NSViewRepresentable {
    let origin: URL
    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: origin.appendingPathComponent("login")))
        return webView
    }
    func updateNSView(_ view: WKWebView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(
            _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
        ) {
            let scheme = navigationAction.request.url?.scheme
            decisionHandler(scheme == "https" || scheme == "about" ? .allow : .cancel)
        }
    }
}
