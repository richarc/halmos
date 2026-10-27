package main

import (
	"strings"
	"unicode"
)

// PageFurniture is Export PDF's running header and footer: the frontmatter's
// `header` and `footer` templates as written, with the value for `{title}`.
// The export fills that, `{date}`, `{page}` and `{pages}` in, page by page, in
// one pass (hermesFurnitureText), so a title that contains "{page}" is printed
// as it is. Built by the frontend's lib/pageFurniture.ts.
type PageFurniture struct {
	Header string `json:"header"`
	Footer string `json:"footer"`
	Title  string `json:"title"`
	// SkipFirstPageHeader leaves the header off page 1, where the document's
	// title block already shows the title; the footer is still drawn there.
	SkipFirstPageHeader bool `json:"skipFirstPageHeader"`
}

// maxFurnitureRunes caps each field. A margin holds one line; anything longer
// is truncated on the page anyway, and a document is not trusted input.
const maxFurnitureRunes = 200

// normalised makes each field one line: runs of whitespace and control
// characters become one space, the ends are trimmed, and the length is capped.
func (f PageFurniture) normalised() PageFurniture {
	return PageFurniture{
		Header: oneLine(f.Header),
		Footer: oneLine(f.Footer),
		Title:  oneLine(f.Title),

		SkipFirstPageHeader: f.SkipFirstPageHeader,
	}
}

// empty reports whether there is nothing to draw, in which case the export
// writes WebKit's PDF unchanged.
func (f PageFurniture) empty() bool {
	return f.Header == "" && f.Footer == ""
}

func oneLine(s string) string {
	s = strings.Join(strings.FieldsFunc(s, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	}), " ")
	if r := []rune(s); len(r) > maxFurnitureRunes {
		s = string(r[:maxFurnitureRunes])
	}
	return s
}
