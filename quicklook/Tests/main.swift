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
let dir = fm.temporaryDirectory.appendingPathComponent("halmos-ql-tests-\(getpid())", isDirectory: true)
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

// MARK: recognising the page

let page = write("quick look.html", Array("<p>".utf8))

check(PreviewText.isSamePage(page, page), "a URL is its own page")

let encoded = URL(string: "file://" + page.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!)!
check(PreviewText.isSamePage(encoded, page), "percent-encoding is ignored: \(encoded.absoluteString)")

var fragment = URLComponents(url: page, resolvingAgainstBaseURL: false)!
fragment.fragment = "section-2"
check(PreviewText.isSamePage(fragment.url!, page), "a fragment on the page is the page")

// temporaryDirectory is under /var, a symlink to /private/var; WebKit can
// report either spelling.
if page.path.hasPrefix("/var/") {
    let privateSpelling = URL(fileURLWithPath: "/private" + page.path)
    check(PreviewText.isSamePage(privateSpelling, page), "a /private prefix is the same file")
    check(PreviewText.isSamePage(page, privateSpelling), "and the other way round")
} else {
    check(false, "expected the temporary directory under /var, got \(page.path)")
}

let dotted = dir.appendingPathComponent("sub/../quick look.html")
check(PreviewText.isSamePage(dotted, page), "dot-dot components are resolved")

check(!PreviewText.isSamePage(dir.appendingPathComponent("other.html"), page), "another file is not the page")
check(!PreviewText.isSamePage(URL(string: "https://example.com/quick%20look.html")!, page), "a web URL is not the page")
check(!PreviewText.isSamePage(nil, page), "no URL is not the page")
check(!PreviewText.isSamePage(page, nil), "no page matches nothing")

if failures > 0 {
    print("\(failures) failure(s)")
    exit(1)
}
print("quicklook tests: all passed")
