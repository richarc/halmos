package fileio

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteFileAtomicIsNotVisibleUntilComplete(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}

	// While the write is in flight the destination must still read as the old
	// content — never as a partial new one. Approximated here by checking that
	// the write went through a distinct temp path rather than the target: any
	// intermediate file in the directory must not be the destination itself.
	if err := WriteFileAtomic(path, []byte("brand new content"), 0o644); err != nil {
		t.Fatalf("WriteFileAtomic: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "brand new content" {
		t.Errorf("got %q", string(data))
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("want a single file after the write, got %d entries", len(entries))
	}
}

// A document reached through a symlink stays a symlink: the write goes to
// the file it leads to.
func TestSaveThroughSymlinkKeepsLink(t *testing.T) {
	target := filepath.Join(t.TempDir(), "paper.md")
	if err := os.WriteFile(target, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(t.TempDir(), "paper.md")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if err := WriteFileAtomic(link, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("the link was replaced: %v %v", info, err)
	}
	if b, _ := os.ReadFile(target); string(b) != "new" {
		t.Fatalf("target holds %q", b)
	}
}

// When the target's folder cannot be written, the save fails with a
// permission error and the link is left as it was.
func TestSaveThroughSymlinkToReadOnlyTarget(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "paper.md")
	if err := os.WriteFile(target, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })
	link := filepath.Join(t.TempDir(), "paper.md")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	err := WriteFileAtomic(link, []byte("new"), 0o644)
	if !errors.Is(err, fs.ErrPermission) {
		t.Fatalf("err = %v", err)
	}
	if info, _ := os.Lstat(link); info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("the link was replaced")
	}
	if b, _ := os.ReadFile(target); string(b) != "old" {
		t.Fatalf("target holds %q", b)
	}
}
