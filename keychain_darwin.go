package main

/*
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdlib.h>

static CFStringRef kcString(const char *s) {
	return CFStringCreateWithCString(kCFAllocatorDefault, s, kCFStringEncodingUTF8);
}

// kcQuery is a generic-password query for one service and account.
static CFMutableDictionaryRef kcQuery(const char *service, const char *account) {
	CFMutableDictionaryRef q = CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
		&kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
	CFStringRef svc = kcString(service);
	CFStringRef acc = kcString(account);
	CFDictionarySetValue(q, kSecClass, kSecClassGenericPassword);
	CFDictionarySetValue(q, kSecAttrService, svc);
	CFDictionarySetValue(q, kSecAttrAccount, acc);
	CFRelease(svc);
	CFRelease(acc);
	return q;
}

static OSStatus kcLoad(const char *service, const char *account, void **out, long *outLen) {
	CFMutableDictionaryRef q = kcQuery(service, account);
	CFDictionarySetValue(q, kSecReturnData, kCFBooleanTrue);
	CFDictionarySetValue(q, kSecMatchLimit, kSecMatchLimitOne);
	CFTypeRef result = NULL;
	OSStatus st = SecItemCopyMatching(q, &result);
	CFRelease(q);
	if (st != errSecSuccess) return st;
	CFDataRef data = (CFDataRef)result;
	*outLen = CFDataGetLength(data);
	*out = malloc(*outLen);
	CFDataGetBytes(data, CFRangeMake(0, *outLen), (UInt8 *)*out);
	CFRelease(result);
	return errSecSuccess;
}

static OSStatus kcSave(const char *service, const char *account, const void *bytes, long len) {
	CFDataRef data = CFDataCreate(kCFAllocatorDefault, (const UInt8 *)bytes, len);
	CFMutableDictionaryRef q = kcQuery(service, account);
	CFMutableDictionaryRef attrs = CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
		&kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
	CFDictionarySetValue(attrs, kSecValueData, data);
	OSStatus st = SecItemUpdate(q, attrs);
	if (st == errSecItemNotFound) {
		CFDictionarySetValue(q, kSecValueData, data);
		// Readable once the Mac has been unlocked after boot, and never
		// carried to another Mac by a backup or migration: a copied
		// credential would look like theft to the portal and revoke both.
		CFDictionarySetValue(q, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);
		st = SecItemAdd(q, NULL);
	}
	CFRelease(attrs);
	CFRelease(q);
	CFRelease(data);
	return st;
}

static OSStatus kcDelete(const char *service, const char *account) {
	CFMutableDictionaryRef q = kcQuery(service, account);
	OSStatus st = SecItemDelete(q);
	CFRelease(q);
	return st;
}
*/
import "C"

import (
	"encoding/json"
	"fmt"
	"unsafe"
)

// portalKeychainService names the Keychain items holding portal credentials.
// It keeps the bundle id's old "hermes" spelling, like the rest of the
// app's stored state (CLAUDE.md).
const portalKeychainService = "com.qxquantum.hermes.portal"

// keychainStore keeps each origin's credential as a generic password item,
// account = the origin, data = the credential as JSON.
type keychainStore struct{ service string }

func newKeychainStore(service string) credentialStore { return keychainStore{service: service} }

func (k keychainStore) Load(origin string) (storedCredential, bool, error) {
	svc, acc := C.CString(k.service), C.CString(origin)
	defer C.free(unsafe.Pointer(svc))
	defer C.free(unsafe.Pointer(acc))
	var out unsafe.Pointer
	var n C.long
	st := C.kcLoad(svc, acc, &out, &n)
	if st == C.errSecItemNotFound {
		return storedCredential{}, false, nil
	}
	if st != C.errSecSuccess {
		return storedCredential{}, false, fmt.Errorf("keychain: read failed (%d)", int(st))
	}
	data := C.GoBytes(out, C.int(n))
	C.free(out)
	var c storedCredential
	if err := json.Unmarshal(data, &c); err != nil {
		return storedCredential{}, false, fmt.Errorf("keychain: unreadable credential: %w", err)
	}
	return c, true, nil
}

func (k keychainStore) Save(origin string, c storedCredential) error {
	data, err := json.Marshal(c)
	if err != nil {
		return err
	}
	svc, acc := C.CString(k.service), C.CString(origin)
	defer C.free(unsafe.Pointer(svc))
	defer C.free(unsafe.Pointer(acc))
	if st := C.kcSave(svc, acc, unsafe.Pointer(&data[0]), C.long(len(data))); st != C.errSecSuccess {
		return fmt.Errorf("keychain: save failed (%d)", int(st))
	}
	return nil
}

func (k keychainStore) Delete(origin string) error {
	svc, acc := C.CString(k.service), C.CString(origin)
	defer C.free(unsafe.Pointer(svc))
	defer C.free(unsafe.Pointer(acc))
	st := C.kcDelete(svc, acc)
	if st != C.errSecSuccess && st != C.errSecItemNotFound {
		return fmt.Errorf("keychain: delete failed (%d)", int(st))
	}
	return nil
}
