//go:build darwin

package main

// The print operation's finisher (HermesExportFinisher, print_darwin.go)
// hands the rendered PDF here once WebKit has written it. The preamble stays
// declarations only, as cgo requires of a file with //export.

/*
#include <stdlib.h>
*/
import "C"

import (
	"log"
	"os"
)

// hermesPDFExportFinished runs on the main thread, inside the print
// operation's callback, so it only collects its arguments and returns; the
// outline is written on a goroutine. success is 0 when the render failed or
// was cancelled: nothing is written then, and the outline is forgotten.
//
//export hermesPDFExportFinished
func hermesPDFExportFinished(id C.int, success C.int, rendered, stamped, dest *C.char) {
	o, _ := pending.take(int(id))
	r, s, d := C.GoString(rendered), C.GoString(stamped), C.GoString(dest)
	if success == 0 || r == "" {
		for _, p := range []string{r, s} {
			if p != "" {
				_ = os.Remove(p)
			}
		}
		return
	}
	go func() {
		if err := finishExport(r, s, d, o, pdfPageTexts); err != nil {
			log.Printf("Halmos: %v", err)
		}
	}()
}
