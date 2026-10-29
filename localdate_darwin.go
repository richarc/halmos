package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation
#import <Foundation/Foundation.h>
#include <stdlib.h>

static char *hermesLocalLongDate(void) {
	@autoreleasepool {
		NSString *s = [NSDateFormatter localizedStringFromDate:[NSDate date]
		                                             dateStyle:NSDateFormatterLongStyle
		                                             timeStyle:NSDateFormatterNoStyle];
		return strdup(s.UTF8String ?: "");
	}
}
*/
import "C"

import "unsafe"

// localLongDate is today in the Mac's region format, long style ("29 October
// 2026"), as Export PDF's finisher writes {date} (print_darwin.go). Go's
// time package does not know the region, and the webview's locale does not
// follow it.
func localLongDate() string {
	cs := C.hermesLocalLongDate()
	defer C.free(unsafe.Pointer(cs))
	return C.GoString(cs)
}
