import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewSession from '@/app/router/review/ReviewSession'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  getReviewSessionApi: vi.fn(),
  getReviewSessionProgressApi: vi.fn(),
  clearReviewSessionProgressApi: vi.fn(),
  submitReviewSessionApi: vi.fn(),
  useMindMapDocumentSession: vi.fn(),
  flushSave: vi.fn(),
  setEditorState: vi.fn(),
  latestFlowProps: null as Record<string, unknown> | null,
}))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => mocks.navigate,
  useParams: () => ({ id: '309' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    info: vi.fn(),
  },
}))

vi.mock('@/widgets/mindmap-review-flow/MindMapReviewFlow', () => ({
  MindMapReviewFlow: (props: Record<string, any>) => {
    mocks.latestFlowProps = props
    return (
      <div>
        <div data-testid="flow-mode">{props.displayMode}</div>
        <div data-testid="flow-sync-version">{String(props.modeSyncVersion)}</div>
        <div data-testid="flow-scope">{String(props.viewMemoryScope)}</div>
        {props.onModeToggle ? (
          <button type="button" onClick={() => void props.onModeToggle()}>
            {props.displayMode === 'edit' ? '切回复习' : '切到编辑'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() =>
            props.onComplete({
              durationSeconds: 12,
              completionMode: 'manual_complete',
              revealedRemaining: true,
              redNodeIds: ['node-1'],
            })
          }
        >
          完成
        </button>
      </div>
    )
  },
}))

vi.mock('@/features/review/api', () => ({
  getReviewSessionApi: (...args: unknown[]) => mocks.getReviewSessionApi(...args),
  getReviewSessionProgressApi: (...args: unknown[]) => mocks.getReviewSessionProgressApi(...args),
  clearReviewSessionProgressApi: (...args: unknown[]) => mocks.clearReviewSessionProgressApi(...args),
  saveReviewSessionProgressApi: vi.fn(),
  submitReviewSessionApi: (...args: unknown[]) => mocks.submitReviewSessionApi(...args),
}))

vi.mock('@/shared/api/studySessionWarmup', () => ({
  consumePrefetchedStudySession: (_kind: string, _id: number, loader: () => Promise<unknown>) =>
    loader(),
}))

vi.mock('@/entities/palace/api', () => ({
  buildAttachmentUrl: (id: number) => `/attachments/${id}`,
  getPalaceEditorApi: vi.fn(),
  savePalaceEditorApi: vi.fn(),
  savePalaceEditorWithOptionsApi: vi.fn(),
  togglePalaceFocusNodeApi: vi.fn(),
}))

vi.mock('@/shared/hooks/useMindMapDocumentSession', () => ({
  useMindMapDocumentSession: (...args: unknown[]) => mocks.useMindMapDocumentSession(...args),
}))

describe('ReviewSession', () => {
  beforeEach(() => {
    mocks.navigate.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.submitReviewSessionApi.mockReset()
    mocks.clearReviewSessionProgressApi.mockReset()
    mocks.flushSave.mockReset()
    mocks.setEditorState.mockReset()
    mocks.useMindMapDocumentSession.mockReset()
    mocks.latestFlowProps = null

    mocks.getReviewSessionApi.mockResolvedValue({
      id: 309,
      palace_id: 1,
      algorithm_used: 'ebbinghaus',
      review_type: 'standard',
      review_number: 3,
      interval_days: 1,
      palace: {
        id: 1,
        title: '第四节 收回教育权运动与教会教育的变革',
        attachments: [],
        stage_labels: ['1小时', '睡前', '1天', '2天', '4天', '7天', '15天', '30天', '60天'],
        review_stages: [
          { review_number: 0, label: '1小时', completed: true, completed_at: '2026-05-21T10:00', scheduled_at: '2026-05-21T11:00' },
          { review_number: 1, label: '睡前', completed: true, completed_at: '2026-05-21T22:00', scheduled_at: '2026-05-21T22:00' },
          { review_number: 2, label: '1天', completed: true, completed_at: '2026-05-22T10:00', scheduled_at: '2026-05-22T10:00' },
          { review_number: 3, label: '2天', completed: false, completed_at: null, scheduled_at: '2026-05-24T10:00' },
          { review_number: 4, label: '4天', completed: false, completed_at: null, scheduled_at: null },
          { review_number: 5, label: '7天', completed: false, completed_at: null, scheduled_at: null },
          { review_number: 6, label: '15天', completed: false, completed_at: null, scheduled_at: null },
          { review_number: 7, label: '30天', completed: false, completed_at: null, scheduled_at: null },
          { review_number: 8, label: '60天', completed: false, completed_at: null, scheduled_at: null },
        ],
      },
    })
    mocks.getReviewSessionProgressApi.mockResolvedValue({ progress: null })
    mocks.clearReviewSessionProgressApi.mockResolvedValue({ ok: true })
    mocks.submitReviewSessionApi.mockResolvedValue({ ok: true, next_id: null, score: 5 })
    mocks.flushSave.mockResolvedValue(undefined)
    mocks.useMindMapDocumentSession.mockReturnValue({
      meta: {
        id: 1,
        title: '第四节 收回教育权运动与教会教育的变革',
      },
      editorState: {
        editor_doc: { root: { data: { text: 'Root' }, children: [] } },
        editor_config: {},
        editor_local_config: {},
        lang: 'zh',
      },
      setEditorState: mocks.setEditorState,
      isLoading: false,
      isSaving: false,
      error: null,
      reload: vi.fn(),
      flushSave: mocks.flushSave,
    })
  })

  it('passes inline review editing props into MindMapReviewFlow', async () => {
    render(<ReviewSession />)

    await waitFor(() => {
      expect(screen.getByTestId('flow-mode').textContent).toBe('review')
    })

    expect(screen.getByTestId('flow-sync-version').textContent).toBe('0')
    expect(screen.getByTestId('flow-scope').textContent).toBe('review-session:309:review')
    expect(mocks.latestFlowProps).toEqual(
      expect.objectContaining({
        sessionKind: 'review',
        displayMode: 'review',
        modeSyncVersion: 0,
        viewMemoryScope: 'review-session:309:review',
        onModeToggle: expect.any(Function),
        onEditEditorStateChange: mocks.setEditorState,
        reviewEditorState: {
          editor_doc: null,
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        },
        editEditorState: {
          editor_doc: { root: { data: { text: 'Root' }, children: [] } },
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        },
        editSaving: false,
        editError: null,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '切到编辑' }))

    await waitFor(() => {
      expect(screen.getByTestId('flow-mode').textContent).toBe('edit')
    })
    expect(screen.getByTestId('flow-sync-version').textContent).toBe('1')
    expect(screen.getByTestId('flow-scope').textContent).toBe('review-session:309:edit')
  })

  it('renders the review flow before the full edit editor state finishes loading', async () => {
    mocks.useMindMapDocumentSession.mockReturnValue({
      meta: null,
      editorState: null,
      setEditorState: mocks.setEditorState,
      isLoading: true,
      isSaving: false,
      error: null,
      reload: vi.fn(),
      flushSave: mocks.flushSave,
    })

    render(<ReviewSession />)

    await waitFor(() => {
      expect(screen.getByTestId('flow-mode').textContent).toBe('review')
    })
    expect(mocks.latestFlowProps).toEqual(
      expect.objectContaining({
        reviewEditorState: {
          editor_doc: null,
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        },
        editEditorState: {
          editor_doc: null,
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        },
      }),
    )
  })

  it('redirects stale review session URLs back to the review overview', async () => {
    mocks.getReviewSessionApi.mockClear()
    const notFoundError = Object.assign(new Error('not found'), { status: 404 })
    mocks.getReviewSessionApi.mockRejectedValueOnce(notFoundError)

    render(<ReviewSession />)

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/review', { replace: true })
    })
    expect(mocks.getReviewSessionApi).toHaveBeenCalledTimes(1)
  })
  it('flushes edits on mode exit and still submits only one review completion after switching back', async () => {
    render(<ReviewSession />)

    fireEvent.click(await screen.findByRole('button', { name: '切到编辑' }))

    await waitFor(() => {
      expect(screen.getByTestId('flow-mode').textContent).toBe('edit')
    })
    expect(mocks.submitReviewSessionApi).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '切回复习' }))

    await waitFor(() => {
      expect(screen.getByTestId('flow-mode').textContent).toBe('review')
    })
    await waitFor(() => {
      expect(mocks.flushSave).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole('button', { name: '完成' }))

    const confirmButton = await screen.findByRole('button', { name: /默认.*标记第 4 次完成/ })
    fireEvent.click(confirmButton)

    await waitFor(() => expect(mocks.submitReviewSessionApi).toHaveBeenCalledTimes(1))
    expect(mocks.flushSave).toHaveBeenCalledTimes(3)
    expect(mocks.submitReviewSessionApi).toHaveBeenCalledWith(309, {
      chapter_id: undefined,
      duration_seconds: 12,
      completion_mode: 'manual_complete',
      revealed_remaining: true,
      red_marked_count: 1,
      target_review_number: 3,
      needs_practice: false,
    })
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('lets number keys select the target stage in the completion feedback dialog', async () => {
    render(<ReviewSession />)

    fireEvent.click(await screen.findByRole('button', { name: '完成' }))
    expect(await screen.findByText('快捷键 1-5 可选择前 5 个复习阶段。')).toBeTruthy()

    fireEvent.keyDown(window, { key: '5', code: 'Digit5' })
    const confirmButton = await screen.findByRole('button', {
      name: /标记第 5 次完成.*4天/,
    })
    fireEvent.click(confirmButton)

    await waitFor(() => expect(mocks.submitReviewSessionApi).toHaveBeenCalledTimes(1))
    expect(mocks.submitReviewSessionApi).toHaveBeenCalledWith(309, {
      chapter_id: undefined,
      duration_seconds: 12,
      completion_mode: 'manual_complete',
      revealed_remaining: true,
      red_marked_count: 1,
      target_review_number: 4,
      needs_practice: false,
    })
  })

  it('submits the optional review note from the completion dialog', async () => {
    render(<ReviewSession />)

    fireEvent.click(await screen.findByRole('button', { name: '完成' }))
    fireEvent.change(
      await screen.findByPlaceholderText('例如：心脏瓣膜顺序又忘了，下次先背口诀'),
      { target: { value: ' 瓣膜顺序卡壳 ' } },
    )
    fireEvent.click(await screen.findByRole('button', { name: /默认.*标记第 4 次完成/ }))

    await waitFor(() => expect(mocks.submitReviewSessionApi).toHaveBeenCalledTimes(1))
    expect(mocks.submitReviewSessionApi).toHaveBeenCalledWith(309, {
      chapter_id: undefined,
      duration_seconds: 12,
      completion_mode: 'manual_complete',
      revealed_remaining: true,
      red_marked_count: 1,
      target_review_number: 3,
      needs_practice: false,
      note: '瓣膜顺序卡壳',
    })
  })
})
