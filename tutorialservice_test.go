package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

func testTutorialService(t *testing.T, h http.HandlerFunc, version string, deadline time.Duration) (*TutorialService, string) {
	t.Helper()
	c, _ := testStyleClient(t, h)
	docs := t.TempDir()
	return newTutorialServiceWith(t.TempDir(), docs, c, version, deadline), docs
}

func TestNextTutorialFolder(t *testing.T) {
	parent := t.TempDir()
	if got := nextTutorialFolder(parent); got != filepath.Join(parent, "Halmos Tutorial") {
		t.Fatalf("empty: %s", got)
	}
	if err := os.WriteFile(filepath.Join(parent, "Halmos Tutorial"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if got := nextTutorialFolder(parent); got != filepath.Join(parent, "Halmos Tutorial 2") {
		t.Fatalf("taken by a file: %s", got)
	}
	if err := os.Mkdir(filepath.Join(parent, "Halmos Tutorial 2"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := nextTutorialFolder(parent); got != filepath.Join(parent, "Halmos Tutorial 3") {
		t.Fatalf("2 taken: %s", got)
	}
}

func sampleContent() *tutorialContent {
	return &tutorialContent{
		Revision: "abc123", Entry: "getting-started.md", Source: "online",
		Files: map[string][]byte{"getting-started.md": []byte("# Hi\n"), "images/palette.png": []byte("png")},
		Order: []string{"getting-started.md", "images/palette.png"},
	}
}

func TestWriteTutorialRefusesNonEmptyFolder(t *testing.T) {
	folder := t.TempDir()
	notes := filepath.Join(folder, "notes.md")
	if err := os.WriteFile(notes, []byte("mine"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeTutorial(folder, sampleContent(), time.Now()); err == nil {
		t.Fatal("wrote into a folder with files")
	}
	if b, _ := os.ReadFile(notes); string(b) != "mine" {
		t.Fatalf("notes.md changed: %q", b)
	}
	entries, _ := os.ReadDir(folder)
	if len(entries) != 1 {
		t.Fatalf("%d entries", len(entries))
	}
}

func TestWriteTutorialLayout(t *testing.T) {
	folder := filepath.Join(t.TempDir(), "Halmos Tutorial")
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	if err := writeTutorial(folder, sampleContent(), now); err != nil {
		t.Fatal(err)
	}
	var got []string
	_ = filepath.WalkDir(folder, func(p string, d fs.DirEntry, err error) error {
		rel, _ := filepath.Rel(folder, p)
		got = append(got, filepath.ToSlash(rel))
		return nil
	})
	sort.Strings(got)
	want := []string{".", ".halmos-tutorial.json", "getting-started.md", "images", "images/palette.png"}
	if len(got) != len(want) {
		t.Fatalf("tree %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("tree %v", got)
		}
	}
	var marker tutorialMarker
	b, _ := os.ReadFile(filepath.Join(folder, ".halmos-tutorial.json"))
	if err := json.Unmarshal(b, &marker); err != nil {
		t.Fatal(err)
	}
	if marker.Revision != "abc123" || marker.Source != "online" || marker.Entry != "getting-started.md" || marker.Created != "2026-10-29T12:00:00Z" {
		t.Fatalf("marker %+v", marker)
	}
}

func TestCreateTutorialOnline(t *testing.T) {
	m, files := goodTutorial()
	n := 0
	s, docs := testTutorialService(t, serveTutorial(t, m, files, &n), "0.16.0", time.Second)
	folder := filepath.Join(docs, "Halmos Tutorial")
	res, err := s.Create(folder)
	if err != nil {
		t.Fatal(err)
	}
	if res.Bundled || res.NeedsUpdate || res.Entry != filepath.Join(folder, "getting-started.md") {
		t.Fatalf("result %+v", res)
	}
	if b, _ := os.ReadFile(filepath.Join(folder, "images", "palette.png")); string(b) != string(files["images/palette.png"]) {
		t.Fatal("image not written")
	}
	st := s.State()
	if st.Existing != folder || st.ExistingEntry != res.Entry || st.Suggested != filepath.Join(docs, "Halmos Tutorial 2") {
		t.Fatalf("state %+v", st)
	}
}

func TestCreateTutorialFallsBack(t *testing.T) {
	newer, files := goodTutorial()
	newer.MinEditor = "99.0.0"
	broken, _ := goodTutorial()
	broken.Files[0].SHA256 = sha([]byte("other"))
	n := 0
	cases := map[string]struct {
		h           http.HandlerFunc
		needsUpdate bool
	}{
		"503": {func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":"unavailable"}`))
		}, false},
		"hash mismatch": {serveTutorial(t, broken, files, &n), false},
		"newer editor":  {serveTutorial(t, newer, files, &n), true},
	}
	for name, tc := range cases {
		s, docs := testTutorialService(t, tc.h, "0.16.0", time.Second)
		folder := filepath.Join(docs, "Halmos Tutorial")
		res, err := s.Create(folder)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !res.Bundled || res.NeedsUpdate != tc.needsUpdate {
			t.Errorf("%s: %+v", name, res)
		}
		if _, err := os.Stat(res.Entry); err != nil {
			t.Errorf("%s: entry %v", name, err)
		}
	}
}

func TestCreateTutorialDeadlineFallsBack(t *testing.T) {
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	s, docs := testTutorialService(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}, "0.16.0", 50*time.Millisecond)
	start := time.Now()
	res, err := s.Create(filepath.Join(docs, "Halmos Tutorial"))
	if err != nil || !res.Bundled {
		t.Fatalf("%+v %v", res, err)
	}
	if time.Since(start) > 5*time.Second {
		t.Fatalf("took %v", time.Since(start))
	}
}

func TestCreateTutorialWriteError(t *testing.T) {
	s, docs := testTutorialService(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }, "0.16.0", time.Second)
	folder := filepath.Join(docs, "taken")
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(folder, "x.md"), nil, 0o644)
	if _, err := s.Create(folder); err == nil {
		t.Fatal("no error for a folder with files")
	}
	if st := s.State(); st.Existing != "" {
		t.Fatalf("remembered a failed folder: %+v", st)
	}
}

func TestStateForgetsMissingFolder(t *testing.T) {
	m, files := goodTutorial()
	n := 0
	s, docs := testTutorialService(t, serveTutorial(t, m, files, &n), "0.16.0", time.Second)
	folder := filepath.Join(docs, "Halmos Tutorial")
	if _, err := s.Create(folder); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(folder); err != nil {
		t.Fatal(err)
	}
	if st := s.State(); st.Existing != "" || st.Suggested != folder {
		t.Fatalf("state %+v", st)
	}
}

func TestWriteTutorialCleansUpAfterAFailure(t *testing.T) {
	folder := filepath.Join(t.TempDir(), "Halmos Tutorial")
	calls := 0
	writeNewFileFn = func(path string, data []byte) error {
		calls++
		if calls == 2 {
			return errors.New("no space left on device")
		}
		return writeNewFile(path, data)
	}
	t.Cleanup(func() { writeNewFileFn = writeNewFile })
	if err := writeTutorial(folder, sampleContent(), time.Now()); err == nil {
		t.Fatal("no error")
	}
	if _, err := os.Stat(folder); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("folder left behind: %v", err)
	}

	// A folder the user chose that already existed (empty) is kept, emptied.
	existing := t.TempDir()
	calls = 0
	if err := writeTutorial(existing, sampleContent(), time.Now()); err == nil {
		t.Fatal("no error")
	}
	if entries, err := os.ReadDir(existing); err != nil || len(entries) != 0 {
		t.Fatalf("left %v %v", entries, err)
	}
	writeNewFileFn = writeNewFile
	if err := writeTutorial(existing, sampleContent(), time.Now()); err != nil {
		t.Fatalf("retry: %v", err)
	}
}
