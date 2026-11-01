//go:build !unix

package main

import "os"

// inode is not available here; the watcher compares time and size alone.
func inode(os.FileInfo) uint64 { return 0 }
