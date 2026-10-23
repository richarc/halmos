import { describe, it, expect } from 'vitest'
import { AGGREGATES, CHART_TYPES, EXTENTS } from './chartSpec'
import { AGGREGATE_LABELS, CHART_TYPE_LABELS, EXTENT_LABELS, FIELD_TYPE_LABELS, refusalMessage } from './chartLabels'

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

describe('refusalMessage', () => {
  it.each([
    [['transform'], 'That chart filters or calculates its data ("transform"), which the builder can\'t edit yet.'],
    [['layer'], 'That chart draws one chart over another ("layer"), which the builder can\'t edit yet.'],
    [['data'], 'That chart reads its data from a file or a web address, which the builder can\'t edit yet.'],
    [['data.values'], "That chart has data that can't be shown as a table, which the builder can't edit yet."],
    [['mark'], "That chart uses a kind of mark the builder doesn't offer, which the builder can't edit yet."],
    [['mark.orient'], 'That chart sets the mark\'s "orient", which the builder can\'t edit yet.'],
    [['encoding.x.timeUnit'], 'That chart sets "timeUnit" on the x axis, which the builder can\'t edit yet.'],
    [['encoding.size'], 'That chart uses the "size" channel, which the builder can\'t edit yet.'],
    [['(root)'], "That chart is not a single chart, which the builder can't edit yet."],
    [['spacing'], 'That chart uses "spacing", which the builder can\'t edit yet.'],
  ])('describes %j', (paths, message) => {
    expect(refusalMessage(paths)).toBe(message)
  })

  it('names at most two things, once each', () => {
    expect(refusalMessage(['layer', 'transform', 'data'])).toBe(
      'That chart draws one chart over another ("layer") and filters or calculates its data ("transform"), which the builder can\'t edit yet.',
    )
    expect(refusalMessage(['encoding.x.bin', 'encoding.x.bin', 'transform'])).toBe(
      'That chart sets "bin" on the x axis and filters or calculates its data ("transform"), which the builder can\'t edit yet.',
    )
  })
})
