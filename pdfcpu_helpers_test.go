package main

// Reading back what pdfcpu wrote, for the outline tests.

import (
	"context"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

func readContext(t *testing.T, path string) *model.Context {
	t.Helper()
	ctx, err := api.ReadContextFile(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	return ctx
}

// linksPerPage counts the Link annotations on each page.
func linksPerPage(t *testing.T, path string) []int {
	t.Helper()
	ctx := readContext(t, path)
	counts := make([]int, ctx.PageCount)
	for i := 1; i <= ctx.PageCount; i++ {
		d, _, _, err := ctx.PageDict(context.Background(), i, false)
		if err != nil {
			t.Fatal(err)
		}
		arr, err := ctx.DereferenceArray(d["Annots"])
		if err != nil {
			t.Fatal(err)
		}
		for _, o := range arr {
			ad, err := ctx.DereferenceDict(o)
			if err != nil || ad == nil {
				continue
			}
			if st := ad.NameEntry("Subtype"); st != nil && *st == "Link" {
				counts[i-1]++
			}
		}
	}
	return counts
}

func info(t *testing.T, path string, key string) string {
	t.Helper()
	ctx := readContext(t, path)
	d, err := ctx.DereferenceDict(*ctx.Info)
	if err != nil || d == nil {
		t.Fatalf("no Info dictionary: %v", err)
	}
	o, err := ctx.Dereference(d[key])
	if err != nil || o == nil {
		return ""
	}
	switch v := o.(type) {
	case types.StringLiteral:
		s, _ := types.StringLiteralToString(v)
		return s
	case types.HexLiteral:
		s, _ := types.HexLiteralToString(v)
		return s
	}
	return ""
}
