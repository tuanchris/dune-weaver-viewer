import SwiftUI
import WebKit

/// High-fidelity mode: web/index.html (sand-weaver's sand engine) in a web view,
/// served from the app bundle with the open pattern at ./pattern.thr.
struct SandView: NSViewRepresentable {
    let pattern: Data

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundledWeb(pattern: pattern), forURLScheme: "dune-weaver")
        let web = WKWebView(frame: .zero, configuration: config)
        web.load(URLRequest(url: URL(string: "dune-weaver://app/index.html")!))
        return web
    }

    func updateNSView(_ web: WKWebView, context: Context) {}
}

/// Serves the bundled web folder; a custom scheme because ES modules won't load from file URLs.
final class BundledWeb: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.appendingPathComponent("web").standardized
    private let pattern: Data

    init(pattern: Data) { self.pattern = pattern }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let file = root.appendingPathComponent(url.path).standardized
        let data = url.path == "/pattern.thr" ? pattern
            : file.path.hasPrefix(root.path + "/") ? try? Data(contentsOf: file) : nil
        guard let data else { return task.didFailWithError(URLError(.fileDoesNotExist)) }
        let type = ["html": "text/html", "js": "text/javascript", "css": "text/css"][url.pathExtension] ?? "text/plain"
        task.didReceive(URLResponse(url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: "utf-8"))
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
