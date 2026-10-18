//go:build !production

package main

import "os"

// portalOrigin lets a development build talk to an unreleased portal behind
// a tunnel through HALMOS_PORTAL_URL. Release builds are built with
// -tags production and use portalorigin_production.go instead, which has no
// override. Credentials are kept per origin, so a token from one portal is
// never sent to the other.
func portalOrigin() (string, error) {
	if v := os.Getenv("HALMOS_PORTAL_URL"); v != "" {
		return validateOrigin(v)
	}
	return productionPortalOrigin, nil
}
