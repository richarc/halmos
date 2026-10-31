//go:build unix

package main

import (
	"os"
	"syscall"
)

// inode is the file's inode number, so a file replaced under the same name
// reads as a change even when its time and size match.
func inode(info os.FileInfo) uint64 {
	if sys, ok := info.Sys().(*syscall.Stat_t); ok {
		return uint64(sys.Ino)
	}
	return 0
}
