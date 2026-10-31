//go:build darwin

package main

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

// Finder tags are an extended attribute; saving replaces the file, so they
// have to be carried over or every save drops them.
func TestSaveKeepsFinderTags(t *testing.T) {
	const tags = "com.apple.metadata:_kMDItemUserTags"
	path := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	value := []byte("bplist00\xa1\x01VRed\n6\x08\x0a")
	if err := unix.Setxattr(path, tags, value, 0); err != nil {
		t.Fatal(err)
	}
	if err := writeFileAtomic(path, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 256)
	n, err := unix.Getxattr(path, tags, buf)
	if err != nil || string(buf[:n]) != string(value) {
		t.Fatalf("tags after save: %q, %v", buf[:max(n, 0)], err)
	}
}
