//go:build !darwin

package main

import "time"

// localLongDate is today, long style, in English: the region format is a
// macOS lookup (localdate_darwin.go).
func localLongDate() string { return time.Now().Format("2 January 2006") }
