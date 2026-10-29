---
title: "Getting Started with Halmos"
bibliography: getting-started.bib
csl: apa
---

# Welcome

This is your copy of the Getting Started tutorial. It is an ordinary
Markdown document in a folder of its own, beside its bibliography
(`getting-started.bib`) and a small data set (`rainfall.csv`). Change
anything you like: nothing here can break.

Each section shows a finished example, then gives you a few tasks to do in
this document, just below them. When Halmos sees a task done, it ticks it
in the preview on the right.

Every command has a name. Press **⇧⌘P** to open the command palette, type
a few letters of what you want ("chart", "cite", "table") and press Return.
The tasks below name the command to look for.

# Equations

Maths is written in LaTeX between dollar signs. One dollar sign on each
side keeps it in the line: the area of a circle is $A = \pi r^2$. Two on
each side give it a line of its own, and a label after it gives it a
number:

$$
\bar{x} = \frac{1}{n} \sum_{i=1}^{n} x_i
$$ {#eq:mean}

Your turn. Write below the tasks, before the next heading.

- [ ] Write an equation inside a sentence, between single dollar signs. <!-- check: inline-math -->
- [ ] Write an equation on its own line, between `$$` and `$$`. <!-- check: display-math -->

# Charts

A chart is written as a short description of the data and how to draw it,
and Halmos draws it. You never have to write one by hand: the chart builder
writes it for you.

```vega-lite {#fig:rainfall}
{
  "title": "Average monthly rainfall",
  "data": {"values": [
    {"Month": "Jan", "City": "London", "Rainfall (mm)": 55},
    {"Month": "Feb", "City": "London", "Rainfall (mm)": 41},
    {"Month": "Mar", "City": "London", "Rainfall (mm)": 42},
    {"Month": "Apr", "City": "London", "Rainfall (mm)": 44},
    {"Month": "May", "City": "London", "Rainfall (mm)": 49},
    {"Month": "Jun", "City": "London", "Rainfall (mm)": 45},
    {"Month": "Jul", "City": "London", "Rainfall (mm)": 45},
    {"Month": "Aug", "City": "London", "Rainfall (mm)": 50},
    {"Month": "Sep", "City": "London", "Rainfall (mm)": 49},
    {"Month": "Oct", "City": "London", "Rainfall (mm)": 69},
    {"Month": "Nov", "City": "London", "Rainfall (mm)": 59},
    {"Month": "Dec", "City": "London", "Rainfall (mm)": 55}
  ]},
  "mark": "bar",
  "encoding": {
    "x": {"field": "Month", "type": "ordinal", "sort": null},
    "y": {"field": "Rainfall (mm)", "type": "quantitative"}
  }
}
```

Your turn. Put the cursor on an empty line below the tasks, then open the
palette and choose **Insert: Chart…**. Click **Choose File…** and pick
`rainfall.csv`, which sits beside this document. Choose a type, `Month`
for the horizontal axis, `Rainfall (mm)` for the vertical one and `City`
to split by, and click **Insert**.

- [ ] Insert a chart of `rainfall.csv` with **Insert: Chart…**. <!-- check: chart -->

# Citations

A citation names a work in the bibliography by its key, in square
brackets: literate programming [@knuth1984literate] treats a program as a
piece of writing. Halmos formats it in the document's style (APA here, set
by `csl:` at the top) and lists the work under References at the end.

Your turn. Write a sentence below the tasks, then open the palette and
choose **Insert: Citation…** (or type `[@`) and pick a work from the
list.

- [ ] Cite a work from `getting-started.bib` with **Insert: Citation…**. <!-- check: citation -->

# Tables

A table is written with pipes and dashes. A line starting with a colon just
after it is its caption, and a label numbers it:

| City      | Wettest month | Rainfall (mm) |
|-----------|---------------|--------------:|
| London    | October       |            69 |
| Edinburgh | October       |            79 |

: The wettest month in each city {#tbl:wettest}

Your turn. Open the palette and choose **Insert: Table…** (⇧⌘T). Fill in
a few cells and click **Insert**. Then add a caption: a blank line after
the table, and a line that starts with a colon and a space.

- [ ] Insert a table with **Insert: Table…** and give it a caption. <!-- check: table-caption -->

# Cross-references

A cross-reference points at a numbered figure, table or equation, and
Halmos fills in the number: the rainfall is shown in @fig:rainfall, the
wettest months are in @tbl:wettest, and the mean is @eq:mean. Move a
figure and its number follows.

Your turn. Below the tasks, open the palette and choose **Insert:
Cross-reference…** (⇧⌘R), or type `@fig:`, `@tbl:` or `@eq:` and pick
from the list. Any figure, table or equation in this document will do,
including your own.

- [ ] Refer to a figure. <!-- check: ref-fig -->
- [ ] Refer to a table. <!-- check: ref-tbl -->
- [ ] Refer to an equation. <!-- check: ref-eq -->

# Next steps

- **File → New…** starts a document of your own, with a bibliography and a
  starter for an article, a thesis and more.
- **Format → Citation Style → Find a Style…** finds the style your journal
  asks for, from over 10,000.
- **Export** makes a PDF or a web page, or Word and LaTeX with a Halmos
  account.
- The guides at [halmoseditor.com/guides](https://www.halmoseditor.com/guides)
  cover everything else.
