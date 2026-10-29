//go:build nopaid

package main

import "testing"

// A release build (wails3 task release adds the nopaid tag) hides them.
func TestPaidFeaturesOffWithNopaid(t *testing.T) {
	if paidFeatures {
		t.Fatal("paidFeatures is on with the nopaid tag")
	}
}
