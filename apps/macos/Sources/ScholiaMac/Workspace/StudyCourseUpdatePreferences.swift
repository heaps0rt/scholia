import SwiftUI

struct StudyCourseUpdatePreferences: View {
    @ObservedObject var workspace: StudyWorkspaceModel

    var body: some View {
        Toggle("Automatically update math wiki", isOn: $workspace.automaticallyUpdateMathWiki)
        Text("Check math wiki pages every two minutes while the workspace is open, even when Canvas needs reconnecting. Recheck linked files every five minutes, or sooner when their course page changes. Only new or changed materials are downloaded.")
            .font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        Toggle("Automatically update course content", isOn: $workspace.automaticallyUpdateCanvasContent)
        Text("Every five minutes while the workspace is open, check current-semester courses, favorites and the course you open. Fetch new or changed files, pages, assignments and the syllabus. Saved local edits are kept separately.")
            .font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        Text("Scholia learns when each course usually publishes material and adds occasional checks at those times. Extra checks are limited to two per course and source, and eight across the workspace, in 24 hours. Regular checks continue; repeated failures slow down retries.")
            .font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }
}
