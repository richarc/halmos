//go:build !darwin

package main

// copyXattrs is a no-op off macOS, where Finder tags do not exist.
func copyXattrs(from, to string) error { return nil }
