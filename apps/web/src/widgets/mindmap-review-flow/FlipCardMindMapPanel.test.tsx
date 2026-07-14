import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import {
  editorState,
  getLatestMindMapEditorSurfaceProps,
  renderInRouter,
  setupMindMapReviewFlowTest,
} from '@/widgets/mindmap-review-flow/MindMapReviewFlow.test-support'
import { FlipCardMindMapPanel } from '@/widgets/mindmap-review-flow'

describe('FlipCardMindMapPanel', () => {
  beforeEach(() => {
    setupMindMapReviewFlowTest()
  })

  it('owns the global flip-card viewport and sync invariants without review ratings', () => {
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={false}
        viewMemoryScope="palace-edit:101"
        visibleEditorState={editorState}
        visibleEditorSyncKey="practice-visible-state"
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
      />,
    )

    const surfaceProps = getLatestMindMapEditorSurfaceProps()
    expect(surfaceProps).toMatchObject({
      readonly: true,
      practiceModeActive: true,
      viewMemoryScope: 'palace-edit:101',
      syncIntent: 'soft',
      preserveViewOnSync: true,
      syncReason: 'review_flip',
      externalSyncKey: 'practice-visible-state',
      forceSyncIntent: 'soft',
      initialViewPolicy: 'preserve',
      mobileViewPolicy: 'auto',
      nodeClickViewportPolicy: 'preserve',
    })
    expect(screen.queryByRole('button', { name: '忘记 1' })).toBeNull()
    expect(screen.queryByRole('button', { name: '本轮评分记录' })).toBeNull()
  })
})
