package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// goodTutorial is a manifest with its files, built so each file's hash is
// right; tests break one thing at a time.
func goodTutorial() (*tutorialManifest, map[string][]byte) {
	files := map[string][]byte{
		"getting-started.md":   []byte("# Hello\n"),
		"getting-started.bib":  []byte("@book{a, title={A}}\n"),
		"images/palette.png":   []byte("\x89PNG fake"),
	}
	m := &tutorialManifest{Version: 1, Revision: "3f2a9c41d0be", Title: "Getting Started", Entry: "getting-started.md", MinEditor: "0.16.0"}
	for _, name := range []string{"getting-started.md", "getting-started.bib", "images/palette.png"} {
		m.Files = append(m.Files, tutorialFile{Name: name, Size: int64(len(files[name])), SHA256: sha(files[name]), URL: "/tutorial/3f2a9c41d0be/" + name})
	}
	return m, files
}

func TestTutorialManifestRefusesBadNames(t *testing.T) {
	m, _ := goodTutorial()
	if err := checkTutorialManifest(m); err != nil {
		t.Fatalf("good manifest: %v", err)
	}
	for _, name := range []string{"../x.md", "/x.md", "images/a/b.png", "Getting.md", "x.md.exe", "images/x.svg", "x", "a.b.md", "-x.md", "images/../x.png", ""} {
		if err := checkTutorialName(name); err == nil {
			t.Errorf("%q accepted", name)
		}
	}
	m.Files[1].Name = "../escape.bib"
	if err := checkTutorialManifest(m); err == nil {
		t.Error("manifest with ../ accepted")
	}
}

func TestTutorialManifestRules(t *testing.T) {
	cases := map[string]func(m *tutorialManifest){
		"version 2":       func(m *tutorialManifest) { m.Version = 2 },
		"duplicate name":  func(m *tutorialManifest) { m.Files[1].Name = m.Files[0].Name },
		"entry missing":   func(m *tutorialManifest) { m.Entry = "other.md" },
		"entry is image":  func(m *tutorialManifest) { m.Entry = "images/palette.png" },
		"text too big":    func(m *tutorialManifest) { m.Files[0].Size = 1<<20 + 1 },
		"image too big":   func(m *tutorialManifest) { m.Files[2].Size = 2<<20 + 1 },
		"negative size":   func(m *tutorialManifest) { m.Files[0].Size = -1 },
		"bad hash":        func(m *tutorialManifest) { m.Files[0].SHA256 = "ABC" },
		"upper hash":      func(m *tutorialManifest) { m.Files[0].SHA256 = strings.ToUpper(m.Files[0].SHA256) },
		"foreign url":     func(m *tutorialManifest) { m.Files[0].URL = "https://example.invalid/tutorial/x.md" },
		"no files":        func(m *tutorialManifest) { m.Files = nil },
		"bad revision":    func(m *tutorialManifest) { m.Revision = "../x" },
		"total too big": func(m *tutorialManifest) {
			for i := range 9 {
				m.Files = append(m.Files, tutorialFile{Name: "images/p" + string(rune('a'+i)) + ".png", Size: 2 << 20, SHA256: m.Files[0].SHA256, URL: "/tutorial/x/p.png"})
			}
		},
	}
	for name, breakIt := range cases {
		m, _ := goodTutorial()
		breakIt(m)
		if err := checkTutorialManifest(m); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// serveTutorial answers the manifest and each file, counting file requests.
func serveTutorial(t *testing.T, m *tutorialManifest, files map[string][]byte, fileRequests *int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/tutorial/manifest.json" {
			_ = json.NewEncoder(w).Encode(m)
			return
		}
		*fileRequests++
		for _, f := range m.Files {
			if f.URL == r.URL.Path {
				_, _ = w.Write(files[f.Name])
				return
			}
		}
		http.NotFound(w, r)
	}
}

func TestFetchTutorialChecksHashes(t *testing.T) {
	m, files := goodTutorial()
	requests := 0
	c, _ := testStyleClient(t, serveTutorial(t, m, files, &requests))
	got, data, perr := fetchTutorial(context.Background(), c)
	if perr != nil {
		t.Fatalf("fetch: %v", perr)
	}
	if got.Revision != m.Revision || string(data["images/palette.png"]) != string(files["images/palette.png"]) || len(data) != 3 {
		t.Fatalf("got %+v %v", got, data)
	}

	changed := map[string][]byte{}
	for k, v := range files {
		changed[k] = v
	}
	changed["getting-started.bib"] = []byte("@book{b, title={Swapped}}\n")
	m2, _ := goodTutorial()
	m2.Files[1].Size = int64(len(changed["getting-started.bib"]))
	c, _ = testStyleClient(t, serveTutorial(t, m2, changed, &requests))
	if _, _, perr := fetchTutorial(context.Background(), c); perr == nil || perr.Code != "invalid" {
		t.Fatalf("hash mismatch: %v", perr)
	}

	bad, _ := goodTutorial()
	bad.Files[1].Name = "../x.bib"
	requests = 0
	c, _ = testStyleClient(t, serveTutorial(t, bad, files, &requests))
	if _, _, perr := fetchTutorial(context.Background(), c); perr == nil || perr.Code != "invalid" {
		t.Fatalf("bad manifest: %v", perr)
	}
	if requests != 0 {
		t.Fatalf("%d file requests after a bad manifest", requests)
	}
}

func TestFetchTutorial503(t *testing.T) {
	c, _ := testStyleClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"unavailable"}`))
	})
	if _, _, perr := fetchTutorial(context.Background(), c); perr == nil || perr.Code != "unavailable" {
		t.Fatalf("got %v", perr)
	}
}
