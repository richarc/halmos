// The Quick Look preview extension: Finder's space-bar preview of a .md file,
// drawn by the same renderer as the app's preview pane.
//
// The page is frontend/quicklook.html, built by `vite build --mode quicklook`
// and copied into this extension's Resources/quicklook by the root
// Taskfile's quicklook:build. It exposes window.renderMarkdown(text), which
// resolves once charts, diagrams and code have hydrated; the completion
// handler is held until then so Quick Look never shows a half-drawn page.

import Cocoa
import Quartz
import WebKit

@objc(PreviewViewController)
final class PreviewViewController: NSViewController, QLPreviewingController, WKNavigationDelegate {
    private var webView: WKWebView!
    private var pageURL: URL?
    private var pending: (text: String, done: (Error?) -> Void)?

    override func loadView() {
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 1000), configuration: config)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        view = webView
    }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        let text: String
        do {
            // Read here, by the extension: Quick Look extends the sandbox to
            // the file it is previewing, and the web content process is not
            // given access to it at all.
            let data = try Data(contentsOf: url)
            text = String(decoding: data, as: UTF8.self)
        } catch {
            handler(error)
            return
        }
        guard let dir = Bundle.main.resourceURL?.appendingPathComponent("quicklook", isDirectory: true) else {
            handler(CocoaError(.fileNoSuchFile))
            return
        }
        let page = dir.appendingPathComponent("quicklook.html")
        pageURL = page
        pending = (text, handler)
        webView.loadFileURL(page, allowingReadAccessTo: dir)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let (text, done) = pending else { return }
        pending = nil
        // Passed as an argument, never spliced into the script source, so
        // nothing in the document can be read as JavaScript.
        webView.callAsyncJavaScript(
            "await window.renderMarkdown(text)",
            arguments: ["text": text],
            in: nil,
            in: .page
        ) { result in
            if case .failure(let error) = result { done(error) } else { done(nil) }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(error)
    }

    // The page itself and same-page fragment links (a table of contents) only.
    // Any other link would navigate the preview away from the document.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let target = action.request.url.flatMap { u -> URL? in
            var c = URLComponents(url: u, resolvingAgainstBaseURL: false)
            c?.fragment = nil
            return c?.url
        }
        decisionHandler(target == pageURL ? .allow : .cancel)
    }

    private func finish(_ error: Error) {
        guard let (_, done) = pending else { return }
        pending = nil
        done(error)
    }
}
