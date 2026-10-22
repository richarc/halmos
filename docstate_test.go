package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// openTracked writes content to a fresh file and opens it, so the service
// tracks it the way it tracks a document the author opened.
func openTracked(t *testing.T, content string) (*DocumentService, string) {
	t.Helper()
	s := newTestService(t)
	path := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.OpenPath(path); err != nil {
		t.Fatalf("OpenPath: %v", err)
	}
	return s, path
}

func fileText(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestContentVersionIsHexSHA256(t *testing.T) {
	const want = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if got := contentVersion([]byte("abc")); got != want {
		t.Errorf("contentVersion(abc) = %q, want %q", got, want)
	}
}

func TestSaveRefusesWhenDiskChanged(t *testing.T) {
	s, path := openTracked(t, "one")
	if err := os.WriteFile(path, []byte("two"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := s.Save(path, "mine", false)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if res != (SaveResult{Conflict: true}) {
		t.Errorf("Save = %+v, want a conflict", res)
	}
	if got := fileText(t, path); got != "two" {
		t.Errorf("file holds %q, want the other program's %q", got, "two")
	}
}

func TestSaveOverwriteWritesAnyway(t *testing.T) {
	s, path := openTracked(t, "one")
	if err := os.WriteFile(path, []byte("two"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := s.Save(path, "mine", true)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if res.Conflict {
		t.Error("overwrite reported a conflict")
	}
	if got := fileText(t, path); got != "mine" {
		t.Errorf("file holds %q, want %q", got, "mine")
	}
}

func TestSaveAfterOwnSaveIsNotConflict(t *testing.T) {
	s, path := openTracked(t, "one")
	for _, text := range []string{"a", "b"} {
		res, err := s.Save(path, text, false)
		if err != nil {
			t.Fatalf("Save(%q): %v", text, err)
		}
		if res.Conflict {
			t.Errorf("Save(%q) conflicted with our own previous save", text)
		}
	}
	if got := fileText(t, path); got != "b" {
		t.Errorf("file holds %q, want %q", got, "b")
	}
}

func TestSaveRecreatesMissingFile(t *testing.T) {
	s, path := openTracked(t, "one")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	res, err := s.Save(path, "x", false)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if res.Conflict {
		t.Error("a deleted file was reported as a conflict")
	}
	if got := fileText(t, path); got != "x" {
		t.Errorf("file holds %q, want %q", got, "x")
	}
}

func TestSaveIgnoresTouch(t *testing.T) {
	s, path := openTracked(t, "one")
	future := time.Now().Add(time.Hour)
	if err := os.Chtimes(path, future, future); err != nil {
		t.Fatal(err)
	}
	res, err := s.Save(path, "x", false)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if res.Conflict {
		t.Error("a touch with unchanged bytes was reported as a conflict")
	}
}

func TestAcceptDiskVersionOnlyAcceptsSeen(t *testing.T) {
	s, path := openTracked(t, "one")
	s.AcceptDiskVersion("deadbeef")
	if err := os.WriteFile(path, []byte("two"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := s.Save(path, "mine", false)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if !res.Conflict {
		t.Error("an unseen version was accepted as the base")
	}

	// The version the watcher last saw is accepted: Task 2's watcher sets
	// seen, which is simulated here.
	two := contentVersion([]byte("two"))
	s.docMu.Lock()
	s.doc.seen = two
	s.docMu.Unlock()
	s.AcceptDiskVersion(two)
	res, err = s.Save(path, "mine", false)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if res.Conflict {
		t.Error("the accepted disk version still conflicted")
	}
}

func TestSaveUntrackedPathDoesNotCheck(t *testing.T) {
	s := newTestService(t)
	path := filepath.Join(t.TempDir(), "other.md")
	if err := os.WriteFile(path, []byte("existing"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := s.Save(path, "new", false)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if res.Conflict {
		t.Error("a path never opened was checked")
	}
	if got := fileText(t, path); got != "new" {
		t.Errorf("file holds %q, want %q", got, "new")
	}
}
