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
	if docPath == "" {
		return "", errors.New("save the document before pasting images")
	}
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	if !pastedImageExts[ext] {
		return "", fmt.Errorf("unsupported image type %q", ext)
	}
	dir := filepath.Join(filepath.Dir(docPath), "images")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := pastedImageName(time.Now(), ext, func(n string) bool {
		_, err := os.Stat(filepath.Join(dir, n))
		return err == nil
	})
	if err := writeFileAtomic(filepath.Join(dir, name), data, 0o644); err != nil {
		return "", err
	}
	return "images/" + name, nil
}
