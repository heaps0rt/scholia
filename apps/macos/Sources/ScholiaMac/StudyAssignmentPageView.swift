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
                }.frame(maxHeight: workspace.document == nil ? .infinity : 135)
            }.font(.system(size: 12))
            if !workspace.assignmentPDFs.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(workspace.assignmentPDFs) { pdf in
                            Button {
                                workspace.openAssignmentPDF(pdf.id)
                            } label: {
                                Label(
                                    pdf.title,
                                    systemImage: workspace.document?.sourceKey == pdf.id
                                        ? "checkmark.circle.fill" : "doc.richtext")
                            }.disabled(workspace.canvasBusy || pdf.unavailableReason != nil)
                                .help(pdf.unavailableReason ?? "Read PDF inside Scholia")
                        }
                    }.controlSize(.small)
                }
            } else if !workspace.canvasBusy && assignment.assignment?.linkedFileIDs != nil
                && workspace.assignmentNotice == nil
            {
                Text("No PDF is linked to this assignment.").font(.system(size: 11)).foregroundStyle(.secondary)
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
                ProgressView("Opening assignment files…").controlSize(.small).font(.system(size: 11))
            }
        }.padding(20).frame(
            maxWidth: .infinity, maxHeight: workspace.document == nil ? .infinity : nil, alignment: .topLeading)
    }
}
