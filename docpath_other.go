//go:build !darwin

package main

import "os"

// currentPath cannot follow a moved file off macOS (there is no F_GETPATH),
// so it reports the name the file was opened by, and a move reads as a
// delete.
func currentPath(f *os.File) (string, error) { return f.Name(), nil }
