import SwiftUI

@main
struct ScholiaMacApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra {
            MenuContent()
                .environmentObject(model)
                .frame(width: 320)
        } label: {
            Image(systemName: "text.magnifyingglass")
                .accessibilityLabel("Scholia")
        }
        .menuBarExtraStyle(.window)

        Window("Scholia", id: "selection") {
            SelectionPreview()
                .environmentObject(model)
                .frame(minWidth: 480, minHeight: 360)
        }
        .defaultSize(width: 620, height: 520)

    }
}

private struct MenuContent: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Scholia").font(.system(.title2, design: .serif, weight: .bold))
                Text("Select anything. Understand it in place.").font(.caption).foregroundStyle(.secondary)
            }

            Button("Preview selected text", systemImage: "text.cursor") {
                if model.captureSelectedText() { openWindow(id: "selection") }
            }
            .buttonStyle(.borderedProminent)

            if !model.accessibilityGranted {
                Button("Allow selected-text access") { model.requestAccessibility() }
            }

            Divider()
            Text(model.status).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            SettingsLink { Text("Settings…") }
        }
        .padding(16)
    }
}

private struct SelectionPreview: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Scholia").font(.system(.largeTitle, design: .serif, weight: .bold))
            if let request = model.request {
                Text(request.kind == .latex ? "Selected mathematics" : "Selected text")
                    .font(.caption.weight(.bold)).textCase(.uppercase).foregroundStyle(.secondary)
                ScrollView {
                    Text(request.selection ?? "Captured image")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .padding()
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                }
            } else {
                ContentUnavailableView("No selection yet", systemImage: "text.cursor", description: Text("Select text in another app from the Scholia menu bar item."))
            }
        }
        .padding(24)
    }
}
