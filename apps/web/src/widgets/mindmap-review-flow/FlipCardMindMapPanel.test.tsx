import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import {
  editorState,
  getLatestMindMapEditorSurfaceProps,
  renderInRouter,
  setupMindMapReviewFlowTest,
} from './MindMapReviewFlow.test-support'
import { FlipCardMindMapPanel } from './FlipCardMindMapPanel'
import type { MindMapEditorState } from '@/shared/api/contracts'

const baseProps = {
  fullscreen: false,
  visibleEditorState: editorState,
  onToggleFullscreen: vi.fn(),
  onNodeClick: vi.fn(),
  onNodeContextMenu: vi.fn(),
}

describe('FlipCardMindMapPanel', () => {
  beforeEach(() => {
    setupMindMapReviewFlowTest()
  })

  it('owns the flip-card viewport without node-rating chrome', () => {
    renderInRouter(
      <FlipCardMindMapPanel
        {...baseProps}
        viewMemoryScope="palace-edit:101"
        visibleEditorSyncKey="practice-visible-state"
      />,
    )

    expect(getLatestMindMapEditorSurfaceProps()).toMatchObject({
      readonly: true,
      practiceModeActive: true,
      sceneChrome: 'practice',
      sceneTransitionKey: 'practice:review:practice',
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
    expect(screen.queryByRole('button', { name: '评分' })).toBeNull()
    expect(screen.queryByRole('button', { name: '宫殿进度校准' })).toBeNull()
  })

  it('keeps view preservation when switching into edit mode', () => {
    renderInRouter(
      <FlipCardMindMapPanel
        {...baseProps}
        displayMode="edit"
        editableEditorState={editorState}
      />,
    )

    expect(getLatestMindMapEditorSurfaceProps()).toMatchObject({
      readonly: false,
      practiceModeActive: false,
      sceneChrome: 'edit',
      sceneTransitionKey: 'edit:edit:practice',
      preserveViewOnSync: true,
      initialViewPolicy: 'preserve',
      forceSyncIntent: 'soft',
    })
  })

  it('maps formal unit display onto review scene chrome', () => {
    renderInRouter(<FlipCardMindMapPanel {...baseProps} sessionKind="review" />)

    expect(getLatestMindMapEditorSurfaceProps()?.sceneChrome).toBe('review')
  })

  it('dims nodes outside the current permanent-mark unit while preserving its ancestor path', () => {
    const state = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root' },
          children: [
            {
              data: { text: 'Unit parent', uid: 'parent' },
              children: [{ data: { text: 'Unit card', uid: 'unit-card' }, children: [] }],
            },
            { data: { text: 'Other branch', uid: 'other' }, children: [] },
          ],
        },
      },
    } as MindMapEditorState

    renderInRouter(
      <FlipCardMindMapPanel
        {...baseProps}
        visibleEditorState={state}
        activeUnitNodeUids={['unit-card']}
      />,
    )

    expect(getLatestMindMapEditorSurfaceProps()?.mutedNodeUids).toEqual(['other'])
  })
})
