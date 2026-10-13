package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPickCitationsReturnsCAYWResult(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/better-bibtex/cayw" || r.URL.Query().Get("format") != "pandoc" {
			t.Errorf("unexpected request: %s?%s", r.URL.Path, r.URL.RawQuery)
		}
		_, _ = w.Write([]byte("[@smith2020; @doe2021]"))
	}))
	defer srv.Close()

	s := newTestService(t)
	s.caywBase = srv.URL
	got, err := s.PickCitations()
	if err != nil {
		t.Fatalf("PickCitations: %v", err)
	}
	if got != "[@smith2020; @doe2021]" {
		t.Errorf("got %q", got)
	}
}

func TestPickCitationsEmptyOnCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("")) // CAYW returns empty on cancel
	}))
	defer srv.Close()
	s := newTestService(t)
	s.caywBase = srv.URL
	got, err := s.PickCitations()
	if err != nil || got != "" {
		t.Errorf("want empty no-error, got %q err %v", got, err)
	}
}

func TestPickCitationsErrorWhenUnreachable(t *testing.T) {
	s := newTestService(t)
	s.caywBase = "http://127.0.0.1:1" // nothing listens here
	if _, err := s.PickCitations(); err == nil {
		t.Error("want error when Zotero is unreachable")
	}
}

// Clicking Cite in fullscreen switches macOS Spaces to Zotero — unavoidable,
// since the picker is Zotero's own window and it must come forward. What was
// Hermes' bug is that nothing brought the user back, stranding them away from
// their document behind a fullscreen boundary.
func TestPickCitationsRefocusesAfterPicking(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("[@smith2020]"))
	}))
	defer srv.Close()

	refocused := 0
	s := newTestService(t)
	s.caywBase = srv.URL
	s.onRefocus = func() { refocused++ }

	if _, err := s.PickCitations(); err != nil {
		t.Fatalf("PickCitations: %v", err)
	}
	if refocused != 1 {
		t.Errorf("want the window refocused once, got %d", refocused)
	}
}

func TestPickCitationsRefocusesAfterCancelling(t *testing.T) {
	// Cancelling returns an empty body. The user is just as stranded as when
	// they picked something, so this path matters as much as the other.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()

	refocused := 0
	s := newTestService(t)
	s.caywBase = srv.URL
	s.onRefocus = func() { refocused++ }

	if _, err := s.PickCitations(); err != nil {
		t.Fatalf("PickCitations: %v", err)
	}
	if refocused != 1 {
		t.Errorf("want the window refocused once after a cancel, got %d", refocused)
	}
}

func TestPickCitationsDoesNotRefocusWhenZoteroIsUnreachable(t *testing.T) {
	// No picker ever appeared, so focus never left — grabbing it back would be
	// a pointless steal on top of an error the user still has to read.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	srv.Close()

	refocused := 0
	s := newTestService(t)
	s.caywBase = srv.URL
	s.onRefocus = func() { refocused++ }

	if _, err := s.PickCitations(); err == nil {
		t.Fatal("want an error when Zotero is unreachable")
	}
	if refocused != 0 {
		t.Errorf("want no refocus when the picker never ran, got %d", refocused)
	}
}

func zoteroStatusServer(t *testing.T, probe func(w http.ResponseWriter)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/connector/ping":
			_, _ = w.Write([]byte("<html>Zotero is running</html>"))
		case "/better-bibtex/cayw":
			if r.URL.Query().Get("probe") != "true" {
				t.Errorf("probe query missing: %s", r.URL.RawQuery)
			}
			probe(w)
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestZoteroStatusNotRunning(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()

	s := newTestService(t)
	s.caywBase = url
	if got := s.ZoteroStatus(); got != "not-running" {
		t.Errorf("got %q", got)
	}
}

func TestZoteroStatusNoBetterBibTeX(t *testing.T) {
	srv := zoteroStatusServer(t, func(w http.ResponseWriter) { http.Error(w, "nope", http.StatusNotFound) })
	defer srv.Close()

	s := newTestService(t)
	s.caywBase = srv.URL
	if got := s.ZoteroStatus(); got != "no-better-bibtex" {
		t.Errorf("got %q", got)
	}
}

func TestZoteroStatusReady(t *testing.T) {
	srv := zoteroStatusServer(t, func(w http.ResponseWriter) { _, _ = w.Write([]byte("ready\n")) })
	defer srv.Close()

	s := newTestService(t)
	s.caywBase = srv.URL
	if got := s.ZoteroStatus(); got != "ready" {
		t.Errorf("got %q", got)
	}
}
