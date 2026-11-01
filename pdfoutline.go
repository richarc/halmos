package main

// The exported PDF's outline: which page each heading landed on, read from
// the text of the rendered pages, and the bookmark tree built from the
// headings. Platform-independent, so the Windows version can reuse it;
// only reading the pages' text is platform code (pdfPageTexts on macOS).
// See docs/superpowers/specs/2026-11-01-pdf-outline-design.md.

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"unicode"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// PDFHeading is one heading of the document, sent by the frontend with the
// export. Text is what the bookmark shows (the sidebar outline's text);
// Match is what can be found in the PDF's text: the same heading with each
// piece of maths replaced by a NUL, since KaTeX prints maths as something
// other than its source. Gaps holds each piece's source length, which
// bounds how much printed text may stand in for it. A Match with no words
// cannot be found.
type PDFHeading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	Match string `json:"match"`
	Gaps  []int  `json:"gaps"`
}

// PDFOutline is what Export PDF… adds to the rendered PDF: the bookmarks,
// and the Title and Author properties. Contents says the document renders
// a contents list, whose entries repeat the headings' text.
type PDFOutline struct {
	Headings []PDFHeading `json:"headings"`
	Title    string       `json:"title"`
	Authors  []string     `json:"authors"`
	Contents bool         `json:"contents"`
}

type outlineNode struct {
	Title string
	Page  int
	Kids  []outlineNode
}

var ligatures = strings.NewReplacer("ﬀ", "ff", "ﬁ", "fi", "ﬂ", "fl", "ﬃ", "ffi", "ﬄ", "ffl", "­", "")

// skeleton is s as compared with the PDF's text: lower case, ligatures
// expanded, and every space and hyphen dropped. Dropping them is what lets
// a heading WebKit wrapped over two lines, or broke with a hyphen at the
// end of a line, compare equal to the heading's text.
func skeleton(s string) string {
	s = ligatures.Replace(strings.ToLower(s))
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || r == '-' || r == '‐' || r == '‑' {
			return -1
		}
		return r
	}, s)
}

// pattern is a heading as compared with whole lines of a page: the
// skeletons of its words, with a bounded gap between two of them wherever a
// piece of maths was.
type pattern struct {
	segs   []string
	maxGap []int
}

func patternOf(hd PDFHeading) pattern {
	parts := strings.Split(hd.Match, "\x00")
	p := pattern{}
	for i, part := range parts {
		p.segs = append(p.segs, skeleton(part))
		if i > 0 {
			n := 0
			if i-1 < len(hd.Gaps) {
				n = hd.Gaps[i-1]
			}
			// Printed maths is rarely longer than its source; the slack is
			// for symbols KaTeX spells out.
			p.maxGap = append(p.maxGap, max(4, 2*n))
		}
	}
	return p
}

// empty reports a pattern with no words to look for.
func (p pattern) empty() bool {
	for _, s := range p.segs {
		if s != "" {
			return false
		}
	}
	return true
}

// matches reports whether acc, the concatenated skeletons of a run of
// lines, reads as the whole pattern.
func (p pattern) matches(acc string) bool {
	var at func(i, pos int) bool
	at = func(i, pos int) bool {
		if !strings.HasPrefix(acc[pos:], p.segs[i]) {
			return false
		}
		pos += len(p.segs[i])
		if i == len(p.segs)-1 {
			return pos == len(acc)
		}
		for gap := 1; gap <= p.maxGap[i] && pos+gap <= len(acc); gap++ {
			if at(i+1, pos+gap) {
				return true
			}
		}
		return false
	}
	return at(0, 0)
}

// mayContinue reports whether more lines could still complete a match:
// acc is no longer than the longest text the pattern can read as, and
// starts with its first words.
func (p pattern) mayContinue(acc string) bool {
	longest := 0
	for _, s := range p.segs {
		longest += len(s)
	}
	for _, g := range p.maxGap {
		longest += g
	}
	first := p.segs[0]
	if len(acc) < len(first) {
		return strings.HasPrefix(first, acc)
	}
	return strings.HasPrefix(acc, first) && len(acc) < longest
}

// runAt returns how many lines from line l of a page read as the pattern,
// or 0. Headings wrap over a few lines at most.
func (p pattern) runAt(page []string, skipped func(int) bool, l int) int {
	if page[l] == "" || skipped(l) {
		return 0
	}
	acc := ""
	for k := l; k < len(page) && k < l+6 && !skipped(k); k++ {
		acc += page[k]
		if p.matches(acc) {
			return k - l + 1
		}
		if !p.mayContinue(acc) {
			return 0
		}
	}
	return 0
}

// assignPages returns the 1-based page each heading is on, in order.
//
// A heading is found where whole lines of a page read as its text (one
// line, or several when it wrapped), never as words inside a line, so a
// mention in body text does not count. The search starts where the
// previous heading was found and only moves forward, so two headings with
// the same text land on their own pages and no bookmark goes backwards.
// With contents set, the entries of the contents list are skipped. A
// heading that cannot be found takes the previous heading's page.
func assignPages(headings []PDFHeading, pageTexts []string, contents bool) []int {
	lines := make([][]string, len(pageTexts))
	for p, text := range pageTexts {
		for _, l := range strings.Split(text, "\n") {
			lines[p] = append(lines[p], skeleton(l))
		}
	}
	pats := make([]pattern, len(headings))
	for i, hd := range headings {
		pats[i] = patternOf(hd)
	}
	skipped := map[[2]int]bool{}
	if contents {
		skipContentsList(lines, pats, skipped)
	}

	pages := make([]int, len(headings))
	page, line, last := 0, 0, 1
	for i, pat := range pats {
		pages[i] = last
		if pat.empty() {
			continue
		}
		if p, next, ok := findRun(lines, skipped, pat, page, line); ok {
			pages[i] = p + 1
			last = p + 1
			page, line = p, next
		}
	}
	return pages
}

// findRun looks from (page, line) on for lines that read as pat; it
// returns the page and the line after them.
func findRun(lines [][]string, skipped map[[2]int]bool, pat pattern, page, line int) (int, int, bool) {
	for p := page; p < len(lines); p++ {
		start := 0
		if p == page {
			start = line
		}
		isSkipped := func(l int) bool { return skipped[[2]int{p, l}] }
		for l := start; l < len(lines[p]); l++ {
			if n := pat.runAt(lines[p], isSkipped, l); n > 0 {
				return p, l + n, true
			}
		}
	}
	return 0, 0, false
}

// skipContentsList marks the contents list's entries. The list starts after
// the first line reading "Contents" (the title lib/toc.ts gives it) and
// names headings in document order, perhaps not all of them (toc-depth):
// each entry is the next line run that reads as a heading after the one
// the previous entry named. The first run that does not is where the list
// ends, so a heading straight after the list (which comes earlier in the
// document than the list's last entry) is not taken for an entry.
func skipContentsList(lines [][]string, pats []pattern, skipped map[[2]int]bool) {
	for p := range lines {
		for l, s := range lines[p] {
			if s != "contents" {
				continue
			}
			next := 0
			q, m := p, l+1
			for q < len(lines) {
				if m >= len(lines[q]) {
					q, m = q+1, 0
					continue
				}
				if lines[q][m] == "" {
					m++
					continue
				}
				n, j := 0, next
				for ; j < len(pats); j++ {
					if !pats[j].empty() {
						if n = pats[j].runAt(lines[q], func(int) bool { return false }, m); n > 0 {
							break
						}
					}
				}
				if n == 0 {
					return
				}
				for k := m; k < m+n; k++ {
					skipped[[2]int{q, k}] = true
				}
				m += n
				next = j + 1
			}
			return
		}
	}
}

// nestOutline builds the bookmark tree: each heading is a child of the
// nearest heading before it with a lower level, so a skipped level (a
// level 3 straight under a level 1) still nests.
func nestOutline(headings []PDFHeading, pages []int) []outlineNode {
	if len(headings) == 0 {
		return nil
	}
	var build func(i int, level int) ([]outlineNode, int)
	build = func(i int, level int) ([]outlineNode, int) {
		var nodes []outlineNode
		for i < len(headings) && headings[i].Level > level {
			n := outlineNode{Title: headings[i].Text, Page: pages[i]}
			kids, next := build(i+1, headings[i].Level)
			n.Kids = kids
			nodes = append(nodes, n)
			i = next
		}
		return nodes, i
	}
	roots, _ := build(0, 0)
	return roots
}

// pdfCreator is the Creator property of every exported PDF, so a
// submission system can tell where the file came from.
const pdfCreator = "Halmos Editor"

// writeOutline writes out from the PDF in, with the bookmarks in nodes
// (none when it is empty), Title and DisplayDocTitle when o has a title,
// Author when it has authors, and Creator always. One read and one write,
// so WebKit's links and text are kept as they are.
func writeOutline(in, out string, nodes []outlineNode, o PDFOutline) error {
	c := context.Background()
	f, err := os.Open(in)
	if err != nil {
		return err
	}
	defer f.Close()
	ctx, err := api.ReadValidateAndOptimize(c, f, model.NewDefaultConfiguration(), nil)
	if err != nil {
		return fmt.Errorf("read the PDF: %w", err)
	}
	if len(nodes) > 0 {
		if err := pdfcpu.AddBookmarks(c, ctx, toBookmarks(nodes), true); err != nil {
			return fmt.Errorf("add the bookmarks: %w", err)
		}
	}
	props := map[string]string{"Creator": pdfCreator}
	if o.Title != "" {
		props["Title"] = o.Title
	}
	if len(o.Authors) > 0 {
		props["Author"] = strings.Join(o.Authors, ", ")
	}
	if err := pdfcpu.PropertiesAdd(c, ctx, props); err != nil {
		return fmt.Errorf("set the properties: %w", err)
	}
	if o.Title != "" {
		vp := model.ViewerPreferences{}
		vp.SetDisplayDocTitle(true)
		ctx.ViewerPref = &vp
		ctx.BindViewerPreferences()
	}
	var buf bytes.Buffer
	if err := api.WriteContext(c, ctx, &buf); err != nil {
		return fmt.Errorf("write the PDF: %w", err)
	}
	return os.WriteFile(out, buf.Bytes(), 0o644)
}

func toBookmarks(nodes []outlineNode) []pdfcpu.Bookmark {
	bms := make([]pdfcpu.Bookmark, len(nodes))
	for i, n := range nodes {
		bms[i] = pdfcpu.Bookmark{Title: n.Title, PageFrom: n.Page, Kids: toBookmarks(n.Kids)}
	}
	return bms
}
