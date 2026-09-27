import SwiftUI

struct StudyAssignmentPageView: View {
    @ObservedObject var workspace: StudyWorkspaceModel
    let assignment: CanvasMaterialReference
    @State private var instructionsExpanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("ASSIGNMENT").font(.system(size: 9, weight: .semibold)).tracking(1.5).foregroundStyle(
                Color.accentColor)
            Text(assignment.title).font(.system(size: 25, design: .serif)).textSelection(.enabled)
            HStack(spacing: 12) {
                if let date = assignment.assignment?.dueDate {
                    Text("Due \(date.formatted(date: .abbreviated, time: .shortened))")
                } else {
                    Text(assignment.assignment == nil ? "Deadline not synced" : "No due date")
                }
                if assignment.assignment?.requiresSubmission != false {
                    StudySubmissionBadge(status: assignment.assignment?.status)
                }
            }.font(.system(size: 11)).foregroundStyle(.secondary)
            DisclosureGroup("Instructions", isExpanded: $instructionsExpanded) {
                ScrollView {
                    if workspace.assignmentText.isEmpty {
                        Text(
                            workspace.canvasBusy
                                ? "Loading instructions…"
                                : assignment.unavailableReason
                                    ?? "No saved instructions. Retry to load this assignment."
                        )
                        .font(.system(size: 12)).foregroundStyle(.secondary).frame(
                            maxWidth: .infinity, alignment: .leading
                        ).padding(.vertical, 8)
                    } else {
                        RichMarkdownView(source: workspace.assignmentText)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
                    }
                }.frame(maxHeight: workspace.document == nil ? .infinity : 90)
            }.font(.system(size: 12))
            if !workspace.assignmentFiles.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                    Text("Included files · \(workspace.assignmentFiles.count)")
                        .font(.system(size: 11, weight: .semibold))
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 7) {
                            ForEach(workspace.assignmentFiles) { file in
                                HStack(alignment: .top, spacing: 10) {
                                    Image(
                                        systemName: workspace.document?.sourceKey == file.id
                                            ? "doc.text.fill" : "doc.text"
                                    )
                                    .foregroundStyle(Color.accentColor).padding(.top, 2)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(file.fileName ?? file.title).font(.system(size: 11, weight: .medium))
                                            .textSelection(.enabled)
                                        Text(workspace.assignmentFileStatus(file)).font(.system(size: 10))
                                            .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                                    }
                                    Spacer(minLength: 6)
                                    Button(workspace.document?.sourceKey == file.id ? "Reading" : "Open") {
                                        workspace.openAssignmentFile(file.id)
                                    }.disabled(
                                        workspace.canvasBusy || workspace.document?.sourceKey == file.id
                                            || file.unavailableReason != nil
                                    )
                                    .help(
                                        file.unavailableReason
                                            ?? "Read \(file.fileName ?? file.title) with this assignment")
                                }.padding(.vertical, 3)
                            }
                        }.padding(.trailing, 4)
                    }.frame(height: min(170, CGFloat(workspace.assignmentFiles.count) * 48))
                }.controlSize(.small)
            } else if !workspace.canvasBusy && assignment.assignment?.linkedFileIDs != nil
                && workspace.assignmentNotice == nil
            {
                Text("No files are linked to this assignment.").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            if let notice = workspace.assignmentNotice {
                HStack(alignment: .top) {
                    Text(notice).font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(
                        horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    if assignment.unavailableReason == nil {
                        Button("Retry") {
                            if let course = workspace.course {
                                workspace.openAssignment(assignment, courseID: course.id)
                            }
                        }
                        .controlSize(.small).disabled(workspace.canvasBusy)
                    }
                }
            } else if workspace.canvasBusy {
                ProgressView("Preparing assignment files for the companion…").controlSize(.small).font(
                    .system(size: 11))
            }
        }.padding(20).frame(
            maxWidth: .infinity, maxHeight: workspace.document == nil ? .infinity : nil, alignment: .topLeading)
    }
}
