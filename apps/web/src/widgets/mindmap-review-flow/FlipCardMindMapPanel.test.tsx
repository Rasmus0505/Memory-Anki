import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
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
    expect(screen.queryByRole('button', { name: '宫殿进度校准' })).toBeNull()
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

  it('dims out-of-scope nodes while flipping (not only in rating mode)', () => {
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        sessionKind="review"
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        ratingMode={false}
        rateableNodeUids={['child']}
      />,
    )

    expect(getLatestMindMapEditorSurfaceProps()?.mutedNodeUids).toEqual(
      expect.arrayContaining(['grandchild']),
    )
    expect(getLatestMindMapEditorSurfaceProps()?.mutedNodeUids).not.toContain('child')
    expect(getLatestMindMapEditorSurfaceProps()?.mutedNodeUids).not.toContain('root')
  })

  it('keeps ancestors of due nodes full opacity when only descendants are rateable', () => {
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        sessionKind="review"
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        ratingMode={false}
        rateableNodeUids={['grandchild']}
      />,
    )

    const muted = getLatestMindMapEditorSurfaceProps()?.mutedNodeUids ?? []
    // Due leaf stays unmuted; its parent path must also stay unmuted.
    expect(muted).not.toContain('grandchild')
    expect(muted).not.toContain('child')
    expect(muted).not.toContain('root')
  })

  it('mutes out-of-scope nodes but still allows rating them in rating mode', async () => {
    const onRateNode = vi.fn()
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        sessionKind="review"
        visibleEditorState={editorState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        ratingMode
        rateableNodeUids={['child']}
        onRateNode={onRateNode}
        onUndoRating={vi.fn()}
      />,
    )

    expect(getLatestMindMapEditorSurfaceProps()?.mutedNodeUids).toEqual(
      expect.arrayContaining(['grandchild']),
    )
    expect(getLatestMindMapEditorSurfaceProps()?.mutedNodeUids).not.toContain('child')

    await act(async () => {
      getLatestMindMapEditorSurfaceProps()?.onNodeClick?.([{ uid: 'grandchild', text: 'Grandchild' }])
    })
    const outOfScope =
      getLatestMindMapEditorSurfaceProps()?.buildSelectionToolbarActions?.('grandchild') ?? []
    // Soft-dim only — non-due cards still expose 忘/难/记/轻.
    expect(outOfScope.map((action: { id: string }) => action.id)).not.toContain('out-of-scope')
    expect(outOfScope.some((action: { id: string }) => action.id.startsWith('rate-'))).toBe(true)
    const rateOutOfScope = outOfScope.find((action: { id: string }) => action.id === 'rate-3')
    await act(async () => {
      rateOutOfScope?.onClick()
    })
    expect(onRateNode).toHaveBeenCalledWith(
      'grandchild',
      3,
      'first',
      'single',
      expect.any(Object),
      'overwrite',
      ['grandchild'],
    )

    await act(async () => {
      getLatestMindMapEditorSurfaceProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    const inScope = getLatestMindMapEditorSurfaceProps()?.buildSelectionToolbarActions?.('child') ?? []
    // Parent still cascades on the full rating tree even when only the parent is due.
    expect(inScope.some((action: { id: string; label: string }) => action.id === 'rate-3' && action.label.includes('2'))).toBe(
      true,
    )
    const remember = inScope.find((action: { id: string }) => action.id === 'rate-3')
    await act(async () => {
      remember?.onClick()
    })
    // Parent with children always opens the scope dialog first.
    expect(onRateNode).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '级联评分子树' }))
    expect(onRateNode).toHaveBeenCalledWith(
      'child',
      3,
      'first',
      'subtree',
      expect.any(Object),
      'overwrite',
      ['child', 'grandchild'],
    )
  })

  it('keeps visible parents unmuted when only unrevealed descendants are due', () => {
    const visibleOnlyParent: typeof editorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root' },
          children: [{ data: { text: 'Child', uid: 'child' }, children: [] }],
        },
      },
      editor_fingerprint: 'visible-parent-unrevealed-due',
    }
    const fullTree: typeof editorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root' },
          children: [
            {
              data: { text: 'Child', uid: 'child' },
              children: [{ data: { text: 'Grandchild', uid: 'grandchild' }, children: [] }],
            },
          ],
        },
      },
      editor_fingerprint: 'full-tree-unrevealed-due',
    }

    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        sessionKind="review"
        visibleEditorState={visibleOnlyParent}
        ratingTreeEditorState={fullTree}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        ratingMode={false}
        rateableNodeUids={['grandchild']}
      />,
    )

    const muted = getLatestMindMapEditorSurfaceProps()?.mutedNodeUids ?? []
    // Parent is on the path to an unrevealed due child — do not soft-dim it.
    expect(muted).not.toContain('child')
    expect(muted).not.toContain('root')
  })

  it('cascades formal parent rating onto unrevealed children via ratingTreeEditorState', async () => {
    const onRateNode = vi.fn()
    const visibleOnlyParent: typeof editorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root' },
          children: [{ data: { text: 'Child', uid: 'child' }, children: [] }],
        },
      },
      editor_fingerprint: 'visible-only-parent',
    }
    const fullTree: typeof editorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root' },
          children: [
            {
              data: { text: 'Child', uid: 'child' },
              children: [{ data: { text: 'Grandchild', uid: 'grandchild' }, children: [] }],
            },
          ],
        },
      },
      editor_fingerprint: 'full-rating-tree',
    }

    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        sessionKind="review"
        visibleEditorState={visibleOnlyParent}
        ratingTreeEditorState={fullTree}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        ratingMode
        rateableNodeUids={['child', 'grandchild']}
        onRateNode={onRateNode}
        onUndoRating={vi.fn()}
      />,
    )

    // Unrevealed due grandchild is not on the visible tree, so it must not be muted as out-of-scope.
    expect(getLatestMindMapEditorSurfaceProps()?.mutedNodeUids ?? []).not.toContain('grandchild')
    expect(getLatestMindMapEditorSurfaceProps()?.mutedNodeUids ?? []).not.toContain('child')

    await act(async () => {
      getLatestMindMapEditorSurfaceProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    const actions = getLatestMindMapEditorSurfaceProps()?.buildSelectionToolbarActions?.('child') ?? []
    const remember = actions.find((action: { id: string }) => action.id === 'rate-3')
    await act(async () => {
      remember?.onClick()
    })
    fireEvent.click(screen.getByRole('button', { name: '级联评分子树' }))
    expect(onRateNode).toHaveBeenCalledWith(
      'child',
      3,
      'first',
      'subtree',
      expect.any(Object),
      'overwrite',
      ['child', 'grandchild'],
    )
  })

  it('cascades through single-child spine into all multi-grandchild branches', async () => {
    // P → C (only child) → G1/G2/G3 — choosing 级联 must pass every descendant UID.
    const onRateNode = vi.fn()
    const spineThenBranch: typeof editorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: 'Root', uid: 'root' },
          children: [
            {
              data: { text: 'Parent', uid: 'p' },
              children: [
                {
                  data: { text: 'Child', uid: 'c' },
                  children: [
                    { data: { text: 'G1', uid: 'g1' }, children: [] },
                    { data: { text: 'G2', uid: 'g2' }, children: [] },
                    { data: { text: 'G3', uid: 'g3' }, children: [] },
                  ],
                },
              ],
            },
          ],
        },
      },
      editor_fingerprint: 'spine-then-branch-panel',
    }

    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        visibleEditorState={spineThenBranch}
        ratingTreeEditorState={spineThenBranch}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        ratingMode
        onRateNode={onRateNode}
        onUndoRating={vi.fn()}
      />,
    )

    await act(async () => {
      getLatestMindMapEditorSurfaceProps()?.onNodeClick?.([{ uid: 'p', text: 'Parent' }])
    })
    const actions = getLatestMindMapEditorSurfaceProps()?.buildSelectionToolbarActions?.('p') ?? []
    // Toolbar count must include parent + child + three grandchildren (5).
    expect(actions.some((action: { id: string; label: string }) => action.id === 'rate-3' && action.label.includes('5'))).toBe(
      true,
    )
    await act(async () => {
      actions.find((action: { id: string }) => action.id === 'rate-3')?.onClick()
    })
    fireEvent.click(screen.getByRole('button', { name: '级联评分子树' }))
    expect(onRateNode).toHaveBeenCalledWith(
      'p',
      3,
      'first',
      'subtree',
      expect.any(Object),
      'overwrite',
      expect.arrayContaining(['p', 'c', 'g1', 'g2', 'g3']),
    )
    const cascadeArg = onRateNode.mock.calls[0]?.[6] as string[]
    expect(cascadeArg).toHaveLength(5)
  })

  it('keeps memoryAnkiId-only due nodes unmuted in rating mode', async () => {
    const idOnlyState: typeof editorState = {
      ...editorState,
      editor_doc: {
        root: {
          data: { text: 'Root', memoryAnkiId: 1 },
          children: [
            {
              data: { text: 'Due', memoryAnkiId: 42 },
              children: [{ data: { text: 'Fresh', memoryAnkiId: 99 }, children: [] }],
            },
          ],
        },
      },
      editor_fingerprint: 'memory-anki-id-only',
    }
    renderInRouter(
      <FlipCardMindMapPanel
        fullscreen={true}
        sessionKind="review"
        visibleEditorState={idOnlyState}
        onToggleFullscreen={vi.fn()}
        onNodeClick={vi.fn()}
        onNodeContextMenu={vi.fn()}
        ratingMode
        rateableNodeUids={['42']}
        onRateNode={vi.fn()}
      />,
    )

    const muted = getLatestMindMapEditorSurfaceProps()?.mutedNodeUids ?? []
    expect(muted).not.toContain('42')
    expect(muted).toEqual(expect.arrayContaining(['99']))
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
      ['grandchild'],
    )
  })

  it('asks for rating scope when a parent has children even without conflicts', async () => {
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
    await act(async () => {
      remember?.onClick()
    })
    expect(onRateNode).not.toHaveBeenCalled()
    expect(screen.getByTestId('rating-conflict-dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: '单独评分选中的父节点' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '级联评分子树' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '级联评分子树' }))
    // Root itself is not rateable in the cascade list; all non-root descendants are.
    expect(onRateNode).toHaveBeenCalledWith(
      'root',
      3,
      'first',
      'subtree',
      expect.any(Object),
      'overwrite',
      ['child', 'grandchild'],
    )
  })

  it('can score only the selected parent from the subtree rating dialog', async () => {
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
      />,
    )

    await act(async () => {
      getLatestMindMapEditorSurfaceProps()?.onNodeClick?.([{ uid: 'child', text: 'Child' }])
    })
    const actions = getLatestMindMapEditorSurfaceProps()?.buildSelectionToolbarActions?.('child') ?? []
    await act(async () => {
      actions.find((action: { id: string }) => action.id === 'rate-3')?.onClick()
    })
    fireEvent.click(screen.getByRole('button', { name: '单独评分选中的父节点' }))
    expect(onRateNode).toHaveBeenCalledWith(
      'child',
      3,
      'first',
      'single',
      expect.any(Object),
      'overwrite',
      ['child'],
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
    expect(screen.getByRole('button', { name: '单独评分选中的父节点' })).toBeTruthy()
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
      ['child', 'grandchild'],
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
      ['child', 'grandchild'],
    )
  })
})
