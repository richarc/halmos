import { describe, it, expect } from 'vitest'
import { AGGREGATES, CHART_TYPES, EXTENTS } from './chartSpec'
import { AGGREGATE_LABELS, CHART_TYPE_LABELS, EXTENT_LABELS, FIELD_TYPE_LABELS } from './chartLabels'

describe('chart builder labels', () => {
  it('labels every chart type in menu order', () => {
    expect(CHART_TYPES.map((t) => CHART_TYPE_LABELS[t])).toEqual([
      'Line', 'Bar', 'Point', 'Area', 'Box Plot', 'Strip', 'Stem', 'Histogram', 'Heat Map', 'Error Bar', 'Pie',
    ])
  })

  it('labels field types, aggregates and extents', () => {
    expect(FIELD_TYPE_LABELS).toEqual({ quantitative: 'Number', temporal: 'Date', nominal: 'Category' })
    expect(AGGREGATES.map((a) => AGGREGATE_LABELS[a])).toEqual(['None', 'Average', 'Median', 'Total', 'Count'])
    expect(EXTENTS.map((e) => EXTENT_LABELS[e])).toEqual([
      '95% confidence interval', 'Standard error', 'Standard deviation', 'Interquartile range',
    ])
  })

  it('every label is unique within its list', () => {
    for (const labels of [CHART_TYPE_LABELS, FIELD_TYPE_LABELS, AGGREGATE_LABELS, EXTENT_LABELS]) {
      const values = Object.values(labels)
      expect(new Set(values).size).toBe(values.length)
    }
  })
})
