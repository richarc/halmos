package main

import "testing"

func TestMemoryStore(t *testing.T) {
	s := &memoryStore{}
	if _, ok, err := s.Load("https://a"); ok || err != nil {
		t.Fatalf("empty Load = ok %v, err %v", ok, err)
	}
	c := storedCredential{RefreshToken: "r1", DeviceID: 4, DeviceName: "Mac · ABCD"}
	if err := s.Save("https://a", c); err != nil {
		t.Fatal(err)
	}
	got, ok, err := s.Load("https://a")
	if !ok || err != nil || got != c {
		t.Fatalf("Load = %+v %v %v", got, ok, err)
	}
	if _, ok, _ := s.Load("https://b"); ok {
		t.Error("credentials must be kept per origin")
	}
	if err := s.Delete("https://a"); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.Load("https://a"); ok {
		t.Error("Delete left the credential")
	}
	s.failSave = true
	if err := s.Save("https://a", c); err == nil {
		t.Error("failSave must make Save fail")
	}
}
