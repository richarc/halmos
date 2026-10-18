package main

import (
	"context"
	"encoding/json"
	"sync"
	"time"
)

// portalAuth pairs this Mac with the person's account (RFC 8628 device
// flow) and keeps it signed in. The portal rotates the refresh token on
// every use and treats a token presented twice, late, as theft — revoking
// the device — so every refresh and every read of the access token goes
// through one mutex, and a rotated refresh token is in the Keychain before
// its access token is used (hermesportal docs/api/device-flow.md §2).
type portalAuth struct {
	client *portalClient
	store  credentialStore
	now    func() time.Time
	// sleep waits, or returns early with ctx's error.
	sleep func(ctx context.Context, d time.Duration) error

	mu     sync.Mutex
	access string
	expiry time.Time
	cred   storedCredential
	loaded bool
}

// refreshMargin refreshes an access token this close to expiry rather than
// send one that dies in flight.
const refreshMargin = 60 * time.Second

// refreshRetryWait is the pause before asking again for a refresh whose
// answer was lost; well inside the portal's 60-second retry window.
const refreshRetryWait = 2 * time.Second

// saveAttempts is how many times a rotated refresh token is written to the
// Keychain before the refresh is given up.
const saveAttempts = 3

// transient reports a failure where the request may have reached the
// portal and its answer was lost.
func transient(perr *PortalError) bool {
	switch perr.Code {
	case "network", "server_error", "service_unavailable":
		return true
	}
	return false
}

// maxBusyRetries bounds the retries of a 503 busy (one conversion per seat
// at a time); the person is told after that.
const maxBusyRetries = 3

func newPortalAuth(client *portalClient, store credentialStore) *portalAuth {
	return &portalAuth{client: client, store: store, now: time.Now, sleep: sleepCtx}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

type pairing struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Device       struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	} `json:"device"`
}

func (a *portalAuth) startPairing(ctx context.Context, name string) (pairing, *PortalError) {
	data, perr := a.client.do(ctx, "POST", "/device/authorize",
		map[string]string{"client_id": portalClientID, "device_name": name}, "", portalTimeout)
	if perr != nil {
		return pairing{}, perr
	}
	var p pairing
	if err := json.Unmarshal(data, &p); err != nil || p.DeviceCode == "" || p.UserCode == "" {
		return pairing{}, &PortalError{Status: 200, Code: "server_error"}
	}
	return p, nil
}

// pollPairing polls until the person approves or the code is finished with.
// A lost or failed poll is simply polled again: inside the collection
// window the portal answers a repeat with a fresh token.
func (a *portalAuth) pollPairing(ctx context.Context, p pairing) (storedCredential, *PortalError) {
	interval := time.Duration(max(p.Interval, 1)) * time.Second
	deadline := a.now().Add(time.Duration(p.ExpiresIn) * time.Second)
	wait := interval
	body := map[string]string{
		"grant_type":  "urn:ietf:params:oauth:grant-type:device_code",
		"device_code": p.DeviceCode,
		"client_id":   portalClientID,
	}
	for {
		if err := a.sleep(ctx, wait); err != nil || ctx.Err() != nil {
			return storedCredential{}, &PortalError{Code: "cancelled"}
		}
		if !a.now().Before(deadline) {
			return storedCredential{}, &PortalError{Code: "expired_token"}
		}
		wait = interval
		data, perr := a.client.do(ctx, "POST", "/device/token", body, "", portalTimeout)
		if perr == nil {
			return a.adopt(data)
		}
		switch perr.Code {
		case "authorization_pending", "network", "server_error", "service_unavailable":
		case "slow_down":
			interval = min(interval+5*time.Second, 60*time.Second)
			wait = interval
		case "rate_limited":
			wait = max(interval, time.Duration(perr.RetryAfterSeconds)*time.Second)
		default:
			return storedCredential{}, perr
		}
	}
}

// adopt stores a token response's credential, then takes its access token.
func (a *portalAuth) adopt(data []byte) (storedCredential, *PortalError) {
	var t tokenResponse
	if err := json.Unmarshal(data, &t); err != nil || t.AccessToken == "" || t.RefreshToken == "" {
		return storedCredential{}, &PortalError{Status: 200, Code: "server_error"}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	c := storedCredential{RefreshToken: t.RefreshToken, DeviceID: t.Device.ID, DeviceName: t.Device.Name}
	if err := a.store.Save(a.client.origin, c); err != nil {
		return storedCredential{}, &PortalError{Code: "keychain"}
	}
	a.cred, a.loaded = c, true
	a.access, a.expiry = t.AccessToken, a.now().Add(time.Duration(t.ExpiresIn)*time.Second)
	return c, nil
}

func (a *portalAuth) loadLocked() *PortalError {
	if a.loaded {
		return nil
	}
	c, ok, err := a.store.Load(a.client.origin)
	if err != nil {
		return &PortalError{Code: "keychain"}
	}
	if ok {
		a.cred = c
	}
	a.loaded = true
	return nil
}

// credential returns the stored credential, if any, without touching the
// network.
func (a *portalAuth) credential() (storedCredential, bool, *PortalError) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if perr := a.loadLocked(); perr != nil {
		return storedCredential{}, false, perr
	}
	return a.cred, a.cred.RefreshToken != "", nil
}

// accessToken returns a live access token, refreshing first when it is
// missing or within refreshMargin of expiry.
func (a *portalAuth) accessToken(ctx context.Context) (string, *PortalError) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if perr := a.loadLocked(); perr != nil {
		return "", perr
	}
	if a.cred.RefreshToken == "" {
		return "", &PortalError{Code: "signed_out"}
	}
	if a.access != "" && a.expiry.Sub(a.now()) > refreshMargin {
		return a.access, nil
	}
	return a.refreshLocked(ctx)
}

// refreshLocked rotates the refresh token. The new one is saved before the
// access token is kept; if saving fails, the old token stays current in
// memory, so the next attempt presents it again inside the portal's retry
// window and is answered with a fresh one.
//
// Both recoveries happen here rather than on the person's next try, because
// the window is 60 seconds: an answer lost in transit is asked for again
// once, with the same token, after a short wait, and a failed Keychain write
// is tried again before giving up.
func (a *portalAuth) refreshLocked(ctx context.Context) (string, *PortalError) {
	a.access = ""
	body := map[string]string{"grant_type": "refresh_token", "refresh_token": a.cred.RefreshToken}
	data, perr := a.client.do(ctx, "POST", "/token", body, "", portalTimeout)
	if perr != nil && transient(perr) {
		if err := a.sleep(ctx, refreshRetryWait); err != nil {
			return "", &PortalError{Code: "cancelled"}
		}
		data, perr = a.client.do(ctx, "POST", "/token", body, "", portalTimeout)
	}
	if perr != nil {
		if perr.Code == "invalid_grant" {
			a.forgetLocked()
			return "", &PortalError{Status: perr.Status, Code: "reauth"}
		}
		return "", perr
	}
	var t tokenResponse
	if err := json.Unmarshal(data, &t); err != nil || t.AccessToken == "" || t.RefreshToken == "" {
		return "", &PortalError{Status: 200, Code: "server_error"}
	}
	next := a.cred
	next.RefreshToken = t.RefreshToken
	if t.Device.ID != 0 {
		next.DeviceID, next.DeviceName = t.Device.ID, t.Device.Name
	}
	var err error
	for range saveAttempts {
		if err = a.store.Save(a.client.origin, next); err == nil {
			break
		}
	}
	if err != nil {
		return "", &PortalError{Code: "keychain"}
	}
	a.cred = next
	a.access, a.expiry = t.AccessToken, a.now().Add(time.Duration(t.ExpiresIn)*time.Second)
	return a.access, nil
}

func (a *portalAuth) forgetLocked() {
	_ = a.store.Delete(a.client.origin)
	a.cred, a.access, a.expiry = storedCredential{}, "", time.Time{}
}

// authedDo calls an authenticated endpoint. A 401 refreshes once and
// retries; a 401 straight after that refresh means the device is gone, so
// the credential is dropped and the caller is told to pair again. A 402
// never touches the tokens: the credential is fine, the seat is not. A 503
// busy is retried after Retry-After, up to maxBusyRetries times.
func (a *portalAuth) authedDo(ctx context.Context, method, path string, body any, timeout time.Duration) ([]byte, *PortalError) {
	tok, perr := a.accessToken(ctx)
	if perr != nil {
		return nil, perr
	}
	refreshed, busy := false, 0
	for {
		data, perr := a.client.do(ctx, method, path, body, tok, timeout)
		switch {
		case perr == nil:
			return data, nil
		case perr.Status == 401 && !refreshed:
			refreshed = true
			a.mu.Lock()
			if a.access == tok {
				a.access = ""
			}
			a.mu.Unlock()
			if tok, perr = a.accessToken(ctx); perr != nil {
				return nil, perr
			}
		case perr.Status == 401:
			a.mu.Lock()
			a.forgetLocked()
			a.mu.Unlock()
			return nil, &PortalError{Status: 401, Code: "reauth"}
		case perr.Code == "busy" && busy < maxBusyRetries:
			busy++
			if err := a.sleep(ctx, time.Duration(perr.RetryAfterSeconds)*time.Second); err != nil {
				return nil, &PortalError{Code: "cancelled"}
			}
		default:
			return nil, perr
		}
	}
}

// signOut forgets this Mac's credential. The device stays connected on the
// portal until the person removes it there: the API has no endpoint for
// the editor to do it.
func (a *portalAuth) signOut() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.store.Delete(a.client.origin); err != nil {
		return err
	}
	a.cred, a.access, a.expiry, a.loaded = storedCredential{}, "", time.Time{}, true
	return nil
}
