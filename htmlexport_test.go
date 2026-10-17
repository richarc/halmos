package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadImageDataURIEncodesBesideDocument(t *testing.T) {
	dir := t.TempDir()
	png := []byte("\x89PNG\r\n\x1a\nfake")
	if err := os.MkdirAll(filepath.Join(dir, "images"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "images", "fig.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}
	doc := filepath.Join(dir, "paper.md")

	got, err := (&DocumentService{}).ReadImageDataURI(doc, "images/fig.png")
	if err != nil {
		t.Fatal(err)
	}
	want := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}

	// An absolute source stands, as it does for the image route.
	abs, err := (&DocumentService{}).ReadImageDataURI("", filepath.Join(dir, "images", "fig.png"))
	if err != nil || abs != want {
		t.Fatalf("absolute source: got %q, %v", abs, err)
	}

	// The extension is matched case-insensitively and picks the type.
	if err := os.WriteFile(filepath.Join(dir, "Photo.JPG"), []byte("jpeg"), 0o644); err != nil {
		t.Fatal(err)
	}
	jpg, err := (&DocumentService{}).ReadImageDataURI(doc, "Photo.JPG")
	if err != nil || !strings.HasPrefix(jpg, "data:image/jpeg;base64,") {
		t.Fatalf("jpeg: got %q, %v", jpg, err)
	}
}

func TestReadImageDataURIRejectsNonImage(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "secrets.txt"), []byte("hunter2"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "paper"), 0o755); err != nil {
		t.Fatal(err)
	}
	doc := filepath.Join(dir, "paper", "paper.md")
	s := &DocumentService{}

	if got, err := s.ReadImageDataURI(doc, "../secrets.txt"); err == nil {
		t.Fatalf("expected an error for a non-image, got %q", got)
	}
	if got, err := s.ReadImageDataURI(doc, "missing.png"); err == nil {
		t.Fatalf("expected an error for a missing image, got %q", got)
	}
	// A relative source with no document has nothing to resolve against.
	if got, err := s.ReadImageDataURI("", "fig.png"); err == nil {
		t.Fatalf("expected an error for an unsaved document, got %q", got)
	}
	if got, err := s.ReadImageDataURI(doc, ""); err == nil {
		t.Fatalf("expected an error for an empty source, got %q", got)
	}
}

func TestHTMLExportDefaultName(t *testing.T) {
	cases := map[string]string{
		"/a/paper.md":           "paper.html",
		"/a/notes.markdown":     "notes.html",
		"/a/My Thesis.final.md": "My Thesis.final.html",
		"":                      "Untitled.html",
	}
	for in, want := range cases {
		if got := htmlExportFilename(in); got != want {
			t.Errorf("htmlExportFilename(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestWriteHTMLExportWritesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "paper.html")
	if err := (&DocumentService{}).WriteHTMLExport(path, "<!doctype html>"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil || string(b) != "<!doctype html>" {
		t.Fatalf("got %q, %v", b, err)
	}
}
