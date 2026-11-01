package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// These parse what the network or a document hands the app. Each must
// never panic, and what it accepts must hold the property callers rely on.
// `go test ./.` runs the seeds; `go test -fuzz FuzzName ./.` searches.

func FuzzParseUpdateFeed(f *testing.F) {
	for _, s := range []string{
		`{"version":"0.16.1"}`, `{"version":"v0.16.1"}`, `{"version":"1.2"}`,
		`{"version":"0.16.1","url":"https://evil"}`, `{"version":"0.16.1"}{}`,
		``, `null`, `[]`, `{"version":"999999999999999999999.0.0"}`,
	} {
		f.Add([]byte(s))
	}
	f.Fuzz(func(t *testing.T, body []byte) {
		v, err := parseUpdateFeed(body)
		if err == nil && (!versionPattern.MatchString(v) || strings.HasPrefix(v, "v")) {
			t.Fatalf("accepted %q from %q", v, body)
		}
	})
}

func FuzzValidateOrigin(f *testing.F) {
	for _, s := range []string{
		"https://www.halmoseditor.com", "https://localhost:4000/", "http://a",
		"https://a/b", "https://u:p@a", "https://a?x", "https://a#f", "", "https:", "//a",
	} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		got, err := validateOrigin(s)
		if err != nil {
			return
		}
		if !strings.HasPrefix(got, "https://") {
			t.Fatalf("%q gave %q", s, got)
		}
		if again, err := validateOrigin(got); err != nil || again != got {
			t.Fatalf("%q gave %q, which re-validates to %q, %v", s, got, again, err)
		}
	})
}

func FuzzLocalImageFile(f *testing.F) {
	dir := f.TempDir()
	doc := filepath.Join(dir, "paper.md")
	if err := os.WriteFile(filepath.Join(dir, "fig.png"), []byte("png"), 0o644); err != nil {
		f.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("secret"), 0o644); err != nil {
		f.Fatal(err)
	}
	for _, s := range []string{
		"fig.png", "./fig.png", "notes.txt", "../" + filepath.Base(dir) + "/fig.png",
		"/etc/passwd", "fig.PNG", "fig.png%00.txt", "", "data:image/png;base64,AA",
		"https://example.com/a.png",
	} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, src string) {
		path, mime, ok := localImageFile(src, doc)
		if !ok {
			return
		}
		want, known := imageTypes[strings.ToLower(filepath.Ext(path))]
		if !known || mime != want {
			t.Fatalf("%q served %q as %q", src, path, mime)
		}
		if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
			t.Fatalf("%q served %q, not a regular file", src, path)
		}
	})
}

func FuzzParseStyleIndex(f *testing.F) {
	for _, s := range []string{
		`{"version":1,"styles":[]}`, `{"version":2}`, `{}`, ``, `null`,
		`{"version":1,"styles":[{"id":"apa","title":"APA"}]}`,
		`{"version":1,"styles":[null]}`,
	} {
		f.Add([]byte(s))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		_, _ = parseStyleIndex(data)
	})
}
