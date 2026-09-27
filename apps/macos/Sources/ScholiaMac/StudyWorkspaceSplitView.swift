import AppKit
import SwiftUI

/// AppKit owns the divider and its constraints; resizing never recreates the reader.
struct StudyWorkspaceSplitView<Reader: View, Tutor: View>: NSViewControllerRepresentable {
    var reader: Reader
    var tutor: Tutor
    var tutorVisible: Bool
    var readerReset: Int
    var minimumReaderWidth: CGFloat

    func makeNSViewController(context: Context) -> Controller {
        Controller(reader: reader, tutor: tutor, minimumReaderWidth: minimumReaderWidth)
    }
    func updateNSViewController(_ controller: Controller, context: Context) {
        if controller.lastReset != readerReset {
            controller.lastReset = readerReset
            controller.splitView.setPosition(
                max(minimumReaderWidth, controller.splitView.bounds.width - 390), ofDividerAt: 0)
        }
        controller.readerHost.rootView = reader
        controller.tutorHost.rootView = tutor
        if controller.splitViewItems[0].minimumThickness != minimumReaderWidth {
            controller.splitViewItems[0].minimumThickness = minimumReaderWidth
        }
        if controller.splitViewItems[1].isCollapsed == tutorVisible {
            controller.splitViewItems[1].isCollapsed = !tutorVisible
        }
    }
    final class Controller: NSSplitViewController {
        let readerHost: NSHostingController<Reader>
        let tutorHost: NSHostingController<Tutor>
        private var positioned = false
        var lastReset = 0
        init(reader: Reader, tutor: Tutor, minimumReaderWidth: CGFloat) {
            readerHost = NSHostingController(rootView: reader)
            tutorHost = NSHostingController(rootView: tutor)
            super.init(nibName: nil, bundle: nil)
            readerHost.sizingOptions = []
            tutorHost.sizingOptions = []
            splitView.isVertical = true
            splitView.dividerStyle = .thin
            splitView.autosaveName = "ScholiaDocumentTutorSplit"
            let reading = NSSplitViewItem(viewController: readerHost)
            reading.minimumThickness = minimumReaderWidth
            reading.holdingPriority = .init(249)
            let chat = NSSplitViewItem(viewController: tutorHost)
            chat.minimumThickness = 220
            chat.canCollapse = true
            chat.holdingPriority = .init(250)
            addSplitViewItem(reading)
            addSplitViewItem(chat)
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func viewDidLayout() {
            super.viewDidLayout()
            guard !positioned, splitView.bounds.width > 400 else { return }
            positioned = true
            if UserDefaults.standard.object(forKey: "NSSplitView Subview Frames ScholiaDocumentTutorSplit") == nil {
                splitView.setPosition(
                    max(splitViewItems[0].minimumThickness, splitView.bounds.width - 390), ofDividerAt: 0)
            }
        }
    }
}
