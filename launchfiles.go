package main

import "sync"

// launchFiles holds a file macOS asked Hermes to open (Finder's Open With, a
// double-click on a .md) until the frontend can act on it (#19).
//
// At cold launch the request arrives before the page has loaded, so emitting
// file:open then would reach no listener. The path is buffered instead, and
// the frontend collects it with TakeLaunchFile once it is listening; from that
// moment on, arrivals are emitted. Only the last path is kept: Hermes has one
// window.
type launchFiles struct {
	mu      sync.Mutex
	ready   bool
	pending string
}

// arrive records a path. It returns true if the frontend is already listening
// and the caller should emit file:open now, false if the path was buffered.
func (l *launchFiles) arrive(path string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.ready {
		return true
	}
	l.pending = path
	return false
}

// take marks the frontend ready and returns the buffered path, "" if none.
func (l *launchFiles) take() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.ready = true
	p := l.pending
	l.pending = ""
	return p
}
