import { describe, expect, it } from 'vitest'
import { createMindMapCapabilities } from './capabilities'

function buildCapabilities() {
  return createMindMapCapabilities({
    segments: [],
    activeSegmentId: null,
    segmentColorMode: 'all',
    segmentRangeDraft: {
      active: false,
      targetSegmentId: null,
      selectedNodeUids: [],
      overriddenConflictNodeUids: [],
    },
    highlightedNodeUids: [],
    masteryByNodeUid: {},
    practiceModeActive: false,
  })
}

describe('mind map capabilities', () => {
  it('keeps search and mastery decorations for editing', () => {
    expect(buildCapabilities().map((item) => item.key)).toEqual([
      'search-decoration',
      'mastery-decoration',
    ])
  })
})
