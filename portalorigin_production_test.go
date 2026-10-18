//go:build production

package main

import "testing"

// Run with: go test -tags production -run ProductionOrigin ./.
func TestProductionOriginIgnoresEnv(t *testing.T) {
	t.Setenv("HALMOS_PORTAL_URL", "https://x.trycloudflare.com")
	if got, err := portalOrigin(); err != nil || got != "https://www.halmoseditor.com" {
		t.Errorf("portalOrigin() = %q, %v", got, err)
	}
}
