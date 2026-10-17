package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPastedImageNameUsesTimestamp(t *testing.T) {
	now := time.Date(2026, 10, 17, 14, 3, 5, 0, time.UTC)
	got := pastedImageName(now, "png", func(string) bool { return false })
	if got != "pasted-20261017-140305.png" {
		t.Errorf("got %q", got)
	}
}

func TestPastedImageNameSuffixesOnCollision(t *testing.T) {
	now := time.Date(2026, 10, 17, 14, 3, 5, 0, time.UTC)
	taken := map[string]bool{
		"pasted-20261017-140305.png":   true,
		"pasted-20261017-140305-2.png": true,
	}
	got := pastedImageName(now, "png", func(n string) bool { return taken[n] })
	if got != "pasted-20261017-140305-3.png" {
		t.Errorf("got %q", got)
	}
}

func TestSavePastedImageWritesBesideDocument(t *testing.T) {
	s := newTestService(t)
	dir := t.TempDir()
	doc := filepath.Join(dir, "paper.md")
	data := []byte{0x89, 'P', 'N', 'G', 1, 2, 3}

	rel, err := s.SavePastedImage(doc, data, "png")
	if err != nil {
		t.Fatalf("SavePastedImage: %v", err)
	}
	if filepath.ToSlash(filepath.Dir(rel)) != "images" || filepath.Ext(rel) != ".png" || rel[:len("images/pasted-")] != "images/pasted-" {
		t.Errorf("rel = %q", rel)
	}
	got, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, data) {
		t.Errorf("bytes differ")
	}
}

func TestSavePastedImageRefusesUntitled(t *testing.T) {
	s := newTestService(t)
	if _, err := s.SavePastedImage("", []byte{1}, "png"); err == nil {
		t.Fatal("expected error for untitled document")
	}
}

func TestSavePastedImageRejectsUnknownExtension(t *testing.T) {
	s := newTestService(t)
	dir := t.TempDir()
	if _, err := s.SavePastedImage(filepath.Join(dir, "paper.md"), []byte{1}, "svg"); err == nil {
		t.Fatal("expected error for svg")
	}
	if _, err := os.Stat(filepath.Join(dir, "images")); err == nil {
		t.Error("images dir created despite rejection")
	}
}
