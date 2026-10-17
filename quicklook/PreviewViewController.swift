// The Quick Look preview extension: Finder's space-bar preview of a .md file,
// drawn by the same renderer as the app's preview pane.
//
// The page is frontend/quicklook.html, built by `vite build --mode quicklook`
// and copied into this extension's Resources/quicklook by the root
// Taskfile's quicklook:build. It exposes window.renderMarkdown(text), which
// resolves once charts, diagrams and code have hydrated (or after the page's
// own 5 s limit); the completion handler is held until then so Quick Look
// never shows a half-drawn page. A backstop here completes it regardless, so
// a page that never loads or never answers cannot hold Quick Look forever.
//
// Reading and decoding the file, and deciding which navigations to allow, are in
// PreviewText.swift, which quicklook/Tests exercises.

import Cocoa
import Quartz
import WebKit

@objc(PreviewViewController)
final class PreviewViewController: NSViewController, QLPreviewingController, WKNavigationDelegate {
    private var webView: WKWebView!
    private var pageURL: URL?
    /// The file's contents, waiting for the page to finish loading.
    private var pending: PreviewText.Contents?
    private var handler: ((Error?) -> Void)?
    private var backstop: DispatchWorkItem?
    private var pageLoaded = false

    /// Longer than the page's own hydrator limit (HYDRATE_TIMEOUT_MS, 5 s),
    /// so this fires only when the page itself is stuck.
    private static let backstopSeconds = 10.0

    override func loadView() {
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 1000), configuration: config)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        view = webView
    }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        let contents: PreviewText.Contents
        do {
            // Read here, by the extension: Quick Look extends the sandbox to
            // the file it is previewing, and the web content process is not
            // given access to it at all.
            contents = try PreviewText.read(url)
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
        pageLoaded = false
        self.handler = handler
        pending = contents
        let backstop = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            // Loaded: show whatever the page drew. Not loaded: an error, so
            // Quick Look falls back to its own plain-text preview.
            self.complete(self.pageLoaded ? nil : CocoaError(.fileReadUnknown))
        }
        self.backstop = backstop
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.backstopSeconds, execute: backstop)
        installOfflineRules { [weak self] error in
            guard let self = self, self.handler != nil else { return }
            // Fail closed: without the rules nothing stops the page reaching
            // the network, so it is not loaded at all.
            if let error = error {
                self.complete(error)
                return
            }
            self.webView.loadFileURL(page, allowingReadAccessTo: dir)
        }
    }

    private var offlineRulesInstalled = false

    /// Adds PreviewText.offlineRules to the web view once. WebKit caches the
    /// compiled list in the extension's container, so later compiles are cheap.
    private func installOfflineRules(_ done: @escaping (Error?) -> Void) {
        if offlineRulesInstalled { return done(nil) }
        guard let store = WKContentRuleListStore.default() else {
            return done(CocoaError(.featureUnsupported))
        }
        store.compileContentRuleList(
            forIdentifier: "halmos-quicklook-offline",
            encodedContentRuleList: PreviewText.offlineRules
        ) { [weak self] list, error in
            guard let self = self else { return }
            guard let list = list else { return done(error ?? CocoaError(.featureUnsupported)) }
            self.webView.configuration.userContentController.add(list)
            self.offlineRulesInstalled = true
            done(nil)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let contents = pending else { return }
        pending = nil
        pageLoaded = true
        // Passed as arguments, never spliced into the script source, so
        // nothing in the document can be read as JavaScript.
        webView.callAsyncJavaScript(
            "await window.renderMarkdown(text, { totalBytes, shownBytes })",
            arguments: [
                "text": contents.text,
                "totalBytes": contents.totalBytes,
                "shownBytes": contents.shownBytes,
            ],
            in: nil,
            in: .page
        ) { [weak self] result in
            if case .failure(let error) = result { self?.complete(error) } else { self?.complete(nil) }
        }
    }

    // Only the page's own load counts: once it has loaded, the render owns
    // the completion, and a later navigation failing must not cut it short.
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if !pageLoaded { complete(error) }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if !pageLoaded { complete(error) }
    }

    // The page itself and same-page fragment links (a table of contents) only.
    // Any other link would navigate the preview away from the document.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let allowed = PreviewText.allowsNavigation(
            to: action.request.url,
            page: pageURL,
            isLinkClick: action.navigationType != .other
        )
        decisionHandler(allowed ? .allow : .cancel)
    }

    /// Calls Quick Look's completion handler exactly once, from whichever of
    /// the render, a load failure or the backstop gets there first.
    private func complete(_ error: Error?) {
        backstop?.cancel()
        backstop = nil
        pending = nil
        guard let done = handler else { return }
        handler = nil
        done(error)
    }
}
