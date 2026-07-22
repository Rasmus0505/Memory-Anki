import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FreestyleMindMapBranchCardView } from './FreestyleMindMapBranchCardView'
import type { FreestyleMindMapBranchCard } from '@/shared/api/contracts'

const apiMocks = vi.hoisted(() => ({
  startReviewSessionApi: vi.fn(),
  submitReviewSessionApi: vi.fn(),
  getReviewSessionCompletionSummaryApi: vi.fn(),
  rateUnratedReviewSessionNodesApi: vi.fn(),
  createStudySessionApi: vi.fn(),
  completeStudySessionApi: vi.fn(),
  getPalaceEditorApi: vi.fn(),
}))

let capturedFlowProps: Record<string, unknown> | null = null

vi.mock('@/modules/content/domain/mindmap-document-entity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/content/domain/mindmap-document-entity')>()
  return {
    ...actual,
    readMindMapEditorState: () => ({
      editor_doc: {
        root: {
          data: { uid: 'root', text: 'Root' },
          children: [
            {
              data: { uid: 'branch', text: 'Branch' },
              children: [{ data: { uid: 'child', text: 'Child' }, children: [] }],
            },
          ],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
      editor_fingerprint: 'test-fp',
    }),
  }
})
vi.mock('@/modules/content/domain/palace-entity/api', () => ({ getPalaceEditorApi: apiMocks.getPalaceEditorApi }))
vi.mock('@/modules/practice/ui/review/api', () => ({
  startReviewSessionApi: apiMocks.startReviewSessionApi,
  submitReviewSessionApi: apiMocks.submitReviewSessionApi,
  getReviewSessionCompletionSummaryApi: apiMocks.getReviewSessionCompletionSummaryApi,
  rateUnratedReviewSessionNodesApi: apiMocks.rateUnratedReviewSessionNodesApi,
}))
vi.mock('@/modules/session/domain/study-session-entity/api', () => ({
  createStudySessionApi: apiMocks.createStudySessionApi,
  completeStudySessionApi: apiMocks.completeStudySessionApi,
}))
vi.mock('@/widgets/mindmap-review-flow', () => ({
  startReviewSessionApi: apiMocks.startReviewSessionApi,
  submitReviewSessionApi: apiMocks.submitReviewSessionApi,
  MindMapReviewFlow: (props: Record<string, unknown>) => {
    capturedFlowProps = props
    return (
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
    apiMocks.getPalaceEditorApi.mockResolvedValue({})
    apiMocks.startReviewSessionApi.mockResolvedValue({
      id: 'schedule-1',
      session_id: 'formal-session-1',
      frozen_due_node_uids: ['child'],
    })
    apiMocks.submitReviewSessionApi.mockResolvedValue({})
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

    fireEvent.click(screen.getByRole('button', { name: '完成模拟' }))
    await waitFor(() => expect(apiMocks.getReviewSessionCompletionSummaryApi).toHaveBeenCalledWith('formal-session-1'))
    expect(apiMocks.submitReviewSessionApi).not.toHaveBeenCalled()
    expect(screen.getByText('完成 FSRS 复习')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认结束本次复习' }))
    await waitFor(() => expect(apiMocks.submitReviewSessionApi).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onBranchComplete).toHaveBeenCalledWith(card.id))
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
        onSaveFailed={vi.fn()}
        reducedMotion
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '完成模拟' })).toBeTruthy())
    expect(capturedFlowProps?.reviewScopeNodeUids).toEqual(['child'])
  })
})
