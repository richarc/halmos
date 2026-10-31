//go:build !darwin

package main

import "errors"

// resourcePath has no bundle to point at off macOS; the Licences item falls
// back to the repository.
func resourcePath() (string, error) { return "", errors.New("no app bundle on this platform") }
