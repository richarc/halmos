//go:build darwin

package main

import "github.com/wailsapp/wails/v3/pkg/mac"

// resourcePath is the app bundle's Contents/Resources.
func resourcePath() (string, error) { return mac.ResourcePath() }
