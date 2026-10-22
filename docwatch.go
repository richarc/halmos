package main

import (
	"context"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// DiskChange is the payload of document:changed: another program changed
// the open document, and this is what the file now holds.
type DiskChange struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	Content string `json:"content"`
}

// DocMove is the payload of document:moved: the open document was renamed
// or moved, and the editor now tracks it at To.
type DocMove struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// DocDeleted is the payload of document:deleted. The watcher keeps polling
// the path, so a file that reappears there is reported as a change. A delete
// clears seen, so that holds even when the same bytes come back (Trash then
// Put Back, git stash then pop).
type DocDeleted struct {
	Path string `json:"path"`
}

// diskStat is what one poll learns from stat(2). The zero value is a
// missing file. Comparable, so two polls can be compared with ==.
type diskStat struct {
	exists bool
	mod    int64
	size   int64
	ino    uint64
}

func statPath(path string) diskStat {
	info, err := os.Stat(path)
	if err != nil {
		return diskStat{}
	}
	return statOf(info)
}

func statOf(info os.FileInfo) diskStat {
	st := diskStat{exists: true, mod: info.ModTime().UnixNano(), size: info.Size()}
	if sys, ok := info.Sys().(*syscall.Stat_t); ok {
		st.ino = sys.Ino
	}
	return st
}

// startWatching opens the tracked file and starts its poll goroutine. The
// caller holds docMu and has stopped any previous watcher.
func (s *DocumentService) startWatching() {
	d := &s.doc
	d.file, _ = os.Open(d.path)
	d.last = statPath(d.path)
	d.pending = d.last
	ctx, cancel := context.WithCancel(context.Background())
	d.cancel = cancel
	go func() {
		ticker := time.NewTicker(s.docTick)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.pollDocument(ctx)
			}
		}
	}()
}

// stopWatching cancels the poll goroutine and closes the file. It does not
// wait for the goroutine: that would deadlock, since a poll takes docMu. A
// poll already waiting for the lock sees the cancelled context and does
// nothing. The caller holds docMu.
func (s *DocumentService) stopWatching() {
	if s.doc.cancel != nil {
		s.doc.cancel()
	}
	if s.doc.file != nil {
		s.doc.file.Close()
	}
}

// pollDocument runs one poll and emits what it found, outside the lock.
func (s *DocumentService) pollDocument(ctx context.Context) {
	name, data, moved, emit := s.checkDocument(ctx)
	if name == "" {
		return
	}
	// checkDocument saw a live context under the lock, but a Save may have
	// stopped this watcher and started another since it was released. An
	// event from the stopped one would describe a file Halmos just wrote.
	if ctx.Err() != nil {
		return
	}
	if move, ok := data.(DocMove); ok && moved != nil {
		moved(move.From, move.To)
	}
	if emit == nil {
		emit = func(name string, data any) { application.Get().Event.Emit(name, data) }
	}
	emit(name, data)
}

// checkDocument compares the file on disk with what was last acted on, and
// updates the tracked state. A change is acted on only once two polls in a
// row see the same stat, so a file being written is reported once it
// settles, and a file deleted and recreated is a change, not a delete. It
// returns the event to emit, if any, with the hooks read under the lock.
func (s *DocumentService) checkDocument(ctx context.Context) (name string, data any, moved func(from, to string), emit func(string, any)) {
	s.docMu.Lock()
	defer s.docMu.Unlock()
	if ctx.Err() != nil {
		return "", nil, nil, nil
	}
	d := &s.doc
	moved, emit = s.onDocMoved, s.emitDoc

	st := statPath(d.path)
	if st != d.pending {
		d.pending = st
		return "", nil, nil, nil
	}
	if st == d.last {
		return "", nil, nil, nil
	}

	if st.exists {
		content, err := os.ReadFile(d.path)
		if err != nil {
			return "", nil, nil, nil // try again next poll
		}
		if st.ino != d.last.ino || d.file == nil {
			s.reopenDocument()
		}
		d.last = st
		v := contentVersion(content)
		if v == d.seen {
			return "", nil, nil, nil
		}
		d.seen = v
		return "document:changed", DiskChange{Path: d.path, Version: v, Content: string(content)}, moved, emit
	}

	d.last = st
	if to, ok := s.movedTo(); ok {
		// Trash on the home volume is ~/.Trash; on any other volume it is
		// /Volumes/X/.Trashes/<uid>. Either is a delete, not a move.
		if strings.Contains(to, "/.Trash/") || strings.Contains(to, "/.Trashes/") {
			d.seen = ""
			return "document:deleted", DocDeleted{Path: d.path}, moved, emit
		}
		from := d.path
		d.path = to
		d.last = statPath(to)
		d.pending = d.last
		return "document:moved", DocMove{From: from, To: to}, moved, emit
	}
	d.seen = ""
	return "document:deleted", DocDeleted{Path: d.path}, moved, emit
}

// reopenDocument swaps the held file for the one now at the path, after the
// file was replaced. The caller holds docMu.
func (s *DocumentService) reopenDocument() {
	if s.doc.file != nil {
		s.doc.file.Close()
	}
	s.doc.file, _ = os.Open(s.doc.path)
}

// movedTo reports where the held file lives now, if it still exists under
// another name. The caller holds docMu.
func (s *DocumentService) movedTo() (string, bool) {
	f := s.doc.file
	if f == nil {
		return "", false
	}
	to, err := currentPath(f)
	if err != nil || to == s.doc.path {
		return "", false
	}
	held, err := f.Stat()
	if err != nil {
		return "", false
	}
	there, err := os.Stat(to)
	if err != nil || !os.SameFile(held, there) {
		return "", false
	}
	return to, true
}
