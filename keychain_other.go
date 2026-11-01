//go:build !darwin

package main

import "errors"

const portalKeychainService = "com.qxquantum.hermes.portal"

var errNoCredentialStore = errors.New("no credential store on this platform")

// noCredentialStore stands in for the Keychain off macOS: nothing is kept,
// so the editor is never signed in there yet.
type noCredentialStore struct{}

func newKeychainStore(string) credentialStore { return noCredentialStore{} }

func (noCredentialStore) Load(string) (storedCredential, bool, error) {
	return storedCredential{}, false, nil
}
func (noCredentialStore) Save(string, storedCredential) error { return errNoCredentialStore }
func (noCredentialStore) Delete(string) error                 { return nil }
