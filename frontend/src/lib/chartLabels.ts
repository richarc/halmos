// What the chart builder shows for each choice. Display only: the option
// values, and so the specs written into documents, stay Vega-Lite's own
// names, which is why charts made before these labels existed open unchanged.
import type { Aggregate, ChartType, Extent } from './chartSpec'
import type { FieldType } from './dataTable'

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  line: 'Line',
  bar: 'Bar',
  point: 'Point',
  area: 'Area',
  boxplot: 'Box Plot',
  // Vega-Lite's tick and rule marks are a strip plot and a stem plot here
  // (see PLAIN_MARKS in chartSpec.ts); their own names describe neither.
  tick: 'Strip',
  rule: 'Stem',
  histogram: 'Histogram',
  heatmap: 'Heat Map',
  errorbar: 'Error Bar',
  pie: 'Pie',
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  quantitative: 'Number',
  temporal: 'Date',
  nominal: 'Category',
}

export const AGGREGATE_LABELS: Record<Aggregate, string> = {
  none: 'None',
  mean: 'Average',
  median: 'Median',
  sum: 'Total',
  count: 'Count',
}

// Vega-Lite's `ci` is a 95% bootstrapped confidence interval.
export const EXTENT_LABELS: Record<Extent, string> = {
  ci: '95% confidence interval',
  stderr: 'Standard error',
  stdev: 'Standard deviation',
  iqr: 'Interquartile range',
}

const CHANNEL_NAMES: Record<string, string> = {
  x: 'x axis',
  y: 'y axis',
  color: 'colour',
  theta: 'slice size',
}

const TOP_LEVEL_PHRASES: Record<string, string> = {
  layer: 'draws one chart over another ("layer")',
  transform: 'filters or calculates its data ("transform")',
  facet: 'splits into several panels ("facet")',
  repeat: 'repeats itself in several panels ("repeat")',
  concat: 'puts several charts side by side ("concat")',
  hconcat: 'puts several charts side by side ("hconcat")',
  vconcat: 'stacks several charts ("vconcat")',
  params: 'responds to clicks or selections ("params")',
  selection: 'responds to clicks or selections ("selection")',
}

/** One differing path from readSpec, as a phrase that follows "That chart". */
function refusalPhrase(path: string): string {
  const [head, second, third] = path.split('.')
  if (path === '(root)') return 'is not a single chart'
  if (head === 'data') {
    if (second === undefined) return 'reads its data from a file or a web address'
    if (second === 'values') return "has data that can't be shown as a table"
    return `reads its data with a setting the builder doesn't offer ("${second}")`
  }
  if (head === 'mark') {
    return second === undefined
      ? "uses a kind of mark the builder doesn't offer"
      : `sets the mark's "${second}"`
  }
  if (head === 'encoding' && second !== undefined) {
    const channel = CHANNEL_NAMES[second]
    if (!channel) return `uses the "${second}" channel`
    return third === undefined ? `sets the ${channel} in a way the builder doesn't offer` : `sets "${third}" on the ${channel}`
  }
  return TOP_LEVEL_PHRASES[head] ?? `uses "${head}"`
}

/**
 * The toast for a chart readSpec refused, naming at most two of the things it
 * could not keep. The setting's own name is quoted so the author can find it
 * in the block.
 */
export function refusalMessage(unconsumed: readonly string[]): string {
  const phrases = [...new Set(unconsumed.map(refusalPhrase))].slice(0, 2)
  if (phrases.length === 0) return "That chart can't be opened in the builder."
  return `That chart ${phrases.join(' and ')}, which the builder can't edit yet.`
}
