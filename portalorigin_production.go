//go:build production

package main

// portalOrigin is fixed in release builds: the development override in
// portalorigin_dev.go is not compiled in, so no setting or variable can
// point a shipped app at another server.
func portalOrigin() (string, error) { return productionPortalOrigin, nil }
