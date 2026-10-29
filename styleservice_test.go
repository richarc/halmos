package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const natureXML = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info><title>Nature</title><id>http://www.zotero.org/styles/nature</id></info>
  <citation><layout><text variable="citation-number"/></layout></citation>
</style>`

const natureCommsXML = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" default-locale="en-GB">
  <info>
    <title>Nature Communications</title>
    <id>http://www.zotero.org/styles/nature-communications</id>
    <link href="http://www.zotero.org/styles/nature-communications" rel="self"/>
    <link href="http://www.zotero.org/styles/nature" rel="independent-parent"/>
  </info>
</style>`

// styleServer is a fake portal: the files it serves, an index built from
// them, and per-path failures. Requests are counted.
type styleServer struct {
	t        *testing.T
	srv      *httptest.Server
	mu       sync.Mutex
	files    map[string]string
	fail     map[string]int
	requests int
	etag     string
}

func newStyleServer(t *testing.T) *styleServer {
	s := &styleServer{t: t, files: map[string]string{"nature": natureXML, "nature-communications": natureCommsXML}, fail: map[string]int{}, etag: `"v1"`}
	s.srv = httptest.NewTLSServer(http.HandlerFunc(s.serve))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *styleServer) index() []byte {
	idx := map[string]any{
		"version": 1, "commit": "c", "built_at": "2026-10-29T00:00:00Z",
		"styles": []map[string]any{
			{"id": "nature", "title": "Nature", "title_short": nil, "parent": nil, "format": "numeric", "fields": []string{"science"}, "sha256": sha([]byte(s.files["nature"]))},
			{"id": "nature-communications", "title": "Nature Communications", "title_short": nil, "parent": "nature", "format": "numeric", "fields": []string{"science"}, "sha256": sha([]byte(s.files["nature-communications"]))},
		},
		"renamed": map[string]string{"aaa": "nature"},
	}
	data, _ := json.Marshal(idx)
	return data
}

func (s *styleServer) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.requests++
	if code := s.fail[r.URL.Path]; code != 0 {
		w.WriteHeader(code)
		_, _ = w.Write([]byte(`{"error":"busy"}`))
		return
	}
	if r.URL.Path == "/styles/index.json" {
		if r.Header.Get("If-None-Match") == s.etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", s.etag)
		_, _ = w.Write(s.index())
		return
	}
	id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/styles/"), ".csl")
	if id == "aaa" {
		http.Redirect(w, r, "/styles/nature.csl", http.StatusMovedPermanently)
		return
	}
	body, ok := s.files[id]
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"not_found"}`))
		return
	}
	_, _ = w.Write([]byte(body))
}

func (s *styleServer) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.requests
}

func (s *styleServer) reset() {
	s.mu.Lock()
	s.requests = 0
	s.mu.Unlock()
}

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time { return c.t }

func testStyleService(t *testing.T, srv *styleServer) (*StyleService, *fakeClock, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "styles")
	clock := &fakeClock{t: time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)}
	svc := newStyleServiceWith(&styleLibrary{dir: dir}, newStyleClient(srv.srv.URL, "", srv.srv.Client()), clock.now)
	return svc, clock, dir
}

func cslFiles(t *testing.T, dir string) []string {
	t.Helper()
	matches, _ := filepath.Glob(filepath.Join(dir, "*.csl"))
	return matches
}

func TestLoadIndexFetchesThenUsesCache(t *testing.T) {
	srv := newStyleServer(t)
	svc, clock, dir := testStyleService(t, srv)
	st := svc.LoadIndex()
	if !st.Ready || st.Error != "" || srv.count() != 1 || len(st.Fields) != 1 {
		t.Fatalf("first: %+v, %d requests", st, srv.count())
	}
	svc.LoadIndex()
	if srv.count() != 1 {
		t.Fatalf("within the hour: %d requests", srv.count())
	}
	// A fresh service reads the cache from disk.
	again := newStyleServiceWith(&styleLibrary{dir: dir}, svc.client, clock.now)
	if st := again.LoadIndex(); !st.Ready || srv.count() != 1 {
		t.Fatalf("from disk: %+v, %d requests", st, srv.count())
	}
	clock.t = clock.t.Add(61 * time.Minute)
	st = svc.LoadIndex()
	svc.bg.Wait()
	if !st.Ready || srv.count() != 2 {
		t.Fatalf("after an hour: %+v, %d requests", st, srv.count())
	}
	_, _, at, _ := (&styleLibrary{dir: dir}).cachedIndex()
	if !at.Equal(clock.t) {
		t.Fatalf("304 did not move the fetch time: %v", at)
	}
}

func TestLoadIndexOfflineWithAndWithoutCache(t *testing.T) {
	srv := newStyleServer(t)
	svc, clock, dir := testStyleService(t, srv)
	svc.LoadIndex()
	srv.srv.Close()

	clock.t = clock.t.Add(2 * time.Hour)
	if st := svc.LoadIndex(); !st.Ready || st.Error != "" {
		t.Fatalf("with cache: %+v", st)
	}
	svc.bg.Wait()
	empty := newStyleServiceWith(&styleLibrary{dir: filepath.Join(dir, "none")}, svc.client, clock.now)
	if st := empty.LoadIndex(); st.Ready || st.Error != "offline" {
		t.Fatalf("without cache: %+v", st)
	}
}

func TestLoadIndexBusy(t *testing.T) {
	srv := newStyleServer(t)
	srv.fail["/styles/index.json"] = http.StatusServiceUnavailable
	svc, _, _ := testStyleService(t, srv)
	if st := svc.LoadIndex(); st.Ready || st.Error != "busy" {
		t.Fatalf("got %+v", st)
	}
}

func TestInstallDependentInstallsParent(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, dir := testStyleService(t, srv)
	changed := 0
	svc.onChanged = func() { changed++ }
	res := svc.InstallStyle("nature-communications")
	if res.Error != "" || res.ID != "nature-communications" || res.Title != "Nature Communications" {
		t.Fatalf("got %+v", res)
	}
	if len(cslFiles(t, dir)) != 2 || changed != 1 {
		t.Fatalf("files %v, changed %d", cslFiles(t, dir), changed)
	}
	lib, _ := svc.lib.installed()
	if !lib["nature"].AsParent || lib["nature-communications"].Parent != "nature" {
		t.Fatalf("library %+v", lib)
	}
	inst := svc.Installed()
	if len(inst) != 1 || inst[0].ID != "nature-communications" {
		t.Fatalf("Installed %+v", inst)
	}
}

func TestInstallDependentParentFailsWritesNothing(t *testing.T) {
	srv := newStyleServer(t)
	srv.fail["/styles/nature.csl"] = http.StatusServiceUnavailable
	svc, _, dir := testStyleService(t, srv)
	if res := svc.InstallStyle("nature-communications"); res.Error != "busy" {
		t.Fatalf("got %+v", res)
	}
	if len(cslFiles(t, dir)) != 0 {
		t.Fatalf("files %v", cslFiles(t, dir))
	}
	if _, err := os.Stat(filepath.Join(dir, "library.json")); err == nil {
		t.Fatal("library.json written")
	}
}

func TestInstallRejectsShaMismatch(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, dir := testStyleService(t, srv)
	svc.LoadIndex()
	srv.mu.Lock()
	srv.files["nature"] = natureXML + "<!-- changed -->"
	srv.mu.Unlock()
	if res := svc.InstallStyle("nature"); res.Error != "invalid" {
		t.Fatalf("got %+v", res)
	}
	if len(cslFiles(t, dir)) != 0 {
		t.Fatal("wrote a file that does not match")
	}
}

func TestInstallUnknownStyle(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, _ := testStyleService(t, srv)
	if res := svc.InstallStyle("no-such-style"); res.Error != "not_found" {
		t.Fatalf("got %+v", res)
	}
}

func TestResolveInstalledMakesNoRequest(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, _ := testStyleService(t, srv)
	svc.InstallStyle("nature-communications")
	srv.reset()
	got := svc.ResolveStyle("nature-communications", "", true)
	if got.XML != natureXML || got.Title != "Nature Communications" || got.Installed || got.Error != "" {
		t.Fatalf("got %+v", got)
	}
	if srv.count() != 0 {
		t.Fatalf("%d requests", srv.count())
	}
}

func TestResolveFetchesUnknownID(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, dir := testStyleService(t, srv)
	got := svc.ResolveStyle("nature-communications", "", true)
	if got.XML != natureXML || !got.Installed || got.Title != "Nature Communications" {
		t.Fatalf("got %+v", got)
	}
	if len(cslFiles(t, dir)) != 2 {
		t.Fatal("not installed")
	}
}

func TestResolveRenamed(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, _ := testStyleService(t, srv)
	if got := svc.ResolveStyle("aaa", "", true); got.XML != natureXML || got.Error != "" {
		t.Fatalf("fetch: %+v", got)
	}
	srv.reset()
	if got := svc.ResolveStyle("aaa", "", true); got.XML != natureXML || got.Installed {
		t.Fatalf("installed: %+v", got)
	}
}

func TestResolveUnknownAndOffline(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, _ := testStyleService(t, srv)
	if got := svc.ResolveStyle("no-such-style", "", true); got.Error != "not_found" || got.XML != "" {
		t.Fatalf("unknown: %+v", got)
	}
	srv.srv.Close()
	off, _, _ := testStyleService(t, srv)
	if got := off.ResolveStyle("nature", "", true); got.Error != "offline" {
		t.Fatalf("offline: %+v", got)
	}
}

func TestResolveFileResolvesAgainstDocument(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, _ := testStyleService(t, srv)
	dir := t.TempDir()
	docPath := filepath.Join(dir, "paper.md")
	stylePath := filepath.Join(dir, "my.csl")
	if err := os.WriteFile(stylePath, []byte(natureXML), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"my.csl", stylePath} {
		if got := svc.ResolveStyle(p, docPath, true); got.XML != natureXML || got.Error != "" || got.Title != "Nature" {
			t.Errorf("%s: %+v", p, got)
		}
	}
	if got := svc.ResolveStyle("missing.csl", docPath, true); got.Error != "unreadable" {
		t.Errorf("missing: %+v", got)
	}
	if srv.count() != 0 {
		t.Errorf("%d requests for an independent file", srv.count())
	}
}

func TestResolveDependentFile(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, _ := testStyleService(t, srv)
	dir := t.TempDir()
	docPath := filepath.Join(dir, "paper.md")
	if err := os.WriteFile(filepath.Join(dir, "nc.csl"), []byte(natureCommsXML), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := svc.ResolveStyle("nc.csl", docPath, true); got.XML != natureXML || got.Error != "" {
		t.Fatalf("got %+v", got)
	}
	srv.srv.Close()
	off, _, _ := testStyleService(t, srv)
	if got := off.ResolveStyle("nc.csl", docPath, true); got.Error != "parent_missing" {
		t.Fatalf("offline: %+v", got)
	}
}

func TestPreviewStyleWritesNothing(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, dir := testStyleService(t, srv)
	got := svc.PreviewStyle("nature-communications")
	if got.XML != natureXML || got.Title != "Nature Communications" || got.Error != "" {
		t.Fatalf("got %+v", got)
	}
	if len(cslFiles(t, dir)) != 0 {
		t.Fatal("preview installed a style")
	}
	srv.reset()
	svc.PreviewStyle("nature-communications")
	if srv.count() != 0 {
		t.Fatalf("second preview made %d requests", srv.count())
	}
}

func TestUpdateAll(t *testing.T) {
	srv := newStyleServer(t)
	svc, clock, dir := testStyleService(t, srv)
	svc.InstallStyle("nature-communications")
	if st := svc.LoadIndex(); st.Updates != 0 {
		t.Fatalf("updates before a change: %d", st.Updates)
	}
	srv.mu.Lock()
	srv.files["nature"] = natureXML + "<!-- v2 -->"
	srv.etag = `"v2"`
	srv.mu.Unlock()
	clock.t = clock.t.Add(2 * time.Hour)
	svc.LoadIndex() // answers from the cache, revalidates behind
	svc.bg.Wait()
	if st := svc.LoadIndex(); st.Updates != 1 {
		t.Fatalf("updates after a change: %d", st.Updates)
	}
	if res := svc.UpdateAll(); res.Error != "" {
		t.Fatalf("UpdateAll %+v", res)
	}
	data, _ := os.ReadFile(filepath.Join(dir, "nature.csl"))
	if !strings.Contains(string(data), "v2") {
		t.Fatal("not rewritten")
	}
	if st := svc.LoadIndex(); st.Updates != 0 {
		t.Fatalf("updates after updating: %d", st.Updates)
	}
	lib, _ := svc.lib.installed()
	if !lib["nature"].AsParent {
		t.Fatal("an update made the parent a chosen style")
	}
}

func TestSearchNeedsIndex(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, _ := testStyleService(t, srv)
	if got := svc.Search("nature", "", ""); len(got.Styles) != 0 || srv.count() != 0 {
		t.Fatalf("searched without an index: %+v", got)
	}
	svc.LoadIndex()
	got := svc.Search("nature", "", "")
	if got.Total != 2 || got.Styles[0].ID != "nature" {
		t.Fatalf("got %+v", got)
	}
}

// Final review fixes.

func TestResolveWithoutFetchMakesNoRequest(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, dir := testStyleService(t, srv)
	if got := svc.ResolveStyle("nature", "", false); got.Error != "not_installed" || got.XML != "" {
		t.Fatalf("got %+v", got)
	}
	if srv.count() != 0 || len(cslFiles(t, dir)) != 0 {
		t.Fatalf("%d requests, files %v", srv.count(), cslFiles(t, dir))
	}
	svc.InstallStyle("nature")
	if got := svc.ResolveStyle("nature", "", false); got.XML != natureXML {
		t.Fatalf("installed without fetch: %+v", got)
	}
}

func TestLibraryWritesAreSerialised(t *testing.T) {
	lib := &styleLibrary{dir: t.TempDir()}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := "s" + string(rune('a'+i))
			_ = lib.writeStyles(map[string][]byte{id: []byte("x")}, []installedStyle{{ID: id, SHA256: "1"}})
		}(i)
	}
	wg.Wait()
	got, err := lib.installed()
	if err != nil || len(got) != 20 {
		t.Fatalf("%d entries, %v", len(got), err)
	}
}

func TestInstalledDoesNotReadTheIndex(t *testing.T) {
	srv := newStyleServer(t)
	svc, clock, dir := testStyleService(t, srv)
	svc.InstallStyle("nature-communications")
	fresh := newStyleServiceWith(&styleLibrary{dir: dir}, svc.client, clock.now)
	if got := fresh.Installed(); len(got) != 1 || got[0].Title != "Nature Communications" {
		t.Fatalf("got %+v", got)
	}
	if fresh.index != nil {
		t.Fatal("Installed parsed the index")
	}
}

func TestLoadIndexStaleCacheDoesNotWait(t *testing.T) {
	srv := newStyleServer(t)
	svc, clock, _ := testStyleService(t, srv)
	svc.LoadIndex()
	release := make(chan struct{})
	slow := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-release }))
	t.Cleanup(func() { close(release); slow.Close() })
	svc.client = newStyleClient(slow.URL, "", slow.Client())
	clock.t = clock.t.Add(2 * time.Hour)
	start := time.Now()
	if st := svc.LoadIndex(); !st.Ready {
		t.Fatalf("got %+v", st)
	}
	if d := time.Since(start); d > time.Second {
		t.Fatalf("LoadIndex waited %v for a refresh", d)
	}
	// Let the background refresh end before the server and temp dir go.
	release <- struct{}{}
	svc.bg.Wait()
}

func TestDependentFileParentIsNotChosen(t *testing.T) {
	srv := newStyleServer(t)
	svc, _, _ := testStyleService(t, srv)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "nc.csl"), []byte(natureCommsXML), 0o644); err != nil {
		t.Fatal(err)
	}
	got := svc.ResolveStyle("nc.csl", filepath.Join(dir, "paper.md"), true)
	if got.XML != natureXML || !got.Installed || got.Title != "Nature" {
		t.Fatalf("got %+v", got)
	}
	if inst := svc.Installed(); len(inst) != 0 {
		t.Fatalf("parent listed as chosen: %+v", inst)
	}
}
