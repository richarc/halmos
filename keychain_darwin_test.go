package main

import (
	"os"
	"testing"
)

// These touch the real login keychain, under a service name of their own.
// CI runners have no unlocked login keychain, so they are skipped there.
const testKeychainService = "com.qxquantum.hermes.portal.test"

func keychainForTest(t *testing.T) credentialStore {
	t.Helper()
	if os.Getenv("CI") != "" {
		t.Skip("no login keychain on CI")
	}
	s := newKeychainStore(testKeychainService)
	t.Cleanup(func() {
		_ = s.Delete("https://a.example")
		_ = s.Delete("https://b.example")
	})
	return s
}

func TestKeychainStoreRoundTrip(t *testing.T) {
	s := keychainForTest(t)
	const origin = "https://a.example"
	if _, ok, err := s.Load(origin); ok || err != nil {
		t.Fatalf("empty Load = ok %v, err %v", ok, err)
	}
	c := storedCredential{RefreshToken: "r1", DeviceID: 7, DeviceName: "Craig's Mac · 7F3K"}
	if err := s.Save(origin, c); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if got, ok, err := s.Load(origin); !ok || err != nil || got != c {
		t.Fatalf("Load = %+v %v %v", got, ok, err)
	}
	c2 := storedCredential{RefreshToken: "r2", DeviceID: 7, DeviceName: c.DeviceName}
	if err := s.Save(origin, c2); err != nil {
		t.Fatalf("second Save: %v", err)
	}
	if got, _, _ := s.Load(origin); got != c2 {
		t.Fatalf("Save did not replace: %+v", got)
	}
	if err := s.Delete(origin); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, ok, err := s.Load(origin); ok || err != nil {
		t.Fatalf("after Delete: ok %v, err %v", ok, err)
	}
	if err := s.Delete(origin); err != nil {
		t.Fatalf("Delete of a missing item: %v", err)
	}
}

func TestKeychainStoreKeysByOrigin(t *testing.T) {
	s := keychainForTest(t)
	a := storedCredential{RefreshToken: "ra", DeviceID: 1}
	b := storedCredential{RefreshToken: "rb", DeviceID: 2}
	if err := s.Save("https://a.example", a); err != nil {
		t.Fatal(err)
	}
	if err := s.Save("https://b.example", b); err != nil {
		t.Fatal(err)
	}
	if got, _, _ := s.Load("https://a.example"); got != a {
		t.Errorf("a = %+v", got)
	}
	if got, _, _ := s.Load("https://b.example"); got != b {
		t.Errorf("b = %+v", got)
	}
}
