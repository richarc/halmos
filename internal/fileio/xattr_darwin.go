//go:build darwin

package fileio

import (
	"bytes"

	"golang.org/x/sys/unix"
)

// copyXattrs copies from's extended attributes onto to, except the
// quarantine flag, which belongs to how a file arrived, not to its content.
func copyXattrs(from, to string) error {
	size, err := unix.Listxattr(from, nil)
	if err != nil || size == 0 {
		return err
	}
	names := make([]byte, size)
	if size, err = unix.Listxattr(from, names); err != nil {
		return err
	}
	var firstErr error
	for _, name := range bytes.Split(names[:size], []byte{0}) {
		if len(name) == 0 || string(name) == "com.apple.quarantine" {
			continue
		}
		n, err := unix.Getxattr(from, string(name), nil)
		if err != nil {
			firstErr = keepFirst(firstErr, err)
			continue
		}
		value := make([]byte, n)
		if n, err = unix.Getxattr(from, string(name), value); err != nil {
			firstErr = keepFirst(firstErr, err)
			continue
		}
		if err := unix.Setxattr(to, string(name), value[:n], 0); err != nil {
			firstErr = keepFirst(firstErr, err)
		}
	}
	return firstErr
}

func keepFirst(first, next error) error {
	if first != nil {
		return first
	}
	return next
}
