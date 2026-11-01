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
// Match is the same heading with maths, code and markup left out, which is
// what can be found in the PDF's text. An empty Match cannot be found.
type PDFHeading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	Match string `json:"match"`
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

// assignPages returns the 1-based page each heading is on, in order.
//
// A heading is found where whole lines of a page read as its text (one
// line, or several when it wrapped), never as words inside a line, so a
// mention in body text does not count. The search starts where the
// previous heading was found and only moves forward, so two headings with
// the same text land on their own pages and no bookmark goes backwards.
// With contents set, the entries of the contents list (the lines after its
// "Contents" title that are part of a heading's text) are skipped. A
// heading that cannot be found takes the previous heading's page.
func assignPages(headings []PDFHeading, pageTexts []string, contents bool) []int {
	lines := make([][]string, len(pageTexts))
	for p, text := range pageTexts {
		for _, l := range strings.Split(text, "\n") {
			lines[p] = append(lines[p], skeleton(l))
		}
	}
	targets := make([]string, len(headings))
	for i, hd := range headings {
		targets[i] = skeleton(hd.Match)
	}
	skipped := map[[2]int]bool{}
	if contents {
		skipContentsList(lines, targets, skipped)
	}

	pages := make([]int, len(headings))
	page, line, last := 0, 0, 1
	for i, target := range targets {
		pages[i] = last
		if target == "" {
			continue
		}
		if p, next, ok := findLines(lines, skipped, target, page, line); ok {
			pages[i] = p + 1
			last = p + 1
			page, line = p, next
		}
	}
	return pages
}

// findLines looks from (page, line) on for consecutive lines of one page
// that together read as target; it returns the page and the line after
// them.
func findLines(lines [][]string, skipped map[[2]int]bool, target string, page, line int) (int, int, bool) {
	for p := page; p < len(lines); p++ {
		start := 0
		if p == page {
			start = line
		}
		for l := start; l < len(lines[p]); l++ {
			if skipped[[2]int{p, l}] || lines[p][l] == "" {
				continue
			}
			acc := ""
			for k := l; k < len(lines[p]) && !skipped[[2]int{p, k}]; k++ {
				acc += lines[p][k]
				if acc == target {
					return p, k + 1, true
				}
				if !strings.HasPrefix(target, acc) {
					break
				}
			}
		}
	}
	return 0, 0, false
}

// skipContentsList marks the contents list's entries: the lines after the
// first line reading "Contents" (the title lib/toc.ts gives the list) that
// are each part of some heading's text.
func skipContentsList(lines [][]string, targets []string, skipped map[[2]int]bool) {
	partOfAHeading := func(s string) bool {
		if s == "" {
			return false
		}
		for _, t := range targets {
			if t != "" && strings.Contains(t, s) {
				return true
			}
		}
		return false
	}
	for p := range lines {
		for l, s := range lines[p] {
			if s != "contents" {
				continue
			}
			// The list may run onto the next pages.
			for q, m := p, l+1; q < len(lines); q, m = q+1, 0 {
				for ; m < len(lines[q]); m++ {
					if !partOfAHeading(lines[q][m]) {
						return
					}
					skipped[[2]int{q, m}] = true
				}
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
