// Tests for PreviewText.swift, the extension's pure helpers. No XCTest: the
// extension is built with swiftc, not an Xcode project, so this is a plain
// executable that exits non-zero on the first failure. Run by
// `wails3 task quicklook:test`.

import Foundation

var failures = 0

func check(_ condition: Bool, _ message: String, line: Int = #line) {
    if !condition {
        failures += 1
        print("FAIL line \(line): \(message)")
    }
}

let fm = FileManager.default
// QL_TEST_TMP overrides the base, to exercise the /tmp and no-alternate
// branches of the /private case below.
let base = ProcessInfo.processInfo.environment["QL_TEST_TMP"].map { URL(fileURLWithPath: $0, isDirectory: true) }
    ?? fm.temporaryDirectory
let dir = base.appendingPathComponent("halmos-ql-tests-\(getpid())", isDirectory: true)
try! fm.createDirectory(at: dir, withIntermediateDirectories: true)
defer { try? fm.removeItem(at: dir) }

func write(_ name: String, _ bytes: [UInt8]) -> URL {
    let url = dir.appendingPathComponent(name)
    try! Data(bytes).write(to: url)
    return url
}

// MARK: reading the file

do {
    let small = try PreviewText.read(write("small.md", Array("# Hi\n".utf8)), limit: 100)
    check(small.text == "# Hi\n", "a small file is read whole")
    check(small.totalBytes == 5 && small.shownBytes == 5, "a small file reports its full size as shown")

    // Invalid UTF-8 (a Latin-1 é) is decoded with a replacement character
    // rather than failing the whole preview.
    let latin = try PreviewText.read(write("latin1.md", [0x63, 0x61, 0x66, 0xE9, 0x0A]), limit: 100)
    check(latin.text == "caf\u{FFFD}\n", "invalid UTF-8 becomes U+FFFD, got \(latin.text.debugDescription)")

    // A UTF-8 byte-order mark is dropped, or frontmatter on line 1 is missed.
    let bom = try PreviewText.read(write("bom.md", [0xEF, 0xBB, 0xBF] + Array("---\n".utf8)), limit: 100)
    check(bom.text == "---\n", "a UTF-8 BOM is stripped, got \(bom.text.debugDescription)")

    // Over the limit: only the first `limit` bytes are read.
    let big = try PreviewText.read(write("big.md", Array(repeating: 0x61, count: 50)), limit: 10)
    check(big.text == String(repeating: "a", count: 10), "a large file is cut at the limit")
    check(big.totalBytes == 50 && big.shownBytes == 10, "a large file reports total \(big.totalBytes), shown \(big.shownBytes)")

    // A cut through the middle of a multi-byte character backs off to the
    // character before it rather than ending in a replacement character.
    // "aé€" is 61 | C3 A9 | E2 82 AC; a limit of 5 cuts the euro sign.
    let split = try PreviewText.read(write("split.md", Array("aé€".utf8)), limit: 5)
    check(split.text == "aé", "a split character is dropped, got \(split.text.debugDescription)")
    check(split.shownBytes == 3, "shown bytes count the backed-off prefix, got \(split.shownBytes)")

    let exact = try PreviewText.read(write("exact.md", Array("aé€".utf8)), limit: 6)
    check(exact.text == "aé€" && exact.shownBytes == 6, "a file exactly at the limit is whole")
} catch {
    check(false, "read threw \(error)")
}

// MARK: which navigations the page may make

let page = write("quick look.html", Array("<p>".utf8))

func allows(_ url: URL?, link: Bool = true) -> Bool {
    PreviewText.allowsNavigation(to: url, page: page, isLinkClick: link)
}

func onPage(_ suffix: String) -> URL {
    URL(string: page.absoluteString + suffix)!
}

check(allows(page, link: false), "the page's own load is allowed")

let encoded = URL(string: "file://" + page.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!)!
check(allows(encoded, link: false), "percent-encoding is ignored: \(encoded.absoluteString)")

check(allows(onPage("#section-2")), "a fragment link on the page is allowed")
check(allows(onPage("#section-2"), link: false), "and so is a fragment navigation that is not a click")

// Anything else reloads the page and blanks the preview.
check(!allows(page), "a link to the page itself (no fragment) is cancelled")
check(!allows(onPage("?a")), "a query on the page is cancelled")
check(!allows(onPage("?a#x")), "a query with a fragment is cancelled")
check(!allows(onPage("?a"), link: false), "a query is cancelled however it arrives")

// The temporary directory is reached through a symlink (/var -> /private/var,
// /tmp -> /private/tmp); WebKit can report either spelling. Derived from the
// path actually in use, and skipped rather than failed when it has neither.
let alternates = [("/private/var/", "/var/"), ("/private/tmp/", "/tmp/"), ("/var/", "/private/var/"), ("/tmp/", "/private/tmp/")]
if let (from, to) = alternates.first(where: { page.path.hasPrefix($0.0) }) {
    let other = URL(fileURLWithPath: to + page.path.dropFirst(from.count))
    check(allows(other, link: false), "\(other.path) is the same file as \(page.path)")
    check(PreviewText.allowsNavigation(to: page, page: other, isLinkClick: false), "and the other way round")
} else {
    print("note: \(page.path) has no /private alternate spelling; skipping that case")
}

let dotted = dir.appendingPathComponent("sub/../quick look.html")
check(allows(dotted, link: false), "dot-dot components are resolved")

check(!allows(dir.appendingPathComponent("other.html")), "another file is cancelled")
check(!allows(URL(string: "https://example.com/quick%20look.html")!), "a web URL is cancelled")
check(!allows(nil), "no URL is cancelled")
check(!PreviewText.allowsNavigation(to: page, page: nil, isLinkClick: false), "no page allows nothing")

if failures > 0 {
    print("\(failures) failure(s)")
    exit(1)
}
print("quicklook tests: all passed")
