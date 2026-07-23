import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import {
  editorState,
  getLatestMindMapEditorSurfaceProps,
  renderInRouter,
  setupMindMapReviewFlowTest,
} from '@/widgets/mindmap-review-flow/MindMapReviewFlow.test-support'
import { FlipCardMindMapPanel } from '@/widgets/mindmap-review-flow'

vi.mock('@/modules/content/domain/mindmap-learning-entity', () => ({
  listMindMapNodeMasteryApi: vi.fn(async () => ({
    items: [
      {
        node_uid: 'child',
        status: 'reinforce',
        mastery_score: 64,
        evidence_summary: { event_count: 2 },
      },
    ],
  })),
}))

describe('FlipCardMindMapPanel', () => {
  beforeEach(() => {
    setupMindMapReviewFlowTest()
  })

  // Split from FlipCardMindMapPanel.test.tsx to stay under architecture size gate.

  it('asks overwrite or skip when re-rating after only batch_inherited descendants', async () => {
    // Parent cascade marks children batch_inherited (not direct). Re-rating the
    // same parent must still open 覆盖/避开 — not silent overwrite.
    const onRateNode = vi.fn()
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        ratingMode
        onRateNode={onRateNode}
        directRatedUids={new Set()}
        sessionRatedUids={new Set(['grandchild'])}
      />,
    )

    await act(async () => {
      getLatestMindMapEditorSurfaceProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    const actions = getLatestMindMapEditorSurfaceProps()?.buildSelectionToolbarActions?.('child') ?? []
    await act(async () => {
      actions.find((action: { id: string }) => action.id === 'rate-4')?.onClick()
    })

    expect(onRateNode).not.toHaveBeenCalled()
    expect(screen.getByTestId('rating-conflict-dialog')).toBeTruthy()
    expect(screen.getByText(/已有节点被评分/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '覆盖' }))
    expect(onRateNode).toHaveBeenCalledWith(
      'child',
      4,
      'first',
      'subtree',
      expect.any(Object),
      'overwrite',
      ['child', 'grandchild'],
    )
  })

  it('never collapses or context-hides cards after any rating (score-only mode)', async () => {
    const onRateNode = vi.fn()
    const onNodeContextMenu = vi.fn()
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={onNodeContextMenu}
        ratingMode
        onRateNode={onRateNode}
      />,
    )

    // Rating mode must not wire long-press/right-click hide (PWA accidental collapse).
    expect(getLatestMindMapEditorSurfaceProps()?.onNodeContextMenu).toBeUndefined()

    await act(async () => {
      getLatestMindMapEditorSurfaceProps()?.onNodeClick?.([{ uid: 'grandchild', text: 'Grandchild' }])
    })
    const actions = getLatestMindMapEditorSurfaceProps()?.buildSelectionToolbarActions?.('grandchild') ?? []

    for (const id of ['rate-2', 'rate-1', 'rate-3', 'rate-4'] as const) {
      await act(async () => {
        actions.find((action: { id: string }) => action.id === id)?.onClick()
      })
    }
    expect(onRateNode).toHaveBeenCalled()
    // Ratings must not drive collapse / hide via context menu.
    expect(onNodeContextMenu).not.toHaveBeenCalled()
  })

  it('builds dual status chips for session rating and long-term mastery score', async () => {
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        currentPalaceId={7}
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        ratingMode
        onRateNode={vi.fn()}
        recallRatings={new Map([['child', 3]])}
      />,
    )

    await waitFor(() => {
      const chips = getLatestMindMapEditorSurfaceProps()?.statusChipsByNodeUid
      expect(chips?.child).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: '记得', style: 'filled' }),
          expect.objectContaining({ text: '64', style: 'outline' }),
        ]),
      )
    })
  })

  it('embeds rating mode action into the canvas toolbar content', () => {
    const onToggleRatingMode = vi.fn()
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={false}
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        onToggleRatingMode={onToggleRatingMode}
        onRateNode={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '评分' }))
    expect(onToggleRatingMode).toHaveBeenCalledTimes(1)
    expect(getLatestMindMapEditorSurfaceProps()?.toolbarContent).toBeTruthy()
  })

  it('offers palace calibration from the toolbar when provided', () => {
    const onOpenPalaceCalibration = vi.fn()
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={false}
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        onOpenPalaceCalibration={onOpenPalaceCalibration}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '宫殿进度校准' }))
    expect(onOpenPalaceCalibration).toHaveBeenCalledTimes(1)
  })

  it('reports mobile next navigation as an active learning interaction', async () => {
    const onNodeActive = vi.fn()
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={false}
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        onNodeActive={onNodeActive}
        onRateNode={vi.fn()}
      />,
    )

    await waitFor(() => expect(onNodeActive).toHaveBeenCalled())
    onNodeActive.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '下一个' }))
    expect(onNodeActive).toHaveBeenCalledWith([
      expect.objectContaining({ uid: 'grandchild' }),
    ])
  })
})
