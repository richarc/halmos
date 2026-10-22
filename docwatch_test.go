package main

import (
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"
)

const testDocTick = 10 * time.Millisecond

// docEvent is one event the watcher emitted.
type docEvent struct {
	name string
	data any
}

// eventLog records the watcher's events in place of the Wails emitter.
type eventLog struct {
	mu     sync.Mutex
	events []docEvent
}

func (l *eventLog) emit(name string, data any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.events = append(l.events, docEvent{name, data})
}

func (l *eventLog) all() []docEvent {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]docEvent(nil), l.events...)
}

func (l *eventLog) named(name string) []docEvent {
	var out []docEvent
	for _, e := range l.all() {
		if e.name == name {
			out = append(out, e)
		}
	}
	return out
}

// waitFor polls cond until it holds or timeout passes.
func waitFor(t *testing.T, cond func() bool, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met before timeout")
		}
		time.Sleep(time.Millisecond)
	}
}

// quiet waits ten ticks, long enough for any pending change to settle and
// be reported.
func quiet() { time.Sleep(10 * testDocTick) }

// openWatched writes content to a fresh file and opens it with a fast
// watcher whose events are recorded.
func openWatched(t *testing.T, content string) (*DocumentService, string, *eventLog) {
	t.Helper()
	s := newTestService(t)
	log := &eventLog{}
	s.docTick = testDocTick
	s.emitDoc = log.emit
	path := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.OpenPath(path); err != nil {
		t.Fatalf("OpenPath: %v", err)
	}
	return s, path, log
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func realPath(t *testing.T, path string) string {
	t.Helper()
	p, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestWatchReportsSettledChange(t *testing.T) {
	_, path, log := openWatched(t, "one")
	writeFile(t, path, "two, longer")
	waitFor(t, func() bool { return len(log.named("document:changed")) > 0 }, time.Second)
	quiet()
	events := log.all()
	if len(events) != 1 {
		t.Fatalf("events = %+v, want one document:changed", events)
	}
	got, ok := events[0].data.(DiskChange)
	if !ok {
		t.Fatalf("payload = %T, want DiskChange", events[0].data)
	}
	want := DiskChange{Path: path, Version: contentVersion([]byte("two, longer")), Content: "two, longer"}
	if got != want {
		t.Errorf("payload = %+v, want %+v", got, want)
	}
}

func TestWatchIgnoresOwnSave(t *testing.T) {
	s, path, log := openWatched(t, "one")
	if _, err := s.Save(path, "mine", false); err != nil {
		t.Fatalf("Save: %v", err)
	}
	quiet()
	if events := log.all(); len(events) != 0 {
		t.Errorf("events after own save = %+v, want none", events)
	}
}

func TestWatchIgnoresTouch(t *testing.T) {
	_, path, log := openWatched(t, "one")
	future := time.Now().Add(time.Hour)
	if err := os.Chtimes(path, future, future); err != nil {
		t.Fatal(err)
	}
	quiet()
	if events := log.named("document:changed"); len(events) != 0 {
		t.Errorf("changes after a touch = %+v, want none", events)
	}
}

func TestWatchWaitsForSettle(t *testing.T) {
	_, path, log := openWatched(t, "start\n")
	done := make(chan struct{})
	go func() {
		defer close(done)
		f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
		if err != nil {
			t.Error(err)
			return
		}
		defer f.Close()
		end := time.Now().Add(100 * time.Millisecond)
		for time.Now().Before(end) {
			if _, err := f.WriteString("line\n"); err != nil {
				t.Error(err)
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
	}()
	<-done
	during := len(log.named("document:changed"))
	if during > 1 {
		t.Errorf("%d changes while the file was being written, want at most one", during)
	}
	final := fileText(t, path)
	waitFor(t, func() bool {
		changes := log.named("document:changed")
		return len(changes) > 0 && changes[len(changes)-1].data.(DiskChange).Content == final
	}, time.Second)
}

func TestWatchReportsReplace(t *testing.T) {
	s, path, log := openWatched(t, "one")
	tmp := filepath.Join(filepath.Dir(path), "paper.md.tmp")
	writeFile(t, tmp, "replaced")
	if err := os.Rename(tmp, path); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(log.named("document:changed")) == 1 }, time.Second)

	// The watcher now holds the file that replaced the original.
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	s.docMu.Lock()
	held, err := s.doc.file.Stat()
	s.docMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if held.Sys().(*syscall.Stat_t).Ino != info.Sys().(*syscall.Stat_t).Ino {
		t.Error("the watcher did not reopen the replacing file")
	}

	writeFile(t, path, "rewritten in place")
	waitFor(t, func() bool { return len(log.named("document:changed")) == 2 }, time.Second)
	last := log.named("document:changed")[1].data.(DiskChange)
	if last.Content != "rewritten in place" {
		t.Errorf("second change content = %q", last.Content)
	}
}

func TestWatchDeleteAndRecreateIsAChange(t *testing.T) {
	_, path, log := openWatched(t, "one")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	writeFile(t, path, "recreated")
	waitFor(t, func() bool { return len(log.named("document:changed")) > 0 }, time.Second)
	quiet()
	if deleted := log.named("document:deleted"); len(deleted) != 0 {
		t.Errorf("deletes = %+v, want none", deleted)
	}
	if got := log.named("document:changed")[0].data.(DiskChange).Content; got != "recreated" {
		t.Errorf("change content = %q, want %q", got, "recreated")
	}
}

func TestWatchReportsDelete(t *testing.T) {
	_, path, log := openWatched(t, "one")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(log.named("document:deleted")) > 0 }, time.Second)
	quiet()
	events := log.all()
	if len(events) != 1 {
		t.Fatalf("events = %+v, want one document:deleted", events)
	}
	if got, want := events[0].data, (DocDeleted{Path: path}); got != want {
		t.Errorf("payload = %+v, want %+v", got, want)
	}
}

func TestWatchReportsMove(t *testing.T) {
	s, path, log := openWatched(t, "one")
	var hookMu sync.Mutex
	var hooked []string
	s.docMu.Lock()
	s.onDocMoved = func(from, to string) {
		hookMu.Lock()
		defer hookMu.Unlock()
		hooked = append(hooked, from, to)
	}
	s.docMu.Unlock()
	other := filepath.Join(t.TempDir(), "moved.md")
	if err := os.Rename(path, other); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(log.named("document:moved")) > 0 }, time.Second)
	quiet()
	events := log.all()
	if len(events) != 1 {
		t.Fatalf("events = %+v, want one document:moved", events)
	}
	move := events[0].data.(DocMove)
	if move.From != path {
		t.Errorf("from = %q, want %q", move.From, path)
	}
	if realPath(t, move.To) != realPath(t, other) {
		t.Errorf("to = %q, want %q", move.To, other)
	}
	hookMu.Lock()
	gotHook := append([]string(nil), hooked...)
	hookMu.Unlock()
	if len(gotHook) != 2 || gotHook[0] != move.From || gotHook[1] != move.To {
		t.Errorf("onDocMoved got %q, want [%q %q]", gotHook, move.From, move.To)
	}

	// Save at the new path is checked against the tracked base.
	writeFile(t, move.To, "changed elsewhere")
	res, err := s.Save(move.To, "mine", false)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if !res.Conflict {
		t.Error("a Save to the moved path was not checked")
	}
}

func TestWatchMoveToTrashIsDelete(t *testing.T) {
	_, path, log := openWatched(t, "one")
	trash := filepath.Join(t.TempDir(), ".Trash")
	if err := os.Mkdir(trash, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(path, filepath.Join(trash, "doc.md")); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(log.named("document:deleted")) > 0 }, time.Second)
	quiet()
	if moved := log.named("document:moved"); len(moved) != 0 {
		t.Errorf("moves = %+v, want none", moved)
	}
}

func TestForgetDocumentStopsWatching(t *testing.T) {
	s, path, log := openWatched(t, "one")
	s.ForgetDocument()
	writeFile(t, path, "two, longer")
	quiet()
	if events := log.all(); len(events) != 0 {
		t.Errorf("events after ForgetDocument = %+v, want none", events)
	}
}

func TestWatchReportsFileBackAfterDelete(t *testing.T) {
	// Trash then Put Back, or git stash then stash pop: the same bytes
	// return. The editor was told the file was deleted, so it must hear
	// that the file is back.
	s, path, log := openWatched(t, "one")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(log.named("document:deleted")) > 0 }, time.Second)
	writeFile(t, path, "one")
	waitFor(t, func() bool { return len(log.named("document:changed")) > 0 }, time.Second)
	quiet()
	changes := log.named("document:changed")
	if len(changes) != 1 {
		t.Fatalf("changes = %+v, want one", changes)
	}
	want := DiskChange{Path: path, Version: contentVersion([]byte("one")), Content: "one"}
	if got := changes[0].data.(DiskChange); got != want {
		t.Errorf("payload = %+v, want %+v", got, want)
	}

	// The reported version is the one AcceptDiskVersion takes as the base.
	s.AcceptDiskVersion(want.Version)
	s.docMu.Lock()
	base := s.doc.base
	s.docMu.Unlock()
	if base != want.Version {
		t.Errorf("base = %q, want the reappeared version %q", base, want.Version)
	}
	res, err := s.Save(path, "mine", false)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if res.Conflict {
		t.Error("Save after accepting the reappeared version conflicted")
	}
}
