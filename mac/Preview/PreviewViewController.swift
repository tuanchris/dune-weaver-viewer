import Cocoa
import QuickLookUI
import SwiftUI

/// Space-bar Quick Look: the finished pattern, with the player's controls to replay it.
final class PreviewViewController: NSViewController, QLPreviewingController {
    override func loadView() {
        view = NSView()
        preferredContentSize = NSSize(width: 640, height: 720)
    }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        do {
            let path = ThrPath(text: String(decoding: try Data(contentsOf: url), as: UTF8.self))
            let host = NSHostingView(rootView: PlayerView(path: path, autoplay: false))
            host.frame = view.bounds
            host.autoresizingMask = [.width, .height]
            view.addSubview(host)
            handler(nil)
        } catch {
            handler(error)
        }
    }
}
