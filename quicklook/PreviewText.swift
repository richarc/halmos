// The Quick Look extension's pure helpers, kept apart from the view
// controller so quicklook/Tests/main.swift can exercise them without
// WebKit or Quick Look.

import Foundation

enum PreviewText {
    /// The most of a file the preview reads. Past this, the page shows the
    /// start with a note saying so: Quick Look is a glance, and a file this
    /// size would take seconds to render on every press of the space bar.
    static let byteLimit = 5 * 1024 * 1024

    struct Contents {
        let text: String
        /// The file's size on disk.
        let totalBytes: Int
        /// How many of those bytes `text` was decoded from.
        let shownBytes: Int
    }

    /// Reads at most `limit` bytes of the file as UTF-8. Invalid sequences
    /// become U+FFFD rather than failing the preview, a leading byte-order
    /// mark is dropped, and a cut through a multi-byte character backs off to
    /// the character before it.
    static func read(_ url: URL, limit: Int = byteLimit) throws -> Contents {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var data = try handle.read(upToCount: limit) ?? Data()
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? data.count
        let total = max(size, data.count)
        if total > data.count {
            data = completeUTF8Prefix(data)
        }
        let shown = data.count
        if data.starts(with: [0xEF, 0xBB, 0xBF]) {
            data = data.dropFirst(3)
        }
        return Contents(text: String(decoding: data, as: UTF8.self), totalBytes: total, shownBytes: shown)
    }

    /// `bytes` without a trailing, incomplete UTF-8 sequence.
    static func completeUTF8Prefix(_ bytes: Data) -> Data {
        var i = bytes.endIndex
        var back = 0
        while i > bytes.startIndex && back < 4 {
            i -= 1
            back += 1
            let b = bytes[i]
            if b & 0xC0 == 0x80 { continue } // a continuation byte
            let length = b < 0x80 ? 1 : b >= 0xF0 ? 4 : b >= 0xE0 ? 3 : b >= 0xC0 ? 2 : 1
            return back < length ? Data(bytes[bytes.startIndex..<i]) : bytes
        }
        return bytes
    }

    /// Whether the page may navigate to `url`: its own load, or a move to a
    /// fragment on itself (a table of contents). Anything else — another
    /// file, a web URL, a query, or a link back to the page itself — would
    /// reload or replace the page and blank the preview.
    ///
    /// The page is matched by resolved file path, because WebKit can report it
    /// with a `/private` prefix or percent-encoded — the bundle path has a
    /// space in it ("Halmos Editor.app") — and an exact URL comparison would
    /// then cancel the page's own load. `isLinkClick` is any navigation other
    /// than the initial load; one of those must carry a fragment.
    static func allowsNavigation(to url: URL?, page: URL?, isLinkClick: Bool) -> Bool {
        guard let url = url, let page = page, url.isFileURL, page.isFileURL else { return false }
        guard resolvedPath(url) == resolvedPath(page), url.query == page.query else { return false }
        return !isLinkClick || url.fragment != nil
    }

    /// A WebKit content rule list that blocks every load except local ones.
    /// The extension needs com.apple.security.network.client — without it the
    /// sandbox kills WKWebView's web content process before the page loads —
    /// so this, not the sandbox, is what keeps Quick Look off the network:
    /// a Vega spec naming a data URL, or anything else the page might ask
    /// for, is refused before a request is made. Separate rules per scheme
    /// because WebKit's url-filter regex has no alternation.
    static let offlineRules = """
    [
      {"trigger": {"url-filter": ".*"}, "action": {"type": "block"}},
      {"trigger": {"url-filter": "^file:"}, "action": {"type": "ignore-previous-rules"}},
      {"trigger": {"url-filter": "^data:"}, "action": {"type": "ignore-previous-rules"}},
      {"trigger": {"url-filter": "^about:"}, "action": {"type": "ignore-previous-rules"}},
      {"trigger": {"url-filter": "^blob:"}, "action": {"type": "ignore-previous-rules"}}
    ]
    """

    private static func resolvedPath(_ url: URL) -> String {
        // .path drops the fragment and query and percent-decodes;
        // resolvingSymlinksInPath also strips a leading /private.
        URL(fileURLWithPath: url.path).standardizedFileURL.resolvingSymlinksInPath().path
    }
}
