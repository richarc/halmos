//go:build !nopaid

package main

import "testing"

// A development build (no nopaid tag) shows the paid features, so the work on
// main for v1.1.0 can still be tried.
func TestPaidFeaturesOnByDefault(t *testing.T) {
	if !paidFeatures {
		t.Fatal("paidFeatures is off without the nopaid tag")
	}
}
