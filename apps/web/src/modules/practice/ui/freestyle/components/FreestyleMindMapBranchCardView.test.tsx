import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FreestyleMindMapBranchCardView } from './FreestyleMindMapBranchCardView'
import type { FreestyleMindMapBranchCard } from '@/shared/api/contracts'

const fullEditorDoc = {
  editor_doc: {
    root: {
      data: { uid: 'root', text: 'Root' },
      children: [
        {
          data: { uid: 'branch', text: 'Branch' },
          children: [{ data: { uid: 'child', text: 'Child' }, children: [] }],
        },
        {
          data: { uid: 'other', text: 'Other branch' },
          children: [],
        },
      ],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
  editor_fingerprint: 'test-fp',
}

const apiMocks = vi.hoisted(() => ({
  startReviewSessionApi: vi.fn(),
  submitReviewSessionApi: vi.fn(),
  getReviewSessionCompletionSummaryApi: vi.fn(),
  rateUnratedReviewSessionNodesApi: vi.fn(),
  getPalaceEditorApi: vi.fn(),
  savePalaceEditorApi: vi.fn(),
  savePalaceEditorWithOptionsApi: vi.fn(),
}))

let capturedFlowProps: Record<string, unknown> | null = null

vi.mock('@/modules/content/domain/mindmap-document-entity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/content/domain/mindmap-document-entity')>()
  return {
    ...actual,
    readMindMapEditorState: (response?: unknown) =>
      (response && typeof response === 'object' && 'editor_doc' in (response as object)
        ? response
        : fullEditorDoc) as typeof fullEditorDoc,
  }
})
vi.mock('@/modules/content/domain/palace-entity/api', () => ({
  getPalaceEditorApi: apiMocks.getPalaceEditorApi,
  savePalaceEditorApi: apiMocks.savePalaceEditorApi,
  savePalaceEditorWithOptionsApi: apiMocks.savePalaceEditorWithOptionsApi,
}))
vi.mock('@/modules/practice/ui/review/api', () => ({
  startReviewSessionApi: apiMocks.startReviewSessionApi,
  submitReviewSessionApi: apiMocks.submitReviewSessionApi,
  getReviewSessionCompletionSummaryApi: apiMocks.getReviewSessionCompletionSummaryApi,
  rateUnratedReviewSessionNodesApi: apiMocks.rateUnratedReviewSessionNodesApi,
}))
vi.mock('@/widgets/mindmap-review-flow', () => ({
  startReviewSessionApi: apiMocks.startReviewSessionApi,
  submitReviewSessionApi: apiMocks.submitReviewSessionApi,
  MindMapReviewFlow: (props: Record<string, unknown>) => {
    capturedFlowProps = props
    return (
      <div>
        <button
          type="button"
          onClick={() => void (props.onModeToggle as (() => void | Promise<void>) | undefined)?.()}
        >
          {(props.modeToggleLabels as { enterEdit?: string; leaveEdit?: string } | undefined)
            ? props.displayMode === 'edit'
              ? ((props.modeToggleLabels as { leaveEdit?: string }).leaveEdit ?? '返回随心')
              : ((props.modeToggleLabels as { enterEdit?: string }).enterEdit ?? '编辑')
            : props.displayMode === 'edit'
              ? '复习'
              : '编辑'}
        </button>
        <button
          type="button"
          onClick={() =>
            (props.onComplete as (payload: Record<string, unknown>) => void)({
              durationSeconds: 12,
              completionMode: 'auto_complete',
              revealedRemaining: false,
              redNodeIds: [],
              finalize: vi.fn(async () => undefined),
              cancel: vi.fn(),
            })
          }
        >
          完成模拟
        </button>
        <button
          type="button"
          onClick={() =>
            void (
              props.onQuickSettle as
                | ((
                    rating: 1 | 2 | 3 | 4,
                    payload: Record<string, unknown>,
                  ) => void | Promise<void>)
                | undefined
            )?.(3, {
              durationSeconds: 12,
              completionMode: 'manual_complete',
              revealedRemaining: false,
              redNodeIds: [],
              finalize: vi.fn(async () => undefined),
              cancel: vi.fn(),
            })
          }
        >
          快捷记得
        </button>
      </div>
    )
  },
}))

const fullSummary = {
  scope_node_count: 1,
  rated_node_count: 1,
  unrated_due_node_count: 0,
  rating_counts: { 忘记: 0, 困难: 0, 记得: 1, 轻松: 0 },
  mastery_progress: 0.5,
  mastery_percent: 50,
  memory_health: 0.8,
  memory_health_percent: 80,
  remaining_due_node_count: 0,
  due_node_count: 0,
  overdue_node_count: 0,
  next_review_at: '2026-07-23T12:32:16Z',
  next_review_node_count: 2,
  next_review_entry_mode: 'node' as const,
  next_review_entry_label: '节点复习',
}

const card: FreestyleMindMapBranchCard = {
  id: 'mindmap_branch:1:branch',
  type: 'mindmap_branch',
  content_type: 'mindmap_branch',
  palace_id: 1,
  palace_title: '宫殿一',
  branch_uid: 'branch',
  context_path: [{ uid: 'root', text: 'Root' }],
  ratable_node_uids: ['branch', 'child'],
  due_node_uids: ['child'],
  node_count: 2,
  over_limit_delta: 0,
  due_node_count: 1,
}

describe('FreestyleMindMapBranchCardView', () => {
  beforeEach(() => {
    capturedFlowProps = null
    apiMocks.getPalaceEditorApi.mockResolvedValue(fullEditorDoc)
    apiMocks.savePalaceEditorApi.mockResolvedValue(fullEditorDoc)
    apiMocks.savePalaceEditorWithOptionsApi.mockResolvedValue(fullEditorDoc)
    apiMocks.startReviewSessionApi.mockResolvedValue({
      id: 'schedule-1',
      session_id: 'formal-session-1',
      frozen_due_node_uids: ['child'],
    })
    apiMocks.submitReviewSessionApi.mockResolvedValue({
      ...fullSummary,
      ok: true,
      completion_mode: 'manual_complete',
      score: 100,
      next_id: null,
      review_log_id: 1,
      palace_id: 1,
      chapter_id: null,
      duration_seconds: 12,
    })
    apiMocks.getReviewSessionCompletionSummaryApi.mockResolvedValue({ item: fullSummary })
    apiMocks.rateUnratedReviewSessionNodesApi.mockResolvedValue({
      item: {
        affected_node_count: 1,
        affected_node_uids: ['child'],
        skipped_rated_node_count: 0,
        operation_ids: ['op-1'],
        summary: fullSummary,
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('clips editor to the branch unit and settles via FSRS dialog', async () => {
    const onBranchComplete = vi.fn()
    render(
      <FreestyleMindMapBranchCardView
        card={card}
        active
        ratingMode
        onToggleRatingMode={vi.fn()}
        onBranchComplete={onBranchComplete}
        onStaleDrop={vi.fn()}
        onSaveFailed={vi.fn()}
        reducedMotion
      />,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: '完成模拟' })).toBeTruthy())
    expect(apiMocks.startReviewSessionApi).toHaveBeenCalledWith(1, {
      entry_mode: 'node',
      branch_uid: 'branch',
      scope_node_uids: ['child'],
    })
    expect(capturedFlowProps?.studySessionId).toBe('formal-session-1')
    expect(capturedFlowProps?.reviewScopeNodeUids).toEqual(['child'])
    expect(capturedFlowProps?.autoRevealNonDueCards).toBe(false)
    expect(capturedFlowProps?.chromeDensity).toBe('compact')
    expect(capturedFlowProps?.chromeFrame).toBe('host')
    expect(capturedFlowProps?.checkpointNodeUids).toEqual(['branch', 'child'])
    // Clipped unit tree under synthetic freestyle root — not the whole palace.
    const editor = capturedFlowProps?.reviewEditorState as {
      editor_doc?: {
        root?: {
          data?: { uid?: string }
          children?: Array<{ data?: { uid?: string }; children?: unknown[] }>
        }
      }
    }
    expect(editor?.editor_doc?.root?.data?.uid).toContain('freestyle_unit_root')
    expect(editor?.editor_doc?.root?.children?.[0]?.data?.uid).toBe('branch')
    expect(editor?.editor_doc?.root?.children?.[0]?.children).toHaveLength(1)
    // Cascade walks the unit clip (same as flip view), not the whole palace —
    // so single-child spines still cascade into nested grandchildren in-unit.
    expect(capturedFlowProps?.ratingTreeEditorState).toBe(capturedFlowProps?.reviewEditorState)
    // Full palace kept for edit mode only.
    const full = capturedFlowProps?.editEditorState as {
      editor_doc?: { root?: { children?: unknown[] } }
    }
    expect(full?.editor_doc?.root?.children).toHaveLength(2)
    expect(capturedFlowProps?.displayMode).toBe('review')
    expect(capturedFlowProps?.modeToggleLabels).toEqual({
      enterEdit: '编辑',
      leaveEdit: '返回随心',
    })
    expect(typeof capturedFlowProps?.onModeToggle).toBe('function')

    fireEvent.click(screen.getByRole('button', { name: '完成模拟' }))
    await waitFor(() => expect(apiMocks.getReviewSessionCompletionSummaryApi).toHaveBeenCalledWith('formal-session-1'))
    expect(apiMocks.submitReviewSessionApi).not.toHaveBeenCalled()
    expect(screen.getByText('完成 FSRS 复习')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认结束本次复习' }))
    await waitFor(() => expect(apiMocks.submitReviewSessionApi).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(onBranchComplete).toHaveBeenCalledWith(card.id, { restudy: false }),
    )
    // Receipt bubble shows next review — not a useless "本支完成" label.
    await waitFor(() => expect(screen.getByText('下次复习')).toBeTruthy())
    expect(screen.queryByText('本支完成')).toBeNull()
  })

  it('quick-settles by bulk-rating unrated nodes then submitting without the dialog', async () => {
    const onBranchComplete = vi.fn()
    render(
      <FreestyleMindMapBranchCardView
        card={{ ...card, id: 'mindmap_branch:1:branch:quick-settle' }}
        active
        ratingMode
        onToggleRatingMode={vi.fn()}
        onBranchComplete={onBranchComplete}
        onStaleDrop={vi.fn()}
        onSaveFailed={vi.fn()}
        reducedMotion
      />,
    )

    await waitFor(() => expect(typeof capturedFlowProps?.onQuickSettle).toBe('function'))
    fireEvent.click(screen.getByRole('button', { name: '快捷记得' }))

    await waitFor(() =>
      expect(apiMocks.rateUnratedReviewSessionNodesApi).toHaveBeenCalledWith(
        'formal-session-1',
        expect.objectContaining({ rating: 3 }),
      ),
    )
    await waitFor(() => expect(apiMocks.submitReviewSessionApi).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('完成 FSRS 复习')).toBeNull()
    await waitFor(() =>
      expect(onBranchComplete).toHaveBeenCalledWith(
        'mindmap_branch:1:branch:quick-settle',
        { restudy: false },
      ),
    )
    // Stay on card: next-review bubble, no auto-flip / no "本支完成".
    await waitFor(() => expect(screen.getByText('下次复习')).toBeTruthy())
    expect(screen.queryByText('本支完成')).toBeNull()
  })

  it('enters full-palace edit mode and returns to freestyle without save when clean', async () => {
    render(
      <FreestyleMindMapBranchCardView
        card={{ ...card, id: 'mindmap_branch:1:branch:inline-edit' }}
        active
        ratingMode
        onToggleRatingMode={vi.fn()}
        onBranchComplete={vi.fn()}
        onStaleDrop={vi.fn()}
        onSaveFailed={vi.fn()}
        reducedMotion
      />,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy())
    expect(capturedFlowProps?.displayMode).toBe('review')

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await waitFor(() => expect(capturedFlowProps?.displayMode).toBe('edit'))
    expect(screen.getByRole('button', { name: '返回随心' })).toBeTruthy()
    // Edit surface uses the full palace document, not the clipped unit.
    const editState = capturedFlowProps?.editEditorState as {
      editor_doc?: { root?: { children?: Array<{ data?: { uid?: string } }> } }
    }
    expect(editState?.editor_doc?.root?.children?.map((node) => node.data?.uid)).toEqual([
      'branch',
      'other',
    ])
    expect(apiMocks.savePalaceEditorApi).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '返回随心' }))
    await waitFor(() => expect(capturedFlowProps?.displayMode).toBe('review'))
    // No edits → no palace save (previously blocked UI on USB I/O every leave-edit).
    expect(apiMocks.savePalaceEditorApi).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy()
    // Freestyle unit remains clipped after return.
    const reviewState = capturedFlowProps?.reviewEditorState as {
      editor_doc?: {
        root?: { data?: { uid?: string }; children?: Array<{ data?: { uid?: string } }> }
      }
    }
    expect(reviewState?.editor_doc?.root?.data?.uid).toContain('freestyle_unit_root')
    expect(reviewState?.editor_doc?.root?.children?.[0]?.data?.uid).toBe('branch')
  })

  it('saves dirty full-palace edits after returning to freestyle', async () => {
    render(
      <FreestyleMindMapBranchCardView
        card={{ ...card, id: 'mindmap_branch:1:branch:inline-edit-dirty' }}
        active
        ratingMode
        onToggleRatingMode={vi.fn()}
        onBranchComplete={vi.fn()}
        onStaleDrop={vi.fn()}
        onSaveFailed={vi.fn()}
        reducedMotion
      />,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await waitFor(() => expect(capturedFlowProps?.displayMode).toBe('edit'))

    const dirtyState = {
      ...fullEditorDoc,
      editor_doc: {
        ...fullEditorDoc.editor_doc,
        root: {
          ...fullEditorDoc.editor_doc.root,
          children: [
            {
              data: { uid: 'branch', text: 'Branch edited' },
              children: [{ data: { uid: 'child', text: 'Child' }, children: [] }],
            },
            fullEditorDoc.editor_doc.root.children[1],
          ],
        },
      },
      editor_fingerprint: 'dirty-fp',
    }
    apiMocks.savePalaceEditorApi.mockResolvedValue(dirtyState)
    act(() => {
      ;(capturedFlowProps?.onEditEditorStateChange as (state: typeof dirtyState) => void)(dirtyState)
    })

    fireEvent.click(screen.getByRole('button', { name: '返回随心' }))
    // Mode flips immediately; save continues without blocking the toggle label.
    await waitFor(() => expect(capturedFlowProps?.displayMode).toBe('review'))
    await waitFor(() => expect(apiMocks.savePalaceEditorApi).toHaveBeenCalledTimes(1))
    expect(apiMocks.savePalaceEditorApi).toHaveBeenCalledWith(1, expect.objectContaining({
      editor_fingerprint: 'dirty-fp',
    }))
  })

  it('blocks complete submit when frozen due nodes remain unrated and offers bulk rate', async () => {
    apiMocks.getReviewSessionCompletionSummaryApi.mockResolvedValue({
      item: {
        ...fullSummary,
        rated_node_count: 0,
        unrated_due_node_count: 1,
        unrated_node_uids: ['child'],
        rating_counts: { 忘记: 0, 困难: 0, 记得: 0, 轻松: 0 },
      },
    })
    const onSaveFailed = vi.fn()
    render(
      <FreestyleMindMapBranchCardView
        card={{ ...card, id: 'mindmap_branch:1:branch:unrated' }}
        active
        ratingMode
        onToggleRatingMode={vi.fn()}
        onBranchComplete={vi.fn()}
        onStaleDrop={vi.fn()}
        onSaveFailed={onSaveFailed}
        reducedMotion
      />,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: '完成模拟' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '完成模拟' }))
    await waitFor(() => expect(screen.getByText(/还有 1 个到期节点未评分/)).toBeTruthy())

    const confirm = screen.getByRole('button', { name: '还有 1 个未评分' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(apiMocks.submitReviewSessionApi).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '记得' }))
    await waitFor(() =>
      expect(apiMocks.rateUnratedReviewSessionNodesApi).toHaveBeenCalledWith(
        'formal-session-1',
        expect.objectContaining({ rating: 3 }),
      ),
    )
  })

  it('intersects oversized formal freeze with the unit ratable set', async () => {
    apiMocks.startReviewSessionApi.mockResolvedValue({
      id: 'schedule-wide',
      session_id: 'formal-wide',
      frozen_due_node_uids: ['child', 'outside-unit'],
    })
    const wideCard = { ...card, id: 'mindmap_branch:1:branch:wide-scope' }
    render(
      <FreestyleMindMapBranchCardView
        card={wideCard}
        active
        ratingMode
        onToggleRatingMode={vi.fn()}
        onBranchComplete={vi.fn()}
        onStaleDrop={vi.fn()}
        onSaveFailed={vi.fn()}
        reducedMotion
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '完成模拟' })).toBeTruthy())
    expect(capturedFlowProps?.reviewScopeNodeUids).toEqual(['child'])
    expect(capturedFlowProps?.sessionKind).toBe('review')
  })

  it('stale-drops without marking completed when formal due is already empty', async () => {
    const onBranchComplete = vi.fn()
    const onStaleDrop = vi.fn()
    apiMocks.startReviewSessionApi.mockRejectedValue(new Error('palace has no due FSRS nodes'))
    render(
      <FreestyleMindMapBranchCardView
        card={{ ...card, id: 'mindmap_branch:1:branch:stale-due' }}
        active
        ratingMode
        onToggleRatingMode={vi.fn()}
        onBranchComplete={onBranchComplete}
        onStaleDrop={onStaleDrop}
        onSaveFailed={vi.fn()}
        reducedMotion
      />,
    )
    await waitFor(() => expect(onStaleDrop).toHaveBeenCalledWith('mindmap_branch:1:branch:stale-due'))
    expect(onBranchComplete).not.toHaveBeenCalled()
    expect(apiMocks.startReviewSessionApi).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '完成模拟' })).toBeNull()
  })

  it('stale-drops zero-due cards without a practice session or completed mark', async () => {
    const onBranchComplete = vi.fn()
    const onStaleDrop = vi.fn()
    render(
      <FreestyleMindMapBranchCardView
        card={{
          ...card,
          id: 'mindmap_branch:1:branch:zero-due',
          due_node_uids: [],
          due_node_count: 0,
        }}
        active
        ratingMode
        onToggleRatingMode={vi.fn()}
        onBranchComplete={onBranchComplete}
        onStaleDrop={onStaleDrop}
        onSaveFailed={vi.fn()}
        reducedMotion
      />,
    )
    await waitFor(() => expect(onStaleDrop).toHaveBeenCalledWith('mindmap_branch:1:branch:zero-due'))
    expect(onBranchComplete).not.toHaveBeenCalled()
    expect(apiMocks.startReviewSessionApi).not.toHaveBeenCalled()
  })
})
