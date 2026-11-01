package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// copyFixture puts a copy of the WebKit fixture in dir, as the render's
// temporary file would be.
func copyFixture(t *testing.T, dir, name string) string {
	t.Helper()
	data, err := os.ReadFile("testdata/webkit-export.pdf")
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func fixturePageTexts(string) []string {
	return []string{"Contents\nChapter 1 Results\nChapter 1 Results\nbody", "body\nMethod 1\nbody", "body"}
}

var fixtureOutline = PDFOutline{
	Headings: []PDFHeading{h(1, "Chapter 1 Results"), h(2, "Method 1")},
	Title:    "A Thesis",
	Authors:  []string{"Ada Lovelace"},
	Contents: true,
}

func gone(t *testing.T, paths ...string) {
	t.Helper()
	for _, p := range paths {
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s was left behind", p)
		}
	}
}

func TestFinishExportWritesTheOutline(t *testing.T) {
	tmp, out := t.TempDir(), t.TempDir()
	rendered := copyFixture(t, tmp, "rendered.pdf")
	dest := filepath.Join(out, "Paper.pdf")
	if err := finishExport(rendered, "", dest, fixtureOutline, fixturePageTexts); err != nil {
		t.Fatal(err)
	}
	want := []outlineNode{{Title: "Chapter 1 Results", Page: 1, Kids: []outlineNode{{Title: "Method 1", Page: 2}}}}
	if got := bookmarksOf(t, dest); len(got) != 1 || got[0].Title != want[0].Title || len(got[0].Kids) != 1 || got[0].Kids[0].Page != 2 {
		t.Errorf("bookmarks %+v, want %+v", got, want)
	}
	if got := info(t, dest, "Title"); got != "A Thesis" {
		t.Errorf("Title = %q", got)
	}
	gone(t, rendered)
	if entries, _ := os.ReadDir(out); len(entries) != 1 {
		t.Errorf("dest folder holds %d files, want only Paper.pdf", len(entries))
	}
}

func TestFinishExportUsesTheStampedPDF(t *testing.T) {
	tmp, out := t.TempDir(), t.TempDir()
	rendered := copyFixture(t, tmp, "rendered.pdf")
	stamped := copyFixture(t, tmp, "stamped.pdf")
	var readFrom string
	dest := filepath.Join(out, "Paper.pdf")
	if err := finishExport(rendered, stamped, dest, fixtureOutline, func(p string) []string {
		readFrom = p
		return fixturePageTexts(p)
	}); err != nil {
		t.Fatal(err)
	}
	if readFrom != rendered {
		t.Errorf("page text read from %s, want the unstamped %s", readFrom, rendered)
	}
	gone(t, rendered, stamped)
}

func TestFinishExportFallsBackToTheStampedPDF(t *testing.T) {
	tmp, out := t.TempDir(), t.TempDir()
	rendered := copyFixture(t, tmp, "rendered.pdf")
	// Not a PDF pdfcpu can read: the outline step fails, and the user gets
	// this file as it is.
	stamped := filepath.Join(tmp, "stamped.pdf")
	junk := []byte("%PDF-1.4 not really")
	if err := os.WriteFile(stamped, junk, 0o644); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(out, "Paper.pdf")
	if err := finishExport(rendered, stamped, dest, fixtureOutline, fixturePageTexts); err != nil {
		t.Fatalf("the fallback should succeed: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil || !bytes.Equal(got, junk) {
		t.Fatalf("dest is not the stamped PDF: %v", err)
	}
	gone(t, rendered, stamped)
}

func TestFinishExportReplacesAnExistingFile(t *testing.T) {
	tmp, out := t.TempDir(), t.TempDir()
	dest := filepath.Join(out, "Paper.pdf")
	if err := os.WriteFile(dest, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := finishExport(copyFixture(t, tmp, "rendered.pdf"), "", dest, fixtureOutline, fixturePageTexts); err != nil {
		t.Fatal(err)
	}
	if got := bookmarksOf(t, dest); len(got) == 0 {
		t.Error("the old file was not replaced")
	}
}

func TestFinishExportReportsAnUnwritableFolder(t *testing.T) {
	if runtime.GOOS == "windows" || os.Getuid() == 0 {
		t.Skip("folder permissions do not apply")
	}
	tmp, out := t.TempDir(), t.TempDir()
	rendered := copyFixture(t, tmp, "rendered.pdf")
	if err := os.Chmod(out, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(out, 0o755) })
	if err := finishExport(rendered, "", filepath.Join(out, "Paper.pdf"), fixtureOutline, fixturePageTexts); err == nil {
		t.Fatal("want an error when the PDF cannot be written")
	}
	gone(t, rendered)
}

func TestPendingExportsHandOutEachOutlineOnce(t *testing.T) {
	a := pending.add(PDFOutline{Title: "A"})
	b := pending.add(PDFOutline{Title: "B"})
	if a == b {
		t.Fatal("two exports share an id")
	}
	if o, ok := pending.take(b); !ok || o.Title != "B" {
		t.Fatalf("take(b) = %+v, %v", o, ok)
	}
	if _, ok := pending.take(b); ok {
		t.Fatal("an outline was handed out twice")
	}
	pending.take(a)
}

func TestFinishExportLeavesTheFileReadableByOthers(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no Unix permissions")
	}
	tmp, out := t.TempDir(), t.TempDir()
	dest := filepath.Join(out, "Paper.pdf")
	if err := finishExport(copyFixture(t, tmp, "rendered.pdf"), "", dest, fixtureOutline, fixturePageTexts); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(dest)
	if err != nil {
		t.Fatal(err)
	}
	// What NSPrintOperation wrote before: 0644 under the usual umask.
	if fi.Mode().Perm()&0o044 != 0o044 {
		t.Fatalf("mode %v: group and others cannot read it", fi.Mode().Perm())
	}
}
