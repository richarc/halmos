package main

// The last step of Export PDF…: the rendered PDF (with its header and
// footer stamped, if any) gets the outline and properties, and lands at the
// path the user chose. Platform-independent, so the Windows version can
// reuse it; on macOS the print operation's finisher hands over the files
// (pdfexport_darwin.go). See docs/superpowers/specs/2026-11-01-pdf-outline-design.md.

import (
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// finishExport writes dest from the rendered PDF. The pages are matched
// against rendered, the PDF before the header and footer were stamped: a
// header can repeat a heading's text on every page. The outline is added
// to stamped when there is one, rendered otherwise. If adding it fails,
// that file goes to dest as it is, so the export is never lost to this
// step. The temporary files are removed whatever happens; the error is
// only for a dest that could not be written at all.
func finishExport(rendered, stamped, dest string, o PDFOutline, pageTexts func(string) []string) error {
	defer func() {
		_ = os.Remove(rendered)
		if stamped != "" {
			_ = os.Remove(stamped)
		}
	}()
	src := rendered
	if stamped != "" {
		src = stamped
	}

	pages := assignPages(o.Headings, pageTexts(rendered), o.Contents)
	nodes := nestOutline(o.Headings, pages)

	// Written beside dest and renamed over it, so a failure part-way never
	// leaves a half-written file where the user's PDF should be.
	tmp, err := os.CreateTemp(filepath.Dir(dest), "."+filepath.Base(dest)+".halmos-*")
	if err != nil {
		return fmt.Errorf("could not write %s: %w", dest, err)
	}
	tmpPath := tmp.Name()
	tmp.Close()
	defer os.Remove(tmpPath)

	if err := writeOutline(src, tmpPath, nodes, o); err != nil {
		log.Printf("Halmos: the PDF outline was not added to %s: %v", dest, err)
		if err := copyFile(src, tmpPath); err != nil {
			return fmt.Errorf("could not write %s: %w", dest, err)
		}
	}
	if err := os.Rename(tmpPath, dest); err != nil {
		return fmt.Errorf("could not write %s: %w", dest, err)
	}
	return nil
}

// copyFile copies src over dst. The temporary files live in the system's
// temporary folder, often on another volume than dest, so a rename will not
// do.
func copyFile(src, dst string) (err error) {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, out.Close()) }()
	_, err = io.Copy(out, in)
	return err
}

// pendingExports holds each export's outline from ExportPDF until the
// print operation has rendered the PDF, keyed by an id that is all the
// Objective-C side carries.
type pendingExports struct {
	mu   sync.Mutex
	next int
	m    map[int]PDFOutline
}

var pending = &pendingExports{m: map[int]PDFOutline{}}

func (p *pendingExports) add(o PDFOutline) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.next++
	p.m[p.next] = o
	return p.next
}

// take hands out an export's outline once, and forgets it.
func (p *pendingExports) take(id int) (PDFOutline, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	o, ok := p.m[id]
	delete(p.m, id)
	return o, ok
}
