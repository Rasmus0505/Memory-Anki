import { describe, expect, it, vi } from 'vitest'
import { createMindMapCapabilities } from './capabilities'

function buildAiCapability(onAiSplitRequest = vi.fn()) {
  const capabilities = createMindMapCapabilities({
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
    aiSplitBusy: false,
    onAiSplitRequest,
  })
  return {
    capability: capabilities.find((item) => item.key === 'ai-split'),
    onAiSplitRequest,
  }
}

describe('AI split capability', () => {
  it('offers a single auto AI split action for non-root leaf cards', () => {
    const { capability, onAiSplitRequest } = buildAiCapability()
    const actions = capability?.getNodeActions?.({
      nodeId: 'target-node',
      selection: [{ uid: 'target-node', text: '长内容', note: '', memoryAnkiId: null, memoryAnkiNodeType: 'peg', rawData: {} }],
      isRoot: false,
      readonly: false,
      practiceModeActive: false,
    }) ?? []

    expect(actions.map((action) => action.label)).toEqual(['AI 分卡'])
    actions[0]?.onClick()
    expect(onAiSplitRequest).toHaveBeenCalledWith(expect.objectContaining({ split_mode: 'auto' }))
  })

  it('does not expose replacement split actions for the root', () => {
    const { capability } = buildAiCapability()
    const actions = capability?.getNodeActions?.({
      nodeId: 'root',
      selection: [],
      isRoot: true,
      readonly: false,
      practiceModeActive: false,
    }) ?? []

    expect(actions).toEqual([])
  })
})
