//go:build darwin

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFurnitureTextFillsPlaceholdersInOnePass(t *testing.T) {
	cases := []struct{ tmpl, title, want string }{
		{"Page {page} of {pages}", "T", "Page 3 of 9"},
		{"{title} — {date}", "On Mirrors", "On Mirrors — 23 October 2026"},
		// A title is inserted as it is, never read for placeholders.
		{"{title}", "About {page}", "About {page}"},
		{"{author} {page}", "T", "{author} 3"},
		{"{page", "T", "{page"},
		{"{{page}}", "T", "{3}"},
		{"", "T", ""},
	}
	for _, c := range cases {
		if got := furnitureText(c.tmpl, c.title, "23 October 2026", 3, 9); got != c.want {
			t.Errorf("furnitureText(%q, %q) = %q, want %q", c.tmpl, c.title, got, c.want)
		}
	}
}

func TestStampPDFDrawsHeaderAndFooterOnEveryPage(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "in.pdf")
	out := filepath.Join(dir, "out.pdf")
	writeTestPDF(t, in, 3)

	f := PageFurniture{Header: "{title} {date}", Footer: "Page {page} of {pages}", Title: "Running Head"}
	if !stampPDF(in, out, f, "23 October 2026", "new-york") {
		t.Fatal("stampPDF failed")
	}
	pages := pdfPageTexts(out)
	if len(pages) != 3 {
		t.Fatalf("got %d pages, want 3", len(pages))
	}
	for i, text := range pages {
		for _, want := range []string{"BODY", "Running Head 23 October 2026", fmt.Sprintf("Page %d of 3", i+1)} {
			if !strings.Contains(text, want) {
				t.Errorf("page %d: %q missing from %q", i+1, want, text)
			}
		}
	}
}

func TestStampPDFWithOnlyAFooter(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "in.pdf")
	out := filepath.Join(dir, "out.pdf")
	writeTestPDF(t, in, 1)
	if !stampPDF(in, out, PageFurniture{Footer: "{page}/{pages}"}, "", "unknown-font") {
		t.Fatal("stampPDF failed")
	}
	if got := pdfPageTexts(out); len(got) != 1 || !strings.Contains(got[0], "1/1") {
		t.Fatalf("got %q", got)
	}
}

func TestStampPDFFailsOnAFileThatIsNotAPDF(t *testing.T) {
	dir := t.TempDir()
	in := filepath.Join(dir, "in.pdf")
	if err := os.WriteFile(in, []byte("not a pdf"), 0o644); err != nil {
		t.Fatal(err)
	}
	if stampPDF(in, filepath.Join(dir, "out.pdf"), PageFurniture{Footer: "x"}, "", "georgia") {
		t.Fatal("stampPDF succeeded on a file that is not a PDF")
	}
}

// writeTestPDF writes an A4 PDF of n pages, each reading "BODY".
func writeTestPDF(t *testing.T, path string, n int) {
	t.Helper()
	var objs []string
	kids := make([]string, n)
	for i := range n {
		kids[i] = fmt.Sprintf("%d 0 R", 4+2*i)
	}
	objs = append(objs,
		"<< /Type /Catalog /Pages 2 0 R >>",
		fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), n),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	)
	stream := "BT /F1 24 Tf 72 400 Td (BODY) Tj ET"
	for i := range n {
		objs = append(objs,
			fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>", 5+2*i),
			fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream),
		)
	}
	var b strings.Builder
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objs))
	for i, o := range objs {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, o)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objs)+1)
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objs)+1, xref)
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}
