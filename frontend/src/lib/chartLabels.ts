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
