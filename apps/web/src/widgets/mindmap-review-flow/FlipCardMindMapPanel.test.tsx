import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import {
  editorState,
  getLatestMindMapEditorSurfaceProps,
  renderInRouter,
  setupMindMapReviewFlowTest,
} from '@/widgets/mindmap-review-flow/MindMapReviewFlow.test-support'
import { FlipCardMindMapPanel } from '@/widgets/mindmap-review-flow'

vi.mock('@/entities/mindmap-learning', () => ({
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
    expect(screen.queryByRole('button', { name: '忘记 1' })).toBeNull()
    expect(screen.queryByRole('button', { name: '本轮评分记录' })).toBeNull()
  })

  it('keeps view preservation when switching into edit mode', () => {
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={false}
        displayMode="edit"
        editableEditorState={editorState}
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
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

  it('maps sessionKind and ratingMode onto scene chrome', () => {
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={false}
        sessionKind="review"
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
      />,
    )
    expect(getLatestMindMapEditorSurfaceProps()?.sceneChrome).toBe('review')

    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={false}
        sessionKind="review"
        ratingMode
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        onToggleRatingMode={vi.fn()}
        onRateNode={vi.fn()}
      />,
    )
    expect(getLatestMindMapEditorSurfaceProps()?.sceneChrome).toBe('rating')

    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={false}
        sessionKind="practice"
        displayMode="edit"
        editableEditorState={editorState}
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
      />,
    )
    expect(getLatestMindMapEditorSurfaceProps()?.sceneChrome).toBe('edit')
  })

  it('does not render external rating chrome above the mind map', () => {
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        ratingMode
        onToggleRatingMode={vi.fn()}
        onRateNode={vi.fn()}
      />,
    )

    expect(screen.queryByText(/Space：进入\/退出评分模式/)).toBeNull()
    expect(screen.queryByRole('button', { name: /记得/ })).toBeNull()
  })

  it('exposes selection toolbar actions after a node click in rating mode', async () => {
    const onRateNode = vi.fn()
    const onToggleRatingMode = vi.fn()
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        ratingMode
        onToggleRatingMode={onToggleRatingMode}
        onRateNode={onRateNode}
        onUndoRating={vi.fn(() => ({ node_uid: 'grandchild' }))}
      />,
    )

    expect(screen.getByRole('button', { name: '评分' })).toBeTruthy()
    expect(getLatestMindMapEditorSurfaceProps()?.selectionToolbarPreferPosition).toBe('bottom')

    await act(async () => {
      getLatestMindMapEditorSurfaceProps()?.onNodeClick?.([{ uid: 'grandchild', text: 'Grandchild' }])
    })

    const actions = getLatestMindMapEditorSurfaceProps()?.buildSelectionToolbarActions?.('grandchild') ?? []
    expect(actions.map((action: { id: string }) => action.id)).toEqual([
      'undo',
      'rate-1',
      'rate-2',
      'rate-3',
      'rate-4',
    ])

    const remember = actions.find((action: { id: string }) => action.id === 'rate-3')
    remember?.onClick()
    expect(onRateNode).toHaveBeenCalledWith(
      'grandchild',
      3,
      'first',
      'single',
      expect.any(Object),
      'overwrite',
    )
  })

  it('allows rating the root node with subtree scope when it has children', async () => {
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
        onUndoRating={vi.fn()}
      />,
    )

    await act(async () => {
      getLatestMindMapEditorSurfaceProps()?.onNodeClick?.([{ uid: 'root', text: 'Root' }])
    })

    const actions = getLatestMindMapEditorSurfaceProps()?.buildSelectionToolbarActions?.('root') ?? []
    expect(actions.some((action: { id: string }) => action.id === 'rate-3')).toBe(true)

    const remember = actions.find((action: { id: string }) => action.id === 'rate-3')
    remember?.onClick()
    expect(onRateNode).toHaveBeenCalledWith(
      'root',
      3,
      'first',
      'subtree',
      expect.any(Object),
      'overwrite',
    )
  })

  it('asks overwrite or skip when subtree rating hits direct-rated children', async () => {
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
        directRatedUids={new Set(['grandchild'])}
      />,
    )

    await act(async () => {
      getLatestMindMapEditorSurfaceProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })

    const actions = getLatestMindMapEditorSurfaceProps()?.buildSelectionToolbarActions?.('child') ?? []
    const remember = actions.find((action: { id: string }) => action.id === 'rate-3')
    await act(async () => {
      remember?.onClick()
    })

    expect(onRateNode).not.toHaveBeenCalled()
    expect(screen.getByTestId('rating-conflict-dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: '避开' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '覆盖' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '避开' }))
    expect(onRateNode).toHaveBeenCalledWith(
      'child',
      3,
      'first',
      'subtree',
      expect.any(Object),
      'skip_direct',
    )
  })

  it('overwrite path applies subtree rating after conflict confirmation', async () => {
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
        directRatedUids={new Set(['grandchild'])}
      />,
    )

    await act(async () => {
      getLatestMindMapEditorSurfaceProps()?.onNodeClick?.([{ uid: 'root', text: 'Root' }])
    })
    const actions = getLatestMindMapEditorSurfaceProps()?.buildSelectionToolbarActions?.('root') ?? []
    await act(async () => {
      actions.find((action: { id: string }) => action.id === 'rate-4')?.onClick()
    })
    fireEvent.click(screen.getByRole('button', { name: '覆盖' }))
    expect(onRateNode).toHaveBeenCalledWith(
      'root',
      4,
      'first',
      'subtree',
      expect.any(Object),
      'overwrite',
    )
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
