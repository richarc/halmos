package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var pastedImageExts = map[string]bool{"png": true, "jpg": true, "jpeg": true, "gif": true, "webp": true}

// pastedImageName names a pasted image after the moment it was pasted, adding
// -2, -3 and so on when that name is already taken.
func pastedImageName(now time.Time, ext string, exists func(string) bool) string {
	base := "pasted-" + now.Format("20060102-150405")
	name := base + "." + ext
	for n := 2; exists(name); n++ {
		name = fmt.Sprintf("%s-%d.%s", base, n, ext)
	}
	return name
}

// SavePastedImage writes clipboard image bytes into an images/ folder beside
// the document and returns the path relative to the document, with forward
// slashes, ready to put in a markdown image link. An unsaved document has no
// folder to write beside, so it is refused.
func (s *DocumentService) SavePastedImage(docPath string, data []byte, ext string) (string, error) {
	return savePastedImage(time.Now(), docPath, data, ext)
}

// savePastedImage takes the clock as a parameter so a test can make several
// pastes land in the same second.
//
// The bytes are written to a temp file first, so a reader never sees a partial
// image. The temp file is then hard-linked to the final name: link fails with
// "exists" instead of replacing, which makes picking a name atomic. A stat
// followed by a rename would let two simultaneous pastes choose the same name
// and the second would destroy the first.
func savePastedImage(now time.Time, docPath string, data []byte, ext string) (string, error) {
	if docPath == "" {
		return "", errors.New("save the document before pasting images")
	}
	if len(data) == 0 {
		return "", errors.New("the pasted image is empty")
	}
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	if !pastedImageExts[ext] {
		return "", fmt.Errorf("unsupported image type %q", ext)
	}
	dir := filepath.Join(filepath.Dir(docPath), "images")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}

	f, err := os.CreateTemp(dir, ".pasted.tmp*")
	if err != nil {
		return "", err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	_, werr := f.Write(data)
	if werr == nil {
		werr = f.Sync()
	}
	if werr == nil {
		werr = f.Chmod(0o644)
	}
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		return "", werr
	}

	tried := map[string]bool{}
	for {
		name := pastedImageName(now, ext, func(n string) bool {
			if tried[n] {
				return true
			}
			_, err := os.Lstat(filepath.Join(dir, n))
			return err == nil
		})
		err := os.Link(tmp, filepath.Join(dir, name))
		if err == nil {
			return "images/" + name, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return "", err
		}
		tried[name] = true
	}
}
