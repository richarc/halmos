package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// htmlExportFilename is the name the export panel offers: the document's stem
// with .html, or Untitled.html for a document never saved.
func htmlExportFilename(docPath string) string {
	if docPath == "" {
		return "Untitled.html"
	}
	base := filepath.Base(docPath)
	return strings.TrimSuffix(base, filepath.Ext(base)) + ".html"
}

// htmlExportDialogTarget is where the export panel opens and the name it
// offers: beside the document, named after it. An unsaved document has no
// folder, so dir is "" and the panel keeps its own default.
func htmlExportDialogTarget(docPath string) (dir, name string) {
	if docPath != "" {
		dir = filepath.Dir(docPath)
	}
	return dir, htmlExportFilename(docPath)
}

// ChooseHTMLExportPath asks where Export → Export HTML… should write. It returns
// "" when the author cancels. The page itself is built by the frontend, which
// holds the rendered preview, and written with WriteHTMLExport.
func (s *DocumentService) ChooseHTMLExportPath(docPath string) (string, error) {
	dir, name := htmlExportDialogTarget(docPath)
	dialog := application.Get().Dialog.SaveFile().
		SetMessage("Export HTML").
		SetFilename(name).
		AddFilter("HTML files", "*.html")
	if dir != "" {
		dialog = dialog.SetDirectory(dir)
	}
	return dialog.PromptForSingleSelection()
}

// WriteHTMLExport writes the exported page atomically, like a save.
func (s *DocumentService) WriteHTMLExport(path, html string) error {
	return writeFileAtomic(path, []byte(html), 0o644)
}

// ReadImageDataURI returns an image beside the document as a data: URI, so an
// exported page carries its images with it. It reads only what the
// /_hermes/image route would serve (localImageFile).
func (s *DocumentService) ReadImageDataURI(docPath, src string) (string, error) {
	if _, ok := localImagePath(src, docPath); !ok {
		return "", errors.New("the image source cannot be resolved")
	}
	path, mime, ok := localImageFile(src, docPath)
	if !ok {
		return "", fmt.Errorf("%s is not an image that can be read", filepath.Base(src))
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}
