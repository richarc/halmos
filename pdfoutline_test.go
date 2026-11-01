package main

import (
	"reflect"
	"strings"
	"testing"
)

func h(level int, text string) PDFHeading { return PDFHeading{Level: level, Text: text, Match: text} }

func pageOf(lines ...string) string { return strings.Join(lines, "\n") }

const body = "Lorem ipsum dolor sit amet, consectetur adipiscing elit."

func TestAssignPagesFindsEachHeadingOnItsPage(t *testing.T) {
	pages := []string{
		pageOf("Introduction", body),
		pageOf(body, "Method", body),
		pageOf(body, body, "Results", body),
	}
	got := assignPages([]PDFHeading{h(1, "Introduction"), h(2, "Method"), h(1, "Results")}, pages, false)
	if want := []int{1, 2, 3}; !reflect.DeepEqual(got, want) {
		t.Fatalf("pages %v, want %v", got, want)
	}
}

func TestAssignPagesSkipsAnEarlierMention(t *testing.T) {
	pages := []string{
		pageOf("Introduction", body),
		pageOf("As the Results section shows, the method holds.", body),
		pageOf(body),
		pageOf(body, "Results", body),
	}
	got := assignPages([]PDFHeading{h(1, "Introduction"), h(1, "Results")}, pages, false)
	if want := []int{1, 4}; !reflect.DeepEqual(got, want) {
		t.Fatalf("pages %v, want %v", got, want)
	}
}

func TestAssignPagesSkipsTheContentsList(t *testing.T) {
	// The contents list and the first chapter share page 1, as in a real
	// export: the list's entries are skipped, the page is not.
	pages := []string{
		pageOf("Contents", "Chapter 1 Results", "Chapter 2 Results", "Chapter 3 Results", "See example.com.", "Chapter 1 Results", body),
		pageOf(body, "Chapter 2 Results", body),
		pageOf(body, "Chapter 3 Results", body),
	}
	hs := []PDFHeading{h(1, "Chapter 1 Results"), h(1, "Chapter 2 Results"), h(1, "Chapter 3 Results")}
	if got, want := assignPages(hs, pages, true), []int{1, 2, 3}; !reflect.DeepEqual(got, want) {
		t.Fatalf("with contents: pages %v, want %v", got, want)
	}
}

func TestAssignPagesContentsEntryThatWraps(t *testing.T) {
	long := "A rather long chapter title that the contents list has to wrap"
	pages := []string{
		pageOf("Contents", "A rather long chapter title that the", "contents list has to wrap", "Short", body),
		pageOf(body, "A rather long chapter title that the", "contents list has to wrap", body),
		pageOf(body, "Short", body),
	}
	if got, want := assignPages([]PDFHeading{h(1, long), h(1, "Short")}, pages, true), []int{2, 3}; !reflect.DeepEqual(got, want) {
		t.Fatalf("pages %v, want %v", got, want)
	}
}

func TestAssignPagesWrappedHeading(t *testing.T) {
	pages := []string{
		pageOf(body),
		pageOf(body, "The effect of temperature on the", "rate of reaction", body),
	}
	got := assignPages([]PDFHeading{h(1, "The effect of temperature on the rate of reaction")}, pages, false)
	if want := []int{2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("pages %v, want %v", got, want)
	}
}

func TestAssignPagesSameTextTwice(t *testing.T) {
	pages := make([]string, 10)
	for i := range pages {
		pages[i] = pageOf(body)
	}
	pages[2] = pageOf("Introduction", body)
	pages[8] = pageOf(body, "Introduction", body)
	got := assignPages([]PDFHeading{h(1, "Introduction"), h(1, "Introduction")}, pages, false)
	if want := []int{3, 9}; !reflect.DeepEqual(got, want) {
		t.Fatalf("pages %v, want %v", got, want)
	}
}

func TestAssignPagesTwoHeadingsOnOnePage(t *testing.T) {
	pages := []string{pageOf("One", body, "Two", body), pageOf("Three")}
	if got, want := assignPages([]PDFHeading{h(1, "One"), h(2, "Two"), h(1, "Three")}, pages, false), []int{1, 1, 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("pages %v, want %v", got, want)
	}
}

func TestAssignPagesNoMatchTakesThePreviousPage(t *testing.T) {
	pages := []string{pageOf(body), pageOf(body, "Method", body), pageOf(body)}
	hs := []PDFHeading{
		{Level: 1, Text: "$E=mc^2$", Match: ""}, // maths only: nothing to match
		h(1, "Method"),
		h(2, "Not in the PDF"),
	}
	if got, want := assignPages(hs, pages, false), []int{1, 2, 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("pages %v, want %v", got, want)
	}
}

func TestAssignPagesNormalisesCaseSpacesHyphensAndLigatures(t *testing.T) {
	pages := []string{pageOf(body), pageOf("EFFICIENT   ﬁeld", "meth-", "ods", body)}
	if got, want := assignPages([]PDFHeading{h(1, "Efficient field methods")}, pages, false), []int{2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("pages %v, want %v", got, want)
	}
}

func TestAssignPagesNoPages(t *testing.T) {
	if got := assignPages([]PDFHeading{h(1, "A")}, nil, false); !reflect.DeepEqual(got, []int{1}) {
		t.Fatalf("pages %v, want [1]", got)
	}
}

func TestNestOutline(t *testing.T) {
	hs := []PDFHeading{h(1, "A"), h(2, "A.1"), h(2, "A.2"), h(1, "B"), h(3, "B.x")}
	got := nestOutline(hs, []int{1, 2, 3, 4, 5})
	want := []outlineNode{
		{Title: "A", Page: 1, Kids: []outlineNode{{Title: "A.1", Page: 2}, {Title: "A.2", Page: 3}}},
		{Title: "B", Page: 4, Kids: []outlineNode{{Title: "B.x", Page: 5}}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

func TestNestOutlineStartsDeeperThanLevelOne(t *testing.T) {
	got := nestOutline([]PDFHeading{h(2, "A"), h(3, "A.1"), h(1, "B")}, []int{1, 1, 2})
	want := []outlineNode{{Title: "A", Page: 1, Kids: []outlineNode{{Title: "A.1", Page: 1}}}, {Title: "B", Page: 2}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

func TestNestOutlineNoHeadings(t *testing.T) {
	if got := nestOutline(nil, nil); got != nil {
		t.Fatalf("got %+v, want nil", got)
	}
}
