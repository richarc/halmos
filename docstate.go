package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
)

// trackedDoc is the document the editor has open, as Go knows it. base is
// the version of the bytes the editor's saved text matches; seen is the
// version last read from disk. They differ once another program changes the
// file, until the author accepts that version. Guarded by DocumentService's
// docMu.
//
// The rest belongs to the watcher (docwatch.go): the open file, which
// follows a rename; the stat last acted on; the stat the previous poll saw,
// which a change must match before it is acted on; and the poll's cancel.
type trackedDoc struct {
	path    string
	base    string
	seen    string
	file    *os.File
	last    diskStat
	pending diskStat
	cancel  context.CancelFunc
}

// SaveResult tells the frontend whether Save wrote. Conflict means the file
// changed on disk since the editor last matched it, and nothing was written.
type SaveResult struct {
	Conflict bool `json:"conflict"`
}

// contentVersion names a file's contents: the hex SHA-256 of its bytes.
// Bytes, not mtime, so a touch or a rewrite with the same text is no change.
func contentVersion(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// trackDocument records path as the open document, with data as both the
// base and the last-seen version. It is the single place a new tracked state
// is recorded, and it restarts the watcher on the file. The caller holds
// docMu.
func (s *DocumentService) trackDocument(path string, data []byte) {
	s.stopWatching()
	v := contentVersion(data)
	s.doc = trackedDoc{path: path, base: v, seen: v}
	s.startWatching()
}

// AcceptDiskVersion makes version the base, so the next Save does not treat
// it as a conflict. Only the version last seen on disk is accepted: anything
// else is stale, and accepting it would let a Save overwrite a change the
// author never saw.
func (s *DocumentService) AcceptDiskVersion(version string) {
	s.docMu.Lock()
	defer s.docMu.Unlock()
	if s.doc.path != "" && version == s.doc.seen {
		s.doc.base = version
	}
}

// ForgetDocument clears the tracked document and stops watching it, so a
// later Save to its path is not checked.
func (s *DocumentService) ForgetDocument() {
	s.docMu.Lock()
	defer s.docMu.Unlock()
	s.stopWatching()
	s.doc = trackedDoc{}
}
