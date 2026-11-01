//go:build darwin

package main

// The gate for building the PDF outline on pdfcpu (plan
// docs/superpowers/plans/2026-11-01-pdf-outline.md, Task 1): it writes
// nested bookmarks and the standard properties, keeps what WebKit
// produced, and is quick enough on a long document. The fixtures were
// rendered by WKWebView through NSPrintOperation, as Export PDF… does.

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// rewriteWithPdfcpu is the single pass the outline step will make: read,
// add bookmarks and properties, set DisplayDocTitle, write.
func rewriteWithPdfcpu(t *testing.T, in string, bms []pdfcpu.Bookmark, props map[string]string) string {
	t.Helper()
	c := context.Background()
	f, err := os.Open(in)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	ctx, err := api.ReadValidateAndOptimize(c, f, model.NewDefaultConfiguration(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(bms) > 0 {
		if err := pdfcpu.AddBookmarks(c, ctx, bms, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := pdfcpu.PropertiesAdd(c, ctx, props); err != nil {
		t.Fatal(err)
	}
	vp := model.ViewerPreferences{}
	vp.SetDisplayDocTitle(true)
	ctx.ViewerPref = &vp
	ctx.BindViewerPreferences()
	var buf bytes.Buffer
	if err := api.WriteContext(c, ctx, &buf); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "out.pdf")
	if err := os.WriteFile(out, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return out
}

var checkBookmarks = []pdfcpu.Bookmark{
	{Title: "Chapter 1 Results", PageFrom: 2, Kids: []pdfcpu.Bookmark{
		{Title: "Method 1", PageFrom: 2},
		{Title: "Detail 1", PageFrom: 3},
	}},
	{Title: "Chapter 2 Results", PageFrom: 3},
}

func TestPdfcpuWritesNestedBookmarks(t *testing.T) {
	out := rewriteWithPdfcpu(t, "testdata/webkit-export.pdf", checkBookmarks, map[string]string{"Creator": "Halmos Editor"})
	f, err := os.Open(out)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, err := api.Bookmarks(context.Background(), f, nil)
	if err != nil {
		t.Fatal(err)
	}
	type node struct {
		Title string
		Page  int
		Kids  []node
	}
	var flatten func([]pdfcpu.Bookmark) []node
	flatten = func(bs []pdfcpu.Bookmark) []node {
		var ns []node
		for _, b := range bs {
			ns = append(ns, node{b.Title, b.PageFrom, flatten(b.Kids)})
		}
		return ns
	}
	if g, w := flatten(got), flatten(checkBookmarks); !reflect.DeepEqual(g, w) {
		t.Fatalf("bookmarks\n got %+v\nwant %+v", g, w)
	}
}

func TestPdfcpuWritesTitleAuthorCreator(t *testing.T) {
	out := rewriteWithPdfcpu(t, "testdata/webkit-export.pdf", nil, map[string]string{
		"Title": "A Thesis on Results", "Author": "Ada Lovelace, Charles Babbage", "Creator": "Halmos Editor",
	})
	for key, want := range map[string]string{"Title": "A Thesis on Results", "Author": "Ada Lovelace, Charles Babbage", "Creator": "Halmos Editor"} {
		if got := info(t, out, key); got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
	ctx := readContext(t, out)
	if ctx.ViewerPref == nil || ctx.ViewerPref.DisplayDocTitle == nil || !*ctx.ViewerPref.DisplayDocTitle {
		t.Error("DisplayDocTitle not set")
	}
}

func TestPdfcpuKeepsLinksAndText(t *testing.T) {
	in := "testdata/webkit-export.pdf"
	out := rewriteWithPdfcpu(t, in, checkBookmarks, map[string]string{"Title": "T", "Creator": "Halmos Editor"})
	before, after := linksPerPage(t, in), linksPerPage(t, out)
	if !reflect.DeepEqual(before, after) {
		t.Errorf("links per page: before %v, after %v", before, after)
	}
	total := 0
	for _, n := range before {
		total += n
	}
	if total == 0 {
		t.Fatal("the fixture has no links; it cannot show they are kept")
	}
	if b, a := pdfPageTexts(in), pdfPageTexts(out); !reflect.DeepEqual(b, a) || len(b) == 0 {
		t.Errorf("page text changed or empty: %d pages before, %d after", len(b), len(a))
	}
}

func TestPdfcpuSizeAndTime200Pages(t *testing.T) {
	in := "testdata/webkit-export-200.pdf"
	pages := readContext(t, in).PageCount
	if pages < 150 {
		t.Fatalf("fixture has %d pages; want about 200", pages)
	}
	var bms []pdfcpu.Bookmark
	for p := 1; p <= pages; p += 2 {
		bms = append(bms, pdfcpu.Bookmark{Title: "Heading", PageFrom: p, Kids: []pdfcpu.Bookmark{{Title: "Sub", PageFrom: p}}})
	}
	start := time.Now()
	out := rewriteWithPdfcpu(t, in, bms, map[string]string{"Title": "T", "Author": "A", "Creator": "Halmos Editor"})
	took := time.Since(start)
	si, _ := os.Stat(in)
	so, _ := os.Stat(out)
	limit := max(si.Size()/10, 1<<20)
	t.Logf("%d pages: %d -> %d bytes in %s", pages, si.Size(), so.Size(), took)
	if so.Size()-si.Size() > limit {
		t.Errorf("grew by %d bytes, limit %d", so.Size()-si.Size(), limit)
	}
	if took > 2*time.Second {
		t.Errorf("took %s, limit 2s", took)
	}
}
