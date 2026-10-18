package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakePortal answers each path from a script of (status, body) responses,
// repeating the last one, and records what it was sent.
type fakeResp struct {
	status int
	body   string
	header map[string]string
}

type fakePortal struct {
	mu      sync.Mutex
	script  map[string][]fakeResp
	calls   map[string]int
	bodies  map[string][]map[string]any
	bearers map[string][]string
	srv     *httptest.Server
}

func newFakePortal(t *testing.T, script map[string][]fakeResp) *fakePortal {
	f := &fakePortal{script: script, calls: map[string]int{}, bodies: map[string][]map[string]any{}, bearers: map[string][]string{}}
	f.srv = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path[len("/api/v1"):]
		data, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(data, &body)
		f.mu.Lock()
		n := f.calls[path]
		f.calls[path] = n + 1
		f.bodies[path] = append(f.bodies[path], body)
		f.bearers[path] = append(f.bearers[path], r.Header.Get("Authorization"))
		steps := f.script[path]
		f.mu.Unlock()
		if len(steps) == 0 {
			w.WriteHeader(404)
			return
		}
		if n >= len(steps) {
			n = len(steps) - 1
		}
		for k, v := range steps[n].header {
			w.Header().Set(k, v)
		}
		w.WriteHeader(steps[n].status)
		w.Write([]byte(steps[n].body))
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakePortal) count(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[path]
}

func tokenBody(access, refresh string) string {
	return fmt.Sprintf(`{"access_token":%q,"token_type":"Bearer","expires_in":900,"refresh_token":%q,"device":{"id":42,"name":"Mac · ABCD"}}`, access, refresh)
}

// newTestAuth wires a portalAuth to the fake with a fixed clock and a
// recorded, instant sleep.
func newTestAuth(f *fakePortal, store credentialStore) (*portalAuth, *[]time.Duration) {
	a := newPortalAuth(testClient(f.srv), store)
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	a.now = func() time.Time { return now }
	var mu sync.Mutex
	slept := &[]time.Duration{}
	a.sleep = func(ctx context.Context, d time.Duration) error {
		mu.Lock()
		*slept = append(*slept, d)
		mu.Unlock()
		return ctx.Err()
	}
	return a, slept
}

func signedIn(t *testing.T, f *fakePortal, refresh string) *memoryStore {
	t.Helper()
	s := &memoryStore{}
	if err := s.Save(f.srv.URL, storedCredential{RefreshToken: refresh, DeviceID: 42, DeviceName: "Mac · ABCD"}); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestStartPairingSendsClientAndName(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{"/device/authorize": {{200,
		`{"device_code":"dc","user_code":"BDFG-HJKL","verification_uri":"v","verification_uri_complete":"vc","expires_in":900,"interval":5}`, nil}}})
	a, _ := newTestAuth(f, &memoryStore{})
	p, perr := a.startPairing(context.Background(), "Mac · ABCD")
	if perr != nil {
		t.Fatal(perr)
	}
	if p.UserCode != "BDFG-HJKL" || p.DeviceCode != "dc" || p.Interval != 5 || p.ExpiresIn != 900 || p.VerificationURIComplete != "vc" {
		t.Errorf("pairing = %+v", p)
	}
	sent := f.bodies["/device/authorize"][0]
	if sent["client_id"] != "halmos-editor" || sent["device_name"] != "Mac · ABCD" {
		t.Errorf("sent %v", sent)
	}
}

func TestPollPairing(t *testing.T) {
	pending := fakeResp{400, `{"error":"authorization_pending"}`, nil}
	slow := fakeResp{400, `{"error":"slow_down"}`, nil}
	p := pairing{DeviceCode: "dc", Interval: 5, ExpiresIn: 900}

	t.Run("pending, slow down, approved", func(t *testing.T) {
		f := newFakePortal(t, map[string][]fakeResp{"/device/token": {pending, slow, {200, tokenBody("a1", "r1"), nil}}})
		store := &memoryStore{}
		a, slept := newTestAuth(f, store)
		c, perr := a.pollPairing(context.Background(), p)
		if perr != nil {
			t.Fatal(perr)
		}
		want := []time.Duration{5 * time.Second, 5 * time.Second, 10 * time.Second}
		if fmt.Sprint(*slept) != fmt.Sprint(want) {
			t.Errorf("slept %v, want %v", *slept, want)
		}
		if got, ok, _ := store.Load(f.srv.URL); !ok || got.RefreshToken != "r1" || got.DeviceID != 42 || c.RefreshToken != "r1" {
			t.Errorf("stored %+v", got)
		}
		body := f.bodies["/device/token"][0]
		if body["grant_type"] != "urn:ietf:params:oauth:grant-type:device_code" || body["device_code"] != "dc" || body["client_id"] != "halmos-editor" {
			t.Errorf("poll body %v", body)
		}
		if tok, _ := a.accessToken(context.Background()); tok != "a1" {
			t.Errorf("access after pairing = %q", tok)
		}
	})

	t.Run("slow_down caps at 60s", func(t *testing.T) {
		script := []fakeResp{}
		for i := 0; i < 14; i++ {
			script = append(script, slow)
		}
		script = append(script, fakeResp{200, tokenBody("a", "r"), nil})
		f := newFakePortal(t, map[string][]fakeResp{"/device/token": script})
		a, slept := newTestAuth(f, &memoryStore{})
		if _, perr := a.pollPairing(context.Background(), p); perr != nil {
			t.Fatal(perr)
		}
		for _, d := range *slept {
			if d > 60*time.Second {
				t.Fatalf("slept %v, over the 60 s cap", d)
			}
		}
		if last := (*slept)[len(*slept)-1]; last != 60*time.Second {
			t.Errorf("last sleep %v, want 60s", last)
		}
	})

	for _, code := range []string{"access_denied", "expired_token", "invalid_grant", "invalid_client"} {
		t.Run(code+" stops", func(t *testing.T) {
			f := newFakePortal(t, map[string][]fakeResp{"/device/token": {pending, {400, `{"error":"` + code + `"}`, nil}}})
			store := &memoryStore{}
			a, _ := newTestAuth(f, store)
			_, perr := a.pollPairing(context.Background(), p)
			if perr == nil || perr.Code != code {
				t.Errorf("got %+v, want %s", perr, code)
			}
			if f.count("/device/token") != 2 {
				t.Errorf("polled %d times after %s", f.count("/device/token"), code)
			}
			if _, ok, _ := store.Load(f.srv.URL); ok {
				t.Error("stored a credential on failure")
			}
		})
	}

	t.Run("cancel stops", func(t *testing.T) {
		f := newFakePortal(t, map[string][]fakeResp{"/device/token": {pending}})
		a, _ := newTestAuth(f, &memoryStore{})
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, perr := a.pollPairing(ctx, p); perr == nil || perr.Code != "cancelled" {
			t.Errorf("got %+v, want cancelled", perr)
		}
	})

	t.Run("gives up when the code expires", func(t *testing.T) {
		f := newFakePortal(t, map[string][]fakeResp{"/device/token": {pending}})
		a, _ := newTestAuth(f, &memoryStore{})
		clock := a.now()
		a.now = func() time.Time { return clock }
		a.sleep = func(ctx context.Context, d time.Duration) error { clock = clock.Add(d); return nil }
		if _, perr := a.pollPairing(context.Background(), pairing{DeviceCode: "dc", Interval: 5, ExpiresIn: 20}); perr == nil || perr.Code != "expired_token" {
			t.Errorf("got %+v, want expired_token", perr)
		}
	})
}

func TestAccessTokenSignedOut(t *testing.T) {
	f := newFakePortal(t, nil)
	a, _ := newTestAuth(f, &memoryStore{})
	if _, perr := a.accessToken(context.Background()); perr == nil || perr.Code != "signed_out" {
		t.Errorf("got %+v, want signed_out", perr)
	}
}

func TestAccessTokenRefreshesWhenNearExpiry(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{"/token": {{200, tokenBody("a2", "r2"), nil}}})
	store := signedIn(t, f, "r1")
	a, _ := newTestAuth(f, store)
	a.access, a.expiry = "a1", a.now().Add(59*time.Second)
	tok, perr := a.accessToken(context.Background())
	if perr != nil || tok != "a2" {
		t.Fatalf("got %q %+v", tok, perr)
	}
	if got, _, _ := store.Load(f.srv.URL); got.RefreshToken != "r2" {
		t.Errorf("stored refresh token %q, want r2", got.RefreshToken)
	}
	if b := f.bodies["/token"][0]; b["grant_type"] != "refresh_token" || b["refresh_token"] != "r1" {
		t.Errorf("refresh body %v", b)
	}
	// Still fresh: no second refresh.
	a.access, a.expiry = "a2", a.now().Add(10*time.Minute)
	if tok, _ := a.accessToken(context.Background()); tok != "a2" || f.count("/token") != 1 {
		t.Errorf("refreshed a fresh token: %q, %d calls", tok, f.count("/token"))
	}
}

func TestAccessTokenRefreshesOnceUnderConcurrency(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{"/token": {{200, tokenBody("a2", "r2"), nil}}})
	a, _ := newTestAuth(f, signedIn(t, f, "r1"))
	var wg sync.WaitGroup
	var bad atomic.Int32
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if tok, perr := a.accessToken(context.Background()); perr != nil || tok != "a2" {
				bad.Add(1)
			}
		}()
	}
	wg.Wait()
	if n := f.count("/token"); n != 1 {
		t.Errorf("%d refreshes, want exactly 1", n)
	}
	if bad.Load() != 0 {
		t.Errorf("%d callers got no token", bad.Load())
	}
}

func TestRefreshDoesNotUseAccessWhenSaveFails(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{"/token": {{200, tokenBody("a2", "r2"), nil}}})
	store := signedIn(t, f, "r1")
	store.failSave = true
	a, _ := newTestAuth(f, store)
	if tok, perr := a.accessToken(context.Background()); perr == nil || tok != "" {
		t.Fatalf("got %q %+v, want an error", tok, perr)
	}
	if a.access != "" {
		t.Errorf("access token %q kept after the save failed", a.access)
	}
	// The next attempt presents the old token again, which the portal
	// answers with a fresh one inside its 60-second retry window.
	store.failSave = false
	if tok, perr := a.accessToken(context.Background()); perr != nil || tok != "a2" {
		t.Fatalf("retry got %q %+v", tok, perr)
	}
	if b := f.bodies["/token"][1]; b["refresh_token"] != "r1" {
		t.Errorf("retry presented %v, want the old r1", b["refresh_token"])
	}
}

func TestRefreshInvalidGrantSignsOut(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{"/token": {{400, `{"error":"invalid_grant"}`, nil}}})
	store := signedIn(t, f, "r1")
	a, _ := newTestAuth(f, store)
	if _, perr := a.accessToken(context.Background()); perr == nil || perr.Code != "reauth" {
		t.Fatalf("got %+v, want reauth", perr)
	}
	if _, ok, _ := store.Load(f.srv.URL); ok {
		t.Error("a dead credential was kept")
	}
}

func TestAuthedDoRefreshesOnceOn401(t *testing.T) {
	unauth := fakeResp{401, `{"error":"invalid_token"}`, map[string]string{"WWW-Authenticate": `Bearer error="invalid_token"`}}
	t.Run("then succeeds", func(t *testing.T) {
		f := newFakePortal(t, map[string][]fakeResp{
			"/token": {{200, tokenBody("a2", "r2"), nil}},
			"/me":    {unauth, {200, `{"user":{"email":"c@x"}}`, nil}},
		})
		a, _ := newTestAuth(f, signedIn(t, f, "r1"))
		a.access, a.expiry = "a1", a.now().Add(10*time.Minute)
		data, perr := a.authedDo(context.Background(), "GET", "/me", nil, time.Second)
		if perr != nil || string(data) != `{"user":{"email":"c@x"}}` {
			t.Fatalf("got %s %+v", data, perr)
		}
		if f.bearers["/me"][0] != "Bearer a1" || f.bearers["/me"][1] != "Bearer a2" {
			t.Errorf("bearers %v", f.bearers["/me"])
		}
	})
	t.Run("401 again means pair again", func(t *testing.T) {
		f := newFakePortal(t, map[string][]fakeResp{
			"/token": {{200, tokenBody("a2", "r2"), nil}},
			"/me":    {unauth},
		})
		store := signedIn(t, f, "r1")
		a, _ := newTestAuth(f, store)
		a.access, a.expiry = "a1", a.now().Add(10*time.Minute)
		if _, perr := a.authedDo(context.Background(), "GET", "/me", nil, time.Second); perr == nil || perr.Code != "reauth" {
			t.Fatalf("got %+v, want reauth", perr)
		}
		if f.count("/token") != 1 {
			t.Errorf("%d refreshes, want 1", f.count("/token"))
		}
		if _, ok, _ := store.Load(f.srv.URL); ok {
			t.Error("credential kept after a 401 straight after refreshing")
		}
	})
}

func TestAuthedDo402KeepsTokens(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{
		"/token":            {{200, tokenBody("a2", "r2"), nil}},
		"/services/convert": {{401, `{"error":"invalid_token"}`, nil}, {402, `{"error":"no_seat","pricing_url":"https://p/pricing"}`, nil}},
	})
	store := signedIn(t, f, "r1")
	a, _ := newTestAuth(f, store)
	a.access, a.expiry = "a1", a.now().Add(10*time.Minute)
	_, perr := a.authedDo(context.Background(), "POST", "/services/convert", map[string]string{}, time.Second)
	if perr == nil || perr.Code != "no_seat" || perr.PricingURL != "https://p/pricing" {
		t.Fatalf("got %+v", perr)
	}
	if got, ok, _ := store.Load(f.srv.URL); !ok || got.RefreshToken != "r2" {
		t.Errorf("store = %+v %v, want the rotated r2 kept", got, ok)
	}
	if a.access != "a2" {
		t.Errorf("access token %q dropped on a 402", a.access)
	}
}

func TestAuthedDoRetriesBusy(t *testing.T) {
	busy := fakeResp{503, `{"error":"busy"}`, map[string]string{"Retry-After": "2"}}
	t.Run("then succeeds", func(t *testing.T) {
		f := newFakePortal(t, map[string][]fakeResp{"/services/convert": {busy, busy, {200, `{}`, nil}}})
		a, slept := newTestAuth(f, signedIn(t, f, "r1"))
		a.access, a.expiry = "a1", a.now().Add(10*time.Minute)
		if _, perr := a.authedDo(context.Background(), "POST", "/services/convert", map[string]string{}, time.Second); perr != nil {
			t.Fatal(perr)
		}
		if fmt.Sprint(*slept) != fmt.Sprint([]time.Duration{2 * time.Second, 2 * time.Second}) {
			t.Errorf("slept %v", *slept)
		}
	})
	t.Run("gives up after three retries", func(t *testing.T) {
		f := newFakePortal(t, map[string][]fakeResp{"/services/convert": {busy}})
		a, _ := newTestAuth(f, signedIn(t, f, "r1"))
		a.access, a.expiry = "a1", a.now().Add(10*time.Minute)
		if _, perr := a.authedDo(context.Background(), "POST", "/services/convert", map[string]string{}, time.Second); perr == nil || perr.Code != "busy" {
			t.Fatalf("got %+v, want busy", perr)
		}
		if n := f.count("/services/convert"); n != 4 {
			t.Errorf("%d attempts, want 4", n)
		}
	})
	t.Run("429 is not retried", func(t *testing.T) {
		f := newFakePortal(t, map[string][]fakeResp{"/services/convert": {{429, `{"error":"rate_limited"}`, map[string]string{"Retry-After": "300"}}}})
		a, _ := newTestAuth(f, signedIn(t, f, "r1"))
		a.access, a.expiry = "a1", a.now().Add(10*time.Minute)
		_, perr := a.authedDo(context.Background(), "POST", "/services/convert", map[string]string{}, time.Second)
		if perr == nil || perr.Code != "rate_limited" || perr.RetryAfterSeconds != 300 || f.count("/services/convert") != 1 {
			t.Fatalf("got %+v after %d calls", perr, f.count("/services/convert"))
		}
	})
}

func TestSignOutForgetsCredential(t *testing.T) {
	f := newFakePortal(t, nil)
	store := signedIn(t, f, "r1")
	a, _ := newTestAuth(f, store)
	a.access, a.expiry = "a1", a.now().Add(10*time.Minute)
	if err := a.signOut(); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := store.Load(f.srv.URL); ok {
		t.Error("credential kept")
	}
	if _, perr := a.accessToken(context.Background()); perr == nil || perr.Code != "signed_out" {
		t.Errorf("got %+v, want signed_out", perr)
	}
}

// A refresh the portal answered but whose new token could not be kept, or
// whose answer was lost, must be recovered inside the portal's 60-second
// retry window, not left to whenever the person tries again — past it, the
// old token reads as theft and the device is revoked. Final review,
// Important 2.
func TestRefreshRetriesASaveThatFailsOnce(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{"/token": {{200, tokenBody("a2", "r2"), nil}}})
	store := signedIn(t, f, "r1")
	store.failSaves = 2
	a, _ := newTestAuth(f, store)
	if tok, perr := a.accessToken(context.Background()); perr != nil || tok != "a2" {
		t.Fatalf("got %q %+v", tok, perr)
	}
	if got, _, _ := store.Load(f.srv.URL); got.RefreshToken != "r2" {
		t.Errorf("stored %q, want r2", got.RefreshToken)
	}
	if f.count("/token") != 1 {
		t.Errorf("%d refreshes, want 1", f.count("/token"))
	}
}

func TestRefreshRepresentsTheTokenAfterALostAnswer(t *testing.T) {
	f := newFakePortal(t, map[string][]fakeResp{"/token": {{502, `bad gateway`, nil}, {200, tokenBody("a2", "r2"), nil}}})
	a, slept := newTestAuth(f, signedIn(t, f, "r1"))
	if tok, perr := a.accessToken(context.Background()); perr != nil || tok != "a2" {
		t.Fatalf("got %q %+v", tok, perr)
	}
	if f.count("/token") != 2 || f.bodies["/token"][1]["refresh_token"] != "r1" {
		t.Errorf("calls %d, second presented %v", f.count("/token"), f.bodies["/token"][1]["refresh_token"])
	}
	if len(*slept) != 1 || (*slept)[0] > 10*time.Second {
		t.Errorf("slept %v, want one short wait well inside 60 s", *slept)
	}
}
