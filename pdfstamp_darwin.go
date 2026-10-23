//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit -framework PDFKit
#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>
#include <stdlib.h>

// The template with {title}, {date}, {page} and {pages} filled in, in one
// pass: inserted values are never read for placeholders. Anything else in
// braces is left as written.
static NSString *hermesFurnitureText(NSString *tmpl, NSString *title,
                                     NSString *date, NSInteger page,
                                     NSInteger pages) {
	NSMutableString *out = [NSMutableString string];
	NSUInteger i = 0, n = tmpl.length;
	while (i < n) {
		NSRange open = [tmpl rangeOfString:@"{" options:0 range:NSMakeRange(i, n - i)];
		if (open.location == NSNotFound) {
			[out appendString:[tmpl substringFromIndex:i]];
			break;
		}
		[out appendString:[tmpl substringWithRange:NSMakeRange(i, open.location - i)]];
		NSRange close = [tmpl rangeOfString:@"}" options:0
		                              range:NSMakeRange(open.location, n - open.location)];
		NSString *value = nil;
		if (close.location != NSNotFound) {
			NSString *name = [tmpl substringWithRange:NSMakeRange(open.location + 1,
			                                                      close.location - open.location - 1)];
			if ([name isEqualToString:@"title"]) value = title;
			else if ([name isEqualToString:@"date"]) value = date;
			else if ([name isEqualToString:@"page"]) value = [NSString stringWithFormat:@"%ld", (long)page];
			else if ([name isEqualToString:@"pages"]) value = [NSString stringWithFormat:@"%ld", (long)pages];
		}
		if (value) {
			[out appendString:value];
			i = NSMaxRange(close);
		} else {
			// Not a placeholder: keep the brace and read on from the next
			// character, so "{{page}}" still finds "{page}".
			[out appendString:@"{"];
			i = open.location + 1;
		}
	}
	return out;
}

// The document's body typeface (the BodyFont setting's keys, as in
// lib/bodyFont.ts) at the given size; Georgia, then the system font, if the
// face is missing.
static NSFont *hermesFurnitureFont(NSString *key, CGFloat size) {
	NSFont *font = nil;
	if ([key isEqualToString:@"system-sans"]) {
		return [NSFont systemFontOfSize:size];
	}
	if ([key isEqualToString:@"new-york"]) {
		NSFontDescriptor *d = [[NSFont systemFontOfSize:size].fontDescriptor
		    fontDescriptorWithDesign:NSFontDescriptorSystemDesignSerif];
		if (d) font = [NSFont fontWithDescriptor:d size:size];
	} else {
		NSDictionary *names = @{
			@"charter" : @"Charter-Roman",
			@"iowan" : @"IowanOldStyle-Roman",
			@"palatino" : @"Palatino-Roman",
			@"georgia" : @"Georgia",
		};
		NSString *name = names[key];
		if (name) font = [NSFont fontWithName:name size:size];
	}
	return font ?: [NSFont fontWithName:@"Georgia" size:size] ?: [NSFont systemFontOfSize:size];
}

// What the page class draws. Set by hermesStampPDF for the length of one
// call; stamping runs on one thread at a time (the main thread, or a test).
static NSString *hermesStampHeader, *hermesStampFooter, *hermesStampTitle, *hermesStampDate;
static NSFont *hermesStampFont;
static NSInteger hermesStampPages;

// Distance from the paper's edge to the middle of the header or footer line:
// half the 25mm margin across the short edge (lib/paper.ts's PAGE_MARGIN_MM),
// which is the smallest page margin in either orientation, so the line never
// reaches the text.
static const CGFloat hermesFurnitureInset = 25.0 / 2 * 72 / 25.4;

@interface HermesStampedPage : PDFPage
@end

@implementation HermesStampedPage
- (void)drawWithBox:(PDFDisplayBox)box toContext:(CGContextRef)context {
	[super drawWithBox:box toContext:context];
	// Only hermesStampPDFAt sets what to draw; a page drawn any other time
	// draws as WebKit made it.
	if (!hermesStampFont) {
		return;
	}
	NSRect b = [self boundsForBox:box];
	NSInteger page = [self.document indexForPage:self] + 1;

	NSMutableParagraphStyle *style = [[NSMutableParagraphStyle alloc] init];
	style.alignment = NSTextAlignmentCenter;
	style.lineBreakMode = NSLineBreakByTruncatingTail;
	NSDictionary *attrs = @{
		NSFontAttributeName : hermesStampFont,
		NSForegroundColorAttributeName : [NSColor colorWithWhite:0.35 alpha:1],
		NSParagraphStyleAttributeName : style,
	};
	CGFloat lineHeight = ceil(hermesStampFont.ascender - hermesStampFont.descender + hermesStampFont.leading);
	// The text column's side margin, as lib/paper.ts sets it: 25mm across
	// the short edge, scaled by the paper's shape in landscape.
	CGFloat inset = 2 * hermesFurnitureInset;
	if (b.size.width > b.size.height) {
		inset *= b.size.width / b.size.height;
	}
	CGFloat width = b.size.width - 2 * inset;

	NSGraphicsContext *previous = [NSGraphicsContext currentContext];
	[NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithCGContext:context flipped:NO]];
	if (hermesStampHeader.length) {
		NSString *text = hermesFurnitureText(hermesStampHeader, hermesStampTitle, hermesStampDate, page, hermesStampPages);
		[text drawInRect:NSMakeRect(b.origin.x + inset,
		                            NSMaxY(b) - hermesFurnitureInset - lineHeight / 2, width, lineHeight)
		  withAttributes:attrs];
	}
	if (hermesStampFooter.length) {
		NSString *text = hermesFurnitureText(hermesStampFooter, hermesStampTitle, hermesStampDate, page, hermesStampPages);
		[text drawInRect:NSMakeRect(b.origin.x + inset,
		                            b.origin.y + hermesFurnitureInset - lineHeight / 2, width, lineHeight)
		  withAttributes:attrs];
	}
	[NSGraphicsContext setCurrentContext:previous];
	[style release];
}
@end

@interface HermesStampDelegate : NSObject <PDFDocumentDelegate>
@end

@implementation HermesStampDelegate
- (Class)classForPage {
	return [HermesStampedPage class];
}
@end

// Draws the header and footer on every page of the PDF at in and writes the
// result to out, keeping WebKit's text and links. Returns 0 if in is not a
// readable PDF or out could not be written. in and out may not be the same
// file: PDFKit reads pages lazily while it writes.
int hermesStampPDFAt(NSURL *in, NSURL *out, NSString *header, NSString *footer,
                            NSString *title, NSString *date, NSString *fontKey) {
	@autoreleasepool {
		PDFDocument *doc = [[[PDFDocument alloc] initWithURL:in] autorelease];
		if (!doc || doc.pageCount == 0) {
			return 0;
		}
		// The page class is chosen as each page is first read, so the
		// delegate must be in place before anything touches a page.
		HermesStampDelegate *delegate = [[[HermesStampDelegate alloc] init] autorelease];
		doc.delegate = delegate;
		hermesStampHeader = header;
		hermesStampFooter = footer;
		hermesStampTitle = title;
		hermesStampDate = date;
		hermesStampFont = hermesFurnitureFont(fontKey, 9);
		hermesStampPages = doc.pageCount;
		BOOL ok = [doc writeToURL:out];
		doc.delegate = nil;
		hermesStampHeader = hermesStampFooter = hermesStampTitle = hermesStampDate = nil;
		hermesStampFont = nil;
		return ok ? 1 : 0;
	}
}

static NSString *hermesString(const char *s) {
	return [NSString stringWithUTF8String:s] ?: @"";
}

static int hermesStampPDF(const char *in, const char *out, const char *header,
                          const char *footer, const char *title, const char *date,
                          const char *fontKey) {
	@autoreleasepool {
		return hermesStampPDFAt([NSURL fileURLWithPath:hermesString(in)],
		                        [NSURL fileURLWithPath:hermesString(out)],
		                        hermesString(header), hermesString(footer),
		                        hermesString(title), hermesString(date),
		                        hermesString(fontKey));
	}
}

static char *hermesFurnitureTextC(const char *tmpl, const char *title, const char *date,
                                  long page, long pages) {
	@autoreleasepool {
		NSString *s = hermesFurnitureText(hermesString(tmpl), hermesString(title),
		                                  hermesString(date), page, pages);
		return strdup(s.UTF8String);
	}
}

// Each page's text, joined by form feeds, for the tests.
static char *hermesPDFPageTexts(const char *path) {
	@autoreleasepool {
		PDFDocument *doc = [[[PDFDocument alloc] initWithURL:[NSURL fileURLWithPath:hermesString(path)]] autorelease];
		NSMutableArray *pages = [NSMutableArray array];
		for (NSInteger i = 0; doc && i < doc.pageCount; i++) {
			[pages addObject:[doc pageAtIndex:i].string ?: @""];
		}
		return strdup([pages componentsJoinedByString:@"\f"].UTF8String);
	}
}
*/
import "C"

import (
	"strings"
	"unsafe"
)

// stampPDF draws f's header and footer, in the body font named by fontKey and
// with date for `{date}`, on every page of the PDF at in, and writes the
// result to out. It reports false if in is not a PDF or out could not be
// written. The export calls hermesStampPDFAt directly; this is its Go door.
func stampPDF(in, out string, f PageFurniture, date, fontKey string) bool {
	cs := cStrings(in, out, f.Header, f.Footer, f.Title, date, fontKey)
	defer freeCStrings(cs)
	return C.hermesStampPDF(cs[0], cs[1], cs[2], cs[3], cs[4], cs[5], cs[6]) != 0
}

// furnitureText is hermesFurnitureText, the placeholder filling each page's
// header and footer goes through.
func furnitureText(tmpl, title, date string, page, pages int) string {
	cs := cStrings(tmpl, title, date)
	defer freeCStrings(cs)
	r := C.hermesFurnitureTextC(cs[0], cs[1], cs[2], C.long(page), C.long(pages))
	defer C.free(unsafe.Pointer(r))
	return C.GoString(r)
}

// pdfPageTexts is the text PDFKit reads from each page of the PDF at path.
func pdfPageTexts(path string) []string {
	cs := cStrings(path)
	defer freeCStrings(cs)
	r := C.hermesPDFPageTexts(cs[0])
	defer C.free(unsafe.Pointer(r))
	s := C.GoString(r)
	if s == "" {
		return nil
	}
	return strings.Split(s, "\f")
}

func cStrings(ss ...string) []*C.char {
	cs := make([]*C.char, len(ss))
	for i, s := range ss {
		cs[i] = C.CString(s)
	}
	return cs
}

func freeCStrings(cs []*C.char) {
	for _, c := range cs {
		C.free(unsafe.Pointer(c))
	}
}
