//go:build darwin

package main

import (
	"bytes"
	"os"
	"runtime"
	"syscall"
	"unsafe"
)

// maxPathLen is MAXPATHLEN from <sys/param.h>, the size F_GETPATH fills.
// Go's syscall package does not export it for darwin.
const maxPathLen = 1024

// currentPath asks the kernel where the open file f lives now, via
// fcntl(F_GETPATH). It follows a rename, so the watcher can tell a moved
// document from a deleted one. For a deleted file it returns the path the
// file was last known by.
func currentPath(f *os.File) (string, error) {
	buf := make([]byte, maxPathLen)
	_, _, errno := syscall.Syscall(syscall.SYS_FCNTL, f.Fd(), syscall.F_GETPATH, uintptr(unsafe.Pointer(&buf[0])))
	runtime.KeepAlive(f)
	if errno != 0 {
		return "", errno
	}
	if i := bytes.IndexByte(buf, 0); i >= 0 {
		buf = buf[:i]
	}
	return string(buf), nil
}
