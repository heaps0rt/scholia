import SwiftUI

struct StudySearchView: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var scope = ""
    @State private var mode = "all"
    @State private var response: StudySearchResponse?
    @State private var searching = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text("NEEDLE").font(.system(size: 10, weight: .semibold)).tracking(2).foregroundStyle(.secondary)
                    Text("Find it in your library").font(.system(size: 25, design: .serif))
                }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            TextField("File name, words, or \"exact phrase\"", text: $query)
                .textFieldStyle(.roundedBorder).font(.title3).focused($focused)
                .onSubmit { if let hit = response?.results.first { open(hit) } }
            HStack {
                Picker("Search in", selection: $scope) {
                    Text("All workspaces").tag("")
                    ForEach(workspace.library.courses) { course in
                        Text(course.code.isEmpty ? course.name : "\(course.code) · \(course.name)").tag(course.id.uuidString)
                    }
                }
                Picker("Look for", selection: $mode) {
                    Text("Names & contents").tag("all")
                    Text("File names").tag("files")
                    Text("Contents").tag("content")
                }.frame(width: 230)
            }.font(.caption)
            if searching {
                HStack { ProgressView().controlSize(.small); Text("Searching… Preparing new files on the first search.") }
                    .font(.caption).foregroundStyle(.secondary)
            } else if let error {
                Text(error).font(.caption).foregroundStyle(.red)
            } else if let response {
                Text("\(response.total) matching files · \(Int(response.totalMs)) ms · \(response.coverage["contentFiles", default: 0]) of \(response.coverage["files", default: 0]) files have searchable text")
                    .font(.caption).foregroundStyle(.secondary)
                if response.coverage["remoteFiles", default: 0] > 0 || response.coverage["unavailableFiles", default: 0] > 0 {
                    Text("Cloud materials are searchable by name. Download them to search inside. Saved files without readable text are searchable by name only.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if response.total > response.results.count {
                    Text("Showing the first \(response.results.count) files. Add another term to narrow the results.").font(.caption)
                }
            } else { Text("Search one workspace or your entire library.").font(.caption).foregroundStyle(.secondary) }
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(response?.results ?? []) { hit in
                        Button { open(hit) } label: {
                            VStack(alignment: .leading, spacing: 7) {
                                HStack {
                                    Text(hit.title).font(.system(size: 14, weight: .semibold))
                                    Spacer()
                                    Text(hit.page > 0 ? "\(hit.kind == "notebook" ? "Cell" : ["code", "office"].contains(hit.kind) ? "Section" : "Page") \(hit.page)" : hit.documentID == nil ? "Cloud material" : "File name")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Text(hit.courseName).font(.caption).foregroundStyle(.secondary)
                                Text(hit.snippet).font(.system(size: 12)).lineLimit(4)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(14)
                                .background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
            }.frame(maxHeight: .infinity)
            Text("Every word must match the same page or file name. Use double quotes for a phrase. Search reads saved text, including available OCR.")
                .font(.caption).foregroundStyle(.secondary)
        }.padding(26).frame(width: 710, height: 610)
            .onAppear { scope = workspace.isShowingLibrary ? "" : workspace.course?.id.uuidString ?? ""; focused = true }
            .task(id: [query, scope, mode]) {
                response = nil; error = nil
                guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { searching = false; return }
                searching = true
                do {
                    try await Task.sleep(for: .milliseconds(35))
                    let result = try await workspace.fileSearch.search(courses: workspace.library.courses,
                        store: workspace.store, query: query, courseID: scope, mode: mode)
                    try Task.checkCancellation()
                    response = result; searching = false
                } catch is CancellationError { }
                catch { if !Task.isCancelled { self.error = error.localizedDescription; searching = false } }
            }
    }

    private func open(_ hit: StudySearchHit) {
        guard let courseID = UUID(uuidString: hit.courseID),
              let course = workspace.library.courses.first(where: { $0.id == courseID }) else { return }
        if let id = hit.documentID.flatMap(UUID.init(uuidString:)), let document = course.documents.first(where: { $0.id == id }) {
            workspace.selectCourse(courseID)
            workspace.navigate(to: StudySource(documentID: id, title: document.title, page: max(1, hit.page)))
        } else if let material = course.materials.first(where: { $0.id == hit.materialID }) {
            if material.kind == .assignments { workspace.openAssignment(material, courseID: courseID) }
            else { workspace.openCanvasMaterial(material, courseID: courseID) }
        }
        dismiss()
    }
}
