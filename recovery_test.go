package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func newTestDraftStore(t *testing.T) *draftStore {
	t.Helper()
	return newDraftStore(filepath.Join(t.TempDir(), "drafts"))
}

func TestDraftKeyIsUntitledForNoPathAndStableOtherwise(t *testing.T) {
	if got := draftKey(""); got != "untitled" {
		t.Errorf("want untitled for an empty path, got %q", got)
	}
	a, b := draftKey("/papers/a.md"), draftKey("/papers/b.md")
	if a == b {
		t.Error("different paths must not share a key")
	}
	if a != draftKey("/papers/a.md") {
		t.Error("the key must be a pure function of the path")
	}
	if filepath.Base(a) != a || len(a) != 16 {
		t.Errorf("want a 16-char filename-safe key, got %q", a)
	}
}

func TestDraftRoundTripAndDiscard(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(doc, []byte("saved"), 0o644); err != nil {
		t.Fatal(err)
	}
	// The document is older than the draft about to be written.
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(doc, old, old); err != nil {
		t.Fatal(err)
	}

	if err := d.write(doc, "saved plus more", ""); err != nil {
		t.Fatalf("write: %v", err)
	}
	got, err := d.find(doc)
	if err != nil {
		t.Fatalf("recover: %v", err)
	}
	if !got.Found || got.Content != "saved plus more" {
		t.Errorf("want the draft back, got %+v", got)
	}

	if err := d.discard(doc); err != nil {
		t.Fatalf("discard: %v", err)
	}
	got, err = d.find(doc)
	if err != nil {
		t.Fatalf("recover after discard: %v", err)
	}
	if got.Found {
		t.Error("a discarded draft must not be offered")
	}
	// Discarding twice is not an error: the second call has nothing to do.
	if err := d.discard(doc); err != nil {
		t.Errorf("discard of a missing draft must be a no-op, got %v", err)
	}
}

func TestDraftIsPrivateToTheUser(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := d.write(doc, "x", ""); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(d.dir, draftKey(doc)+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Errorf("want 0600, got %o", got)
	}
}

func TestRecoverIsNotFoundWithoutADraft(t *testing.T) {
	d := newTestDraftStore(t)
	got, err := d.find("/nowhere/paper.md")
	if err != nil || got.Found {
		t.Errorf("want not found and no error, got %+v, %v", got, err)
	}
}

func TestRecoverDropsADraftTheDocumentHasCaughtUpWith(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(doc, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := d.write(doc, "v1 plus", ""); err != nil {
		t.Fatal(err)
	}
	// The document is saved after the draft: whatever the draft held, the
	// author has since written the file on purpose.
	later := time.Now().Add(time.Hour)
	if err := os.Chtimes(doc, later, later); err != nil {
		t.Fatal(err)
	}
	got, err := d.find(doc)
	if err != nil {
		t.Fatal(err)
	}
	if got.Found {
		t.Error("a draft older than the document must not be offered")
	}
	if _, err := os.Stat(filepath.Join(d.dir, draftKey(doc)+".json")); !os.IsNotExist(err) {
		t.Error("a superseded draft must be deleted, not just hidden")
	}
}

func TestRecoverDropsADraftIdenticalToTheDocument(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(doc, []byte("same"), 0o644); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(doc, old, old); err != nil {
		t.Fatal(err)
	}
	if err := d.write(doc, "same", ""); err != nil {
		t.Fatal(err)
	}
	got, err := d.find(doc)
	if err != nil {
		t.Fatal(err)
	}
	if got.Found {
		t.Error("a draft equal to the file has nothing to offer")
	}
	if _, err := os.Stat(filepath.Join(d.dir, draftKey(doc)+".json")); !os.IsNotExist(err) {
		t.Error("a draft identical to the document must be deleted, not just hidden")
	}
}

func TestRecoverDropsADraftWithTheSameMtimeAsTheDocument(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(doc, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := d.write(doc, "v1 plus", ""); err != nil {
		t.Fatal(err)
	}
	draftInfo, err := os.Stat(filepath.Join(d.dir, draftKey(doc)+".json"))
	if err != nil {
		t.Fatal(err)
	}
	// The rule is "at or after": a document stamped with the draft's exact
	// mtime must be treated as caught up, not as strictly older.
	if err := os.Chtimes(doc, draftInfo.ModTime(), draftInfo.ModTime()); err != nil {
		t.Fatal(err)
	}
	got, err := d.find(doc)
	if err != nil {
		t.Fatal(err)
	}
	if got.Found {
		t.Error("a document with the same mtime as the draft must not be offered")
	}
}

func TestRecoverOffersTheDraftWhenTheDocumentIsGone(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "deleted.md")
	if err := d.write(doc, "only copy", ""); err != nil {
		t.Fatal(err)
	}
	got, err := d.find(doc)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Found || got.Content != "only copy" {
		t.Errorf("with no document to compare against the draft is all there is, got %+v", got)
	}
}

func TestRecoverUntitledNeedsNoDocument(t *testing.T) {
	d := newTestDraftStore(t)
	if err := d.write("", "scratch", ""); err != nil {
		t.Fatal(err)
	}
	got, err := d.find("")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Found || got.Content != "scratch" {
		t.Errorf("got %+v", got)
	}
}

func TestRecoverDropsEmptyAndUnreadableDrafts(t *testing.T) {
	d := newTestDraftStore(t)
	if err := d.write("", "", ""); err != nil {
		t.Fatal(err)
	}
	if got, _ := d.find(""); got.Found {
		t.Error("an empty draft must not be offered")
	}
	if _, err := os.Stat(filepath.Join(d.dir, draftKey("")+".json")); !os.IsNotExist(err) {
		t.Error("an empty draft must be deleted, not just hidden")
	}
	doc := "/papers/x.md"
	if err := os.MkdirAll(d.dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d.dir, draftKey(doc)+".json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := d.find(doc)
	if err != nil || got.Found {
		t.Errorf("an unreadable draft must read as not found without error, got %+v, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(d.dir, draftKey(doc)+".json")); !os.IsNotExist(err) {
		t.Error("an unreadable draft must be deleted, not just hidden")
	}
}

func TestPruneRemovesOnlyOldDrafts(t *testing.T) {
	d := newTestDraftStore(t)
	if err := d.write("/papers/old.md", "old", ""); err != nil {
		t.Fatal(err)
	}
	if err := d.write("/papers/new.md", "new", ""); err != nil {
		t.Fatal(err)
	}
	oldFile := filepath.Join(d.dir, draftKey("/papers/old.md")+".json")
	stale := time.Now().Add(-31 * 24 * time.Hour)
	if err := os.Chtimes(oldFile, stale, stale); err != nil {
		t.Fatal(err)
	}

	d.prune(time.Now())

	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Error("a draft older than 30 days must be pruned")
	}
	if got, _ := d.find("/papers/new.md"); !got.Found {
		t.Error("a recent draft must survive pruning")
	}
}

func TestPruneOnAMissingDirectoryIsANoOp(t *testing.T) {
	d := newTestDraftStore(t)
	d.prune(time.Now()) // must not panic or create the dir
	if _, err := os.Stat(d.dir); !os.IsNotExist(err) {
		t.Error("prune must not create the drafts directory")
	}
}

func TestDocumentServiceExposesTheDraftStore(t *testing.T) {
	s := newTestService(t)
	if err := s.WriteDraft("", "from the service"); err != nil {
		t.Fatalf("WriteDraft: %v", err)
	}
	got, err := s.RecoverDraft("")
	if err != nil || !got.Found || got.Content != "from the service" {
		t.Errorf("got %+v, %v", got, err)
	}
	if err := s.DiscardDraft(""); err != nil {
		t.Fatalf("DiscardDraft: %v", err)
	}
	if got, _ := s.RecoverDraft(""); got.Found {
		t.Error("discarded")
	}
	// Drafts live beside recents.json and settings.json, in their own folder.
	wantDir := filepath.Join(filepath.Dir(s.recentsPath), "drafts")
	if s.drafts.dir != wantDir {
		t.Errorf("want drafts at %s, got %s", wantDir, s.drafts.dir)
	}
}

func writeDoc(t *testing.T, path, text string, mtime time.Time) {
	t.Helper()
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

func TestDraftKeptWhenOtherProgramWritesAfterIt(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := d.write(doc, "mine", contentVersion([]byte("one"))); err != nil {
		t.Fatal(err)
	}
	writeDoc(t, doc, "theirs", time.Now().Add(time.Hour))
	got, err := d.find(doc)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Found || !got.Changed || got.Content != "mine" {
		t.Errorf("want the draft kept and marked changed, got %+v", got)
	}
	if _, err := os.Stat(d.file(doc)); err != nil {
		t.Errorf("draft file must remain: %v", err)
	}
}

func TestDraftDroppedWhenDocumentEqualsDraft(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := d.write(doc, "mine", contentVersion([]byte("one"))); err != nil {
		t.Fatal(err)
	}
	writeDoc(t, doc, "mine", time.Now().Add(-time.Hour))
	got, _ := d.find(doc)
	if got.Found {
		t.Errorf("want nothing offered, got %+v", got)
	}
	if _, err := os.Stat(d.file(doc)); !os.IsNotExist(err) {
		t.Error("draft file must be removed")
	}
}

func TestDraftDroppedWhenHalmosSavedOverIt(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := d.write(doc, "mine", contentVersion([]byte("one"))); err != nil {
		t.Fatal(err)
	}
	if err := d.markSaved(doc, contentVersion([]byte("saved text"))); err != nil {
		t.Fatal(err)
	}
	writeDoc(t, doc, "saved text", time.Now().Add(-time.Hour))
	got, _ := d.find(doc)
	if got.Found {
		t.Errorf("want nothing offered, got %+v", got)
	}
}

func TestDraftOfferedUnchangedDiskIsNotChanged(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := d.write(doc, "mine", contentVersion([]byte("one"))); err != nil {
		t.Fatal(err)
	}
	writeDoc(t, doc, "one", time.Now().Add(time.Hour))
	got, _ := d.find(doc)
	if !got.Found || got.Changed {
		t.Errorf("want found and not changed, got %+v", got)
	}
}

func TestLegacyDraftKeepsMtimeRule(t *testing.T) {
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	if err := os.MkdirAll(d.dir, 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := `{"path":"` + doc + `","content":"mine"}`
	if err := os.WriteFile(d.file(doc), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	writeDoc(t, doc, "theirs", time.Now().Add(time.Hour))
	got, _ := d.find(doc)
	if got.Found {
		t.Errorf("a legacy draft older than the document must be dropped, got %+v", got)
	}
}

func TestDraftMovesWithDocument(t *testing.T) {
	d := newTestDraftStore(t)
	a, b := "/papers/a.md", "/papers/b.md"
	if err := d.write(a, "mine", "v"); err != nil {
		t.Fatal(err)
	}
	if err := d.move(a, b); err != nil {
		t.Fatal(err)
	}
	if got, _ := d.find(b); !got.Found || got.Content != "mine" {
		t.Errorf("want the draft under the new path, got %+v", got)
	}
	if got, _ := d.find(a); got.Found {
		t.Error("the old path must have no draft")
	}
	if err := d.move("/papers/none.md", "/papers/x.md"); err != nil {
		t.Errorf("move with no draft must be a no-op, got %v", err)
	}
}

func TestDraftWriteClearsSavedOnlyWhenContentChanges(t *testing.T) {
	d := newTestDraftStore(t)
	doc := "/papers/a.md"
	_ = d.write(doc, "mine", "v")
	_ = d.markSaved(doc, "s")
	_ = d.write(doc, "mine", "v")
	df := readDraftFile(t, d, doc)
	if df.Saved != "s" {
		t.Errorf("same content must keep Saved, got %q", df.Saved)
	}
	_ = d.write(doc, "more", "v")
	if df := readDraftFile(t, d, doc); df.Saved != "" {
		t.Errorf("new content must clear Saved, got %q", df.Saved)
	}
}

func readDraftFile(t *testing.T, d *draftStore, doc string) draftFile {
	t.Helper()
	data, err := os.ReadFile(d.file(doc))
	if err != nil {
		t.Fatal(err)
	}
	var df draftFile
	if err := json.Unmarshal(data, &df); err != nil {
		t.Fatal(err)
	}
	return df
}

// openForDraft writes a document and opens it on a real service, so
// WriteDraft picks up the tracked base.
func openForDraft(t *testing.T, s *DocumentService, text string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.OpenPath(path); err != nil {
		t.Fatalf("OpenPath: %v", err)
	}
	return path
}

func TestServiceDraftIsChangedAfterAnotherProgramWrites(t *testing.T) {
	s := newTestService(t)
	path := openForDraft(t, s, "one")
	if err := s.WriteDraft(path, "mine"); err != nil {
		t.Fatalf("WriteDraft: %v", err)
	}
	if err := os.WriteFile(path, []byte("theirs"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := s.RecoverDraft(path)
	if err != nil || !got.Found || got.Content != "mine" || !got.Changed {
		t.Errorf("got %+v, %v; want found, changed", got, err)
	}
}

func TestServiceDraftDroppedAfterHalmosSaves(t *testing.T) {
	s := newTestService(t)
	path := openForDraft(t, s, "one")
	if err := s.WriteDraft(path, "mine"); err != nil {
		t.Fatalf("WriteDraft: %v", err)
	}
	if res, err := s.Save(path, "mine2", false); err != nil || res.Conflict {
		t.Fatalf("Save: %+v, %v", res, err)
	}
	if got, err := s.RecoverDraft(path); err != nil || got.Found {
		t.Errorf("got %+v, %v; want not found", got, err)
	}
}

func TestServiceDocMovedHookMovesDraftAndRecent(t *testing.T) {
	s := newTestService(t)
	from := openForDraft(t, s, "one")
	to := filepath.Join(filepath.Dir(from), "renamed.md")
	if err := s.WriteDraft(from, "mine"); err != nil {
		t.Fatalf("WriteDraft: %v", err)
	}
	if err := os.Rename(from, to); err != nil {
		t.Fatal(err)
	}
	notified := 0
	s.onRecentsChanged = func() { notified++ }
	s.onDocMoved(from, to)

	if got, _ := s.RecoverDraft(to); !got.Found || got.Content != "mine" {
		t.Errorf("draft at new path = %+v, want found", got)
	}
	if got, _ := s.RecoverDraft(from); got.Found {
		t.Errorf("draft at old path = %+v, want not found", got)
	}
	recents := s.RecentFiles()
	if len(recents) == 0 || recents[0] != to {
		t.Errorf("recents = %v, want %s first", recents, to)
	}
	for _, p := range recents {
		if p == from {
			t.Errorf("recents = %v, still holds %s", recents, from)
		}
	}
	if notified != 1 {
		t.Errorf("recents notified %d times, want 1", notified)
	}
}

func TestDraftWriteNotLostToConcurrentMarkSaved(t *testing.T) {
	// markSaved reads the draft and writes it back. Unserialised, it can
	// write back text that a concurrent write has already replaced.
	d := newTestDraftStore(t)
	doc := filepath.Join(t.TempDir(), "paper.md")
	const n = 200
	var wg sync.WaitGroup
	done := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-done:
				return
			default:
				_ = d.markSaved(doc, "v")
			}
		}
	}()
	last := ""
	for i := 0; i < n; i++ {
		last = fmt.Sprintf("text %d", i)
		if err := d.write(doc, last, "base"); err != nil {
			t.Fatal(err)
		}
	}
	close(done)
	wg.Wait()
	df, ok := d.read(doc)
	if !ok || df.Content != last {
		t.Errorf("draft = %q, want %q", df.Content, last)
	}
}
