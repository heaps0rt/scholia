import SwiftUI

struct StudyMaterialsList: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    let course: StudyCourse
    var query = ""
    var compact = false
    @AppStorage private var collapsed: String
    @AppStorage private var materialView: String

    init(workspace: StudyWorkspaceModel, course: StudyCourse, query: String = "", compact: Bool = false) {
        self.workspace = workspace
        self.course = course
        self.query = query
        self.compact = compact
        _collapsed = AppStorage(wrappedValue: "assets", "study.materialGroups.\(course.id)")
        _materialView = AppStorage(wrappedValue: "organized", "study.materialView.\(course.id)")
    }
    private var closed: Set<String> { Set(collapsed.split(separator: "|").map(String.init)) }
    private func toggle(_ id: String) {
        var values = closed
        if !values.insert(id).inserted { values.remove(id) }
        collapsed = values.sorted().joined(separator: "|")
    }
    var body: some View {
        let groups = StudyMaterialOrganizer.groups(for: course, query: query)
        let flat = !compact && materialView == "files"
        LazyVStack(alignment: .leading, spacing: compact ? 8 : 20) {
            if flat {
                let files = StudyMaterialOrganizer.files(for: course, query: query)
                Text("\(files.count) files").font(.caption).foregroundStyle(.secondary)
                LazyVStack(spacing: 4) { ForEach(files) { entry in material(entry) } }
                if files.isEmpty {
                    Text(query.isEmpty ? "No files in this workspace yet." : "No matching files.").font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(flat ? [] : groups) { group in
                VStack(alignment: .leading, spacing: compact ? 2 : 8) {
                    Button {
                        toggle(group.id)
                    } label: {
                        HStack(spacing: 7) {
                            Image(
                                systemName: closed.contains(group.id) && query.isEmpty
                                    ? "chevron.right" : "chevron.down"
                            ).font(.system(size: 9, weight: .semibold))
                            Text(group.title).font(.system(size: compact ? 11 : 14, weight: .semibold)).lineLimit(
                                compact ? 2 : nil)
                            Spacer(minLength: 3)
                            Text("\(group.items.count)").font(.system(size: 10).monospacedDigit()).foregroundStyle(
                                .tertiary)
                        }.padding(.horizontal, compact ? 9 : 2).padding(.vertical, 7).contentShape(Rectangle())
                    }.scholiaButtonStyle(.plain).help(group.basis).accessibilityLabel(
                        "\(group.title), \(group.items.count) materials")
                    if !closed.contains(group.id) || !query.isEmpty {
                        if !compact {
                            Text(group.basis).font(.system(size: 10)).foregroundStyle(.secondary).padding(.bottom, 3)
                        }
                        ForEach(group.items) { entry in material(entry) }
                    }
                }
            }
            if !flat && groups.isEmpty && !query.isEmpty {
                Text("No matching materials").font(.caption).foregroundStyle(.secondary).padding(10)
            }
        }
    }
    private func material(_ entry: StudyMaterialEntry) -> some View {
        let reference = course.materials.first { $0.id == entry.materialID }
        let isAssignment = reference?.kind == .assignments
        let selected =
            isAssignment
            ? workspace.assignment?.id == reference?.id
            : entry.documentID != nil && workspace.document?.id == entry.documentID
        return HStack(spacing: 4) {
            Button {
                if isAssignment, let reference {
                    workspace.openAssignment(reference, courseID: course.id)
                } else if let id = entry.documentID {
                    workspace.selectDocument(id)
                } else if let reference {
                    workspace.openCanvasMaterial(reference, courseID: course.id)
                }
            } label: {
                HStack(alignment: compact ? .top : .center, spacing: compact ? 8 : 12) {
                    Image(systemName: entry.symbol).font(.system(size: compact ? 12 : 20, weight: .light))
                        .foregroundStyle(.secondary).frame(width: compact ? 15 : 24)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.title).font(
                            .system(size: compact ? 11 : 13, weight: selected ? .semibold : .regular)
                        ).lineLimit(compact ? 2 : 3)
                        if !compact { Text(entry.detail).font(.system(size: 10)).foregroundStyle(.secondary) }
                        if isAssignment && reference?.assignment?.requiresSubmission != false {
                            StudySubmissionBadge(status: entry.submissionStatus)
                        }
                        if let badge = entry.badge {
                            Text(badge).font(.system(size: 9, weight: .medium)).foregroundStyle(Color.accentColor)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: entry.documentID == nil ? "icloud.and.arrow.down" : "internaldrive").font(
                        .system(size: 10)
                    ).foregroundStyle(.tertiary)
                        .help(entry.documentID == nil ? "Download on demand" : "Saved offline")
                }.padding(compact ? 9 : 13).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    .background(
                        selected ? Color.accentColor.opacity(0.10) : compact ? .clear : Color.primary.opacity(0.035),
                        in: RoundedRectangle(cornerRadius: compact ? 7 : 10))
            }.scholiaButtonStyle(.plain).disabled(
                !isAssignment && entry.documentID == nil
                    && (workspace.canvasBusy || reference?.unavailableReason != nil)
            )
            .contextMenu {
                if entry.updateAvailable, let reference {
                    Button("Download updated version") { workspace.openCanvasMaterial(reference, courseID: course.id) }
                        .disabled(workspace.canvasBusy)
                }
                if let id = entry.documentID {
                    Button("Remove downloaded copy", role: .destructive) { workspace.removeDocument(id) }.disabled(
                        workspace.canvasBusy || workspace.isImporting || workspace.isStreaming)
                }
            }
            if !compact, entry.updateAvailable, let reference {
                Button("Update") { workspace.openCanvasMaterial(reference, courseID: course.id) }.controlSize(.small)
                    .disabled(workspace.canvasBusy)
            }
            if !compact, let source = entry.sourceURL, let url = URL(string: source), url.scheme == "https" {
                Link(destination: url) { Image(systemName: "arrow.up.right").font(.caption).padding(7) }.help(
                    "Open in Canvas")
            }
        }
    }
}
