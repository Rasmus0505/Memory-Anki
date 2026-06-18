import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SegmentReviewSessionPage from '@/features/review/SegmentReviewSessionPage'

const mocks = vi.hoisted(() => ({
  getSegmentReviewSessionApi: vi.fn(),
  getSegmentReviewSessionProgressApi: vi.fn(),
  clearSegmentReviewSessionProgressApi: vi.fn(),
  saveSegmentReviewSessionProgressApi: vi.fn(),
  submitSegmentReviewSessionApi: vi.fn(),
  usePersistedMindMapEditor: vi.fn(),
  flushSave: vi.fn(),
  reloadEditor: vi.fn(),
  setEditorState: vi.fn(),
  latestFlowProps: null as Record<string, unknown> | null,
}))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useParams: () => ({ id: '1407' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))

vi.mock('@/features/review/components/MindMapReviewFlow', () => ({
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
      </div>
    )
  },
}))

vi.mock('@/features/review/api/reviewApi', () => ({
  getSegmentReviewSessionApi: (...args: unknown[]) => mocks.getSegmentReviewSessionApi(...args),
  getSegmentReviewSessionProgressApi: (...args: unknown[]) => mocks.getSegmentReviewSessionProgressApi(...args),
  clearSegmentReviewSessionProgressApi: (...args: unknown[]) => mocks.clearSegmentReviewSessionProgressApi(...args),
  saveSegmentReviewSessionProgressApi: (...args: unknown[]) => mocks.saveSegmentReviewSessionProgressApi(...args),
  submitSegmentReviewSessionApi: (...args: unknown[]) => mocks.submitSegmentReviewSessionApi(...args),
}))

vi.mock('@/entities/palace/api', () => ({
  buildAttachmentUrl: (id: number) => `/attachments/${id}`,
  getPalaceEditorApi: vi.fn(),
  savePalaceEditorApi: vi.fn(),
  savePalaceEditorWithOptionsApi: vi.fn(),
}))

vi.mock('@/shared/hooks/usePersistedMindMapEditor', () => ({
  usePersistedMindMapEditor: (...args: unknown[]) => mocks.usePersistedMindMapEditor(...args),
}))

describe('SegmentReviewSessionPage', () => {
  beforeEach(() => {
    mocks.getSegmentReviewSessionApi.mockReset()
    mocks.getSegmentReviewSessionProgressApi.mockReset()
    mocks.clearSegmentReviewSessionProgressApi.mockReset()
    mocks.saveSegmentReviewSessionProgressApi.mockReset()
    mocks.submitSegmentReviewSessionApi.mockReset()
    mocks.usePersistedMindMapEditor.mockReset()
    mocks.flushSave.mockReset()
    mocks.reloadEditor.mockReset()
    mocks.setEditorState.mockReset()
    mocks.latestFlowProps = null

    mocks.getSegmentReviewSessionApi.mockResolvedValue({
      id: 1407,
      palace_id: 88,
      algorithm_used: 'ebbinghaus',
      review_type: 'standard',
      review_number: 3,
      palace: {
        id: 88,
        title: '第二节古希腊的教育阶段',
        attachments: [],
      },
      segment: {
        id: 301,
        palace_id: 88,
        name: '第 1 部分',
        display_name: '第 1 部分',
        stage_labels: ['1小时', '睡前', '1天', '2天'],
        review_stages: [
          { review_number: 0, label: '1小时', completed: true, completed_at: '2026-06-05T10:00', scheduled_at: '2026-06-05T11:00' },
          { review_number: 1, label: '睡前', completed: true, completed_at: '2026-06-05T22:00', scheduled_at: '2026-06-05T22:00' },
          { review_number: 2, label: '1天', completed: true, completed_at: '2026-06-06T10:00', scheduled_at: '2026-06-06T10:00' },
          { review_number: 3, label: '2天', completed: false, completed_at: null, scheduled_at: '2026-06-08T10:00' },
        ],
      },
      editor_doc: { root: { data: { text: 'Segment Root' }, children: [] } },
    })
    mocks.getSegmentReviewSessionProgressApi.mockResolvedValue({ progress: null })
    mocks.usePersistedMindMapEditor.mockReturnValue({
      meta: {
        id: 88,
        title: '第二节古希腊的教育阶段',
      },
      editorState: {
        editor_doc: { root: { data: { text: 'Full Palace Root' }, children: [] } },
        editor_config: {},
        editor_local_config: {},
        lang: 'zh',
      },
      setEditorState: mocks.setEditorState,
      isLoading: false,
      isSaving: false,
      error: null,
      reload: mocks.reloadEditor,
      flushSave: mocks.flushSave,
    })
    mocks.flushSave.mockResolvedValue(undefined)
  })

  it('uses the shared inline edit flow and refreshes the segment review state after exiting edit mode', async () => {
    render(<SegmentReviewSessionPage />)

    await waitFor(() => {
      expect(screen.getByTestId('flow-mode').textContent).toBe('review')
    })

    expect(mocks.latestFlowProps).toEqual(
      expect.objectContaining({
        sessionKind: 'review',
        displayMode: 'review',
        modeSyncVersion: 0,
        viewMemoryScope: 'review-session:1407:review',
        onModeToggle: expect.any(Function),
        onEditEditorStateChange: mocks.setEditorState,
        reviewEditorState: {
          editor_doc: { root: { data: { text: 'Segment Root' }, children: [] } },
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        },
        editEditorState: {
          editor_doc: { root: { data: { text: 'Full Palace Root' }, children: [] } },
          editor_config: {},
          editor_local_config: {},
          lang: 'zh',
        },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '切到编辑' }))

    await waitFor(() => {
      expect(screen.getByTestId('flow-mode').textContent).toBe('edit')
    })

    fireEvent.click(screen.getByRole('button', { name: '切回复习' }))

    await waitFor(() => {
      expect(screen.getByTestId('flow-mode').textContent).toBe('review')
    })
    await waitFor(() => {
      expect(mocks.flushSave).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(mocks.getSegmentReviewSessionApi).toHaveBeenCalledTimes(2)
    })
  })
})
