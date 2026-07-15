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
  it('offers explicit parallel and hierarchy modes for non-root leaf cards', () => {
    const { capability, onAiSplitRequest } = buildAiCapability()
    const actions = capability?.getNodeActions?.({
      nodeId: 'target-node',
      selection: [{ uid: 'target-node', text: '长内容', note: '', memoryAnkiId: null, memoryAnkiNodeType: 'peg', rawData: {} }],
      isRoot: false,
      readonly: false,
      practiceModeActive: false,
    }) ?? []

    expect(actions.map((action) => action.label)).toEqual(['AI 并列分卡', 'AI 层级分卡'])
    actions[0]?.onClick()
    actions[1]?.onClick()
    expect(onAiSplitRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({ split_mode: 'parallel' }))
    expect(onAiSplitRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({ split_mode: 'hierarchy' }))
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
