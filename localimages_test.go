package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLocalImagePath(t *testing.T) {
	tests := []struct {
		name string
		src  string
		doc  string
		want string
		ok   bool
	}{
		{
			name: "relative source joins the document's folder",
			src:  "fig1.png",
			doc:  "/papers/thesis/main.md",
			want: "/papers/thesis/fig1.png",
			ok:   true,
		},
		{
			name: "a subfolder is joined the same way",
			src:  "figures/plot.png",
			doc:  "/papers/thesis/main.md",
			want: "/papers/thesis/figures/plot.png",
			ok:   true,
		},
		{
			// The rule chosen for images is the rule `bibliography:` already
			// uses, and that one allows escaping the document's folder — a
			// figures directory shared between papers is an ordinary layout.
			name: "a parent reference is allowed, as it is for the bibliography",
			src:  "../shared/logo.png",
			doc:  "/papers/thesis/main.md",
			want: "/papers/shared/logo.png",
			ok:   true,
		},
		{
			name: "an absolute source is used as it stands",
			src:  "/Users/me/Desktop/x.png",
			doc:  "/papers/thesis/main.md",
			want: "/Users/me/Desktop/x.png",
			ok:   true,
		},
		{
			// An unsaved document has no folder to resolve against. The
			// frontend does not rewrite in that case, so this is the belt to
			// its braces rather than a reachable path today.
			name: "a relative source with no document cannot resolve",
			src:  "fig1.png",
			doc:  "",
			ok:   false,
		},
		{
			name: "an absolute source resolves even with no document",
			src:  "/tmp/x.png",
			doc:  "",
			want: "/tmp/x.png",
			ok:   true,
		},
		{
			name: "an empty source cannot resolve",
			src:  "",
			doc:  "/papers/thesis/main.md",
			ok:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := localImagePath(tt.src, tt.doc)
			if ok != tt.ok {
				t.Fatalf("ok = %v, want %v", ok, tt.ok)
			}
			if ok && got != tt.want {
				t.Errorf("path = %q, want %q", got, tt.want)
			}
		})
	}
}

// The middleware sits in front of every asset request, so the overwhelmingly
// common case is one it must not touch.
func TestLocalImagesPassesEverythingElseThrough(t *testing.T) {
	reached := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/assets/index.js", nil)
	rec := httptest.NewRecorder()
	localImages(next).ServeHTTP(rec, req)

	if !reached {
		t.Fatal("an unrelated request did not reach the next handler")
	}
}

func TestLocalImagesServesAFileBesideTheDocument(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "main.md")
	if err := os.WriteFile(filepath.Join(dir, "fig1.png"), []byte("PNGDATA"), 0o644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet,
		localImageRoute+"?doc="+doc+"&src=fig1.png", nil)
	rec := httptest.NewRecorder()
	localImages(refuseHandler(t)).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != "PNGDATA" {
		t.Errorf("body = %q, want the file's contents", body)
	}
	// The URL does not change when the file is edited in another application,
	// so the webview must revalidate every time — but no-cache, not no-store:
	// an unchanged file answers the revalidation with a 304 and no bytes.
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", got)
	}
	if rec.Header().Get("Last-Modified") == "" {
		t.Error("no Last-Modified header, so the webview has nothing to revalidate against")
	}
}

func TestLocalImagesAnswersAnUnchangedFileWith304(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "main.md")
	file := filepath.Join(dir, "fig1.png")
	if err := os.WriteFile(file, []byte("PNGDATA"), 0o644); err != nil {
		t.Fatal(err)
	}
	url := localImageRoute + "?doc=" + doc + "&src=fig1.png"

	first := httptest.NewRecorder()
	localImages(refuseHandler(t)).ServeHTTP(first, httptest.NewRequest(http.MethodGet, url, nil))
	stamp := first.Header().Get("Last-Modified")
	if stamp == "" {
		t.Fatal("first response carried no Last-Modified")
	}

	// The webview's revalidation: same URL, the stamp it was given.
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("If-Modified-Since", stamp)
	rec := httptest.NewRecorder()
	localImages(refuseHandler(t)).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want 304 for an unchanged file", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("a 304 carried %d bytes of body", rec.Body.Len())
	}

	// Edited in another application after the stamp: the bytes come back.
	// Last-Modified has one-second resolution, so the mtime moves by a
	// whole second rather than waiting one out.
	later := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(file, later, later); err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("If-Modified-Since", stamp)
	rec = httptest.NewRecorder()
	localImages(refuseHandler(t)).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 once the file changed", rec.Code)
	}
}

func TestLocalImagesReportsAMissingFile(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "main.md")

	req := httptest.NewRequest(http.MethodGet,
		localImageRoute+"?doc="+doc+"&src=absent.png", nil)
	rec := httptest.NewRecorder()
	localImages(refuseHandler(t)).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestLocalImagesRefusesAnUnresolvableSource(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, localImageRoute+"?doc=&src=fig1.png", nil)
	rec := httptest.NewRecorder()
	localImages(refuseHandler(t)).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// A handler that fails the test if the middleware delegates to it — used by
// the cases that must be handled by the route itself.
func refuseHandler(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("the image route delegated to the next handler")
	})
}

// get asks the route for src beside doc and returns the recorded response.
func get(t *testing.T, doc, src string) *httptest.ResponseRecorder {
	t.Helper()
	q := url.Values{"doc": {doc}, "src": {src}}
	rec := httptest.NewRecorder()
	localImages(refuseHandler(t)).ServeHTTP(rec,
		httptest.NewRequest(http.MethodGet, localImageRoute+"?"+q.Encode(), nil))
	return rec
}

// The route is reached by anything the preview renders, and a document can
// come from anyone, so it serves images and nothing else: not a text file
// beside the document, not one elsewhere on disk, not a page that would run in
// the app's origin.
func TestLocalImagesServesOnlyImages(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "paper", "main.md")
	write := func(name, body string) {
		t.Helper()
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("paper/notes.txt", "SECRET")
	write("paper/page.html", "<p>page</p>")
	write("paper/noext", "SECRET")
	write("private.key", "SECRET")
	write("figures/shared.png", "PNGDATA")

	for _, src := range []string{"notes.txt", "page.html", "noext", "../private.key", filepath.Join(dir, "private.key")} {
		if rec := get(t, doc, src); rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "SECRET") {
			t.Errorf("%s: status %d, body %q; want 404 and no contents", src, rec.Code, rec.Body.String())
		}
	}
	// A figures folder shared between papers stays an ordinary layout.
	if rec := get(t, doc, "../figures/shared.png"); rec.Code != http.StatusOK || rec.Body.String() != "PNGDATA" {
		t.Errorf("../figures/shared.png: status %d, body %q; want the image", rec.Code, rec.Body.String())
	}
}

func TestLocalImagesFollowsSymlinksOnlyToImages(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "main.md")
	if err := os.WriteFile(filepath.Join(dir, "secret.txt"), []byte("SECRET"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "real.png"), []byte("PNGDATA"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "secret.txt"), filepath.Join(dir, "disguised.png")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "real.png"), filepath.Join(dir, "alias.png")); err != nil {
		t.Fatal(err)
	}
	if rec := get(t, doc, "disguised.png"); rec.Code != http.StatusNotFound {
		t.Errorf("an image-named link to a text file: status %d, want 404", rec.Code)
	}
	if rec := get(t, doc, "alias.png"); rec.Code != http.StatusOK || rec.Body.String() != "PNGDATA" {
		t.Errorf("a link to an image: status %d, body %q; want the image", rec.Code, rec.Body.String())
	}
}

func TestLocalImagesLabelsWhatItServes(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "main.md")
	if err := os.WriteFile(filepath.Join(dir, "fig.svg"), []byte("<svg/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := get(t, doc, "fig.svg")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "image/svg+xml" {
		t.Errorf("Content-Type %q, want image/svg+xml", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options %q, want nosniff", got)
	}
	// An SVG opened as a document rather than an <img> could run script in
	// the app's origin; this policy gives it none.
	if got := rec.Header().Get("Content-Security-Policy"); !strings.Contains(got, "default-src 'none'") || !strings.Contains(got, "sandbox") {
		t.Errorf("Content-Security-Policy %q, want default-src 'none' and sandbox", got)
	}
}
