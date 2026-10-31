package main

// storedCredential is what pairing leaves behind: the refresh token that
// keeps this Mac signed in to the portal, and the device it names. It lives
// in the Keychain only (keychain_darwin.go), never in settings.json — the
// refresh token is a long-lived credential for the person's account and any
// seat they hold (docs/api/device-flow.md in the portal, "What the
// credentials disclose").
type storedCredential struct {
	RefreshToken string `json:"refreshToken"`
	DeviceID     int    `json:"deviceId"`
	DeviceName   string `json:"deviceName"`
}

// credentialStore keeps one credential per portal origin, so a token issued
// by a development portal is never sent to production, or the reverse.
type credentialStore interface {
	Load(origin string) (storedCredential, bool, error)
	Save(origin string, c storedCredential) error
	Delete(origin string) error
}
