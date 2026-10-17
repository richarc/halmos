//go:build darwin && !production

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit -framework WebKit
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

static WKWebView* hermesInspectorFindWebView(NSView *view) {
	if ([view isKindOfClass:[WKWebView class]]) {
		return (WKWebView *)view;
	}
	for (NSView *sub in view.subviews) {
		WKWebView *found = hermesInspectorFindWebView(sub);
		if (found) {
			return found;
		}
	}
	return nil;
}

// Returns 1 if the window's webview was marked inspectable, 0 if there was
// no webview to mark or the OS predates the property. Also turns on
// `developerExtrasEnabled`, which is what Inspect Element and attaching read.
static int hermesSetInspectable(void *nsWindow) {
	if (@available(macOS 13.3, *)) {
		NSWindow *window = (__bridge NSWindow *)nsWindow;
		WKWebView *webView = hermesInspectorFindWebView(window.contentView);
		if (!webView) {
			return 0;
		}
		@try {
			[webView.configuration.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
		} @catch (NSException *exception) {
			NSLog(@"inspector: could not enable developer extras: %@", exception.reason);
		}
		webView.inspectable = YES;
		return 1;
	}
	return 0;
}
*/
import "C"

import (
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// enableInspector lets Safari's Develop menu see the window's webview.
//
// Since macOS 13.3 Safari lists a WKWebView only if its `inspectable`
// property is on. Wails beta.12 never set it on macOS; beta.30's dev build
// does. Wails beta.12's dev build also set WebKit's private
// `developerExtrasEnabled` preference; beta.30 sets it only on macOS older
// than 13.3, so this sets it too, keeping dev builds as they were. Dev builds
// only: this file is compiled out under the `production` tag, the same tag
// that removes Wails' own devtools code.
//
// Hooked on WindowDidBecomeKey rather than run inline, because the native
// window does not exist until the app runs. Setting the property again on
// every focus change is harmless.
func enableInspector(win *application.WebviewWindow) {
	win.RegisterHook(events.Mac.WindowDidBecomeKey, func(*application.WindowEvent) {
		if C.hermesSetInspectable(win.NativeWindow()) == 0 {
			log.Println("inspector: no webview found to mark inspectable")
		}
	})
}
