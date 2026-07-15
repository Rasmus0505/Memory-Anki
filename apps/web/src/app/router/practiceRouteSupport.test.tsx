import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PracticeSessionRoute,
  type CompleteFlowPayload,
  type PracticeProgressSnapshot,
  type PracticeStageTarget,
} from '@/app/router/practiceRouteSupport'
import type { MindMapEditorState } from '@/shared/api/contracts'

const mocks = vi.hoisted(() => ({
  latestFlowProps: null as Record<string, any> | null,
  latestStageProps: null as Record<string, any> | null,
  latestCompletionPayload: null as Record<string, any> | null,
  completionFinalize: vi.fn<(options?: { persistTimeRecord?: boolean }) => Promise<void>>(),
  completionCancel: vi.fn<() => void>(),
  consumePrefetchedStudySession: vi.fn(),
  routeId: '42',
}))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useParams: () => ({ id: mocks.routeId }),
}))

vi.mock('@/shared/api/studySessionWarmup', () => ({
  consumePrefetchedStudySession: (...args: unknown[]) =>
    mocks.consumePrefetchedStudySession(...args),
}))

vi.mock('@/widgets/mindmap-review-flow', () => ({
  MindMapReviewFlow: (props: Record<string, any>) => {
    mocks.latestFlowProps = props
    return (
      <div>
        <div data-testid="flow-title">{props.title}</div>
        <div data-testid="flow-key">{props.persistKey}</div>
        <button
          type="button"
          onClick={() =>
            props.onSnapshotChange({
              completed: false,
              revealMap: { a: 'revealed' },
              redNodeIds: ['a'],
            })
          }
        >
          save snapshot
        </button>
        <button
          type="button"
          onClick={() =>
            props.onSnapshotChange({
              completed: true,
              revealMap: {},
              redNodeIds: [],
            })
          }
        >
          complete snapshot
        </button>
        <button type="button" onClick={() => props.onRestart()}>
          restart
        </button>
        <button
          type="button"
          onClick={() => {
            const payload = {
              durationSeconds: 9,
              completionMode: 'manual_complete',
              revealedRemaining: true,
              redNodeIds: ['a', 'b'],
              finalize: mocks.completionFinalize,
              cancel: mocks.completionCancel,
            }
            mocks.latestCompletionPayload = payload
            return props.onComplete(payload)
          }}
        >
          complete flow
        </button>
      </div>
    )
  },
}))

vi.mock('@/features/review/components/StageSelectDialog', () => ({
  StageSelectDialog: (props: Record<string, any>) => {
    mocks.latestStageProps = props
    return props.open ? (
      <div>
        {props.error ? <div role="alert">{props.error}</div> : null}
        <button type="button" onClick={() => props.onConfirm(2, false, '')}>
          confirm stage
        </button>
        <button type="button" onClick={() => props.onCancel()}>
          cancel stage
        </button>
      </div>
    ) : null
  },
}))

interface TestData extends PracticeStageTarget {
  title: string
}

interface TestSession {
  item: TestData
  editor_doc: MindMapEditorState['editor_doc']
}

function buildEditorState(editorDoc: MindMapEditorState['editor_doc']): MindMapEditorState {
  return {
    editor_doc: editorDoc,
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

function createConfig(overrides: Partial<Parameters<typeof PracticeSessionRoute<TestData, TestSession>>[0]['config']> = {}) {
  const loadSession = vi.fn<(id: number) => Promise<TestSession>>()
  const loadProgress = vi.fn<(id: number) => Promise<{ progress: PracticeProgressSnapshot | null }>>()
  const clearProgress = vi.fn<(data: TestData) => Promise<unknown>>()
  const saveProgress = vi.fn<(data: TestData, snapshot: PracticeProgressSnapshot) => Promise<unknown>>()
  const completeWithoutStage = vi.fn<
    (data: TestData, payload: CompleteFlowPayload, options: { mutationId: string }) => Promise<void>
  >()
  const submitStage = vi.fn<
    (
      data: TestData,
      payload: CompleteFlowPayload,
      targetReviewNumber: number,
      needsPractice: boolean,
      options: { mutationId: string },
    ) => Promise<void>
  >()
  const refreshStageTarget = vi.fn<(data: TestData) => Promise<{
    data: TestData
    title: string
    palaceId: number
    reviewEditorState: MindMapEditorState
  }>>()

  const data: TestData = {
    id: 42,
    title: 'Practice title',
    review_stage_total: 0,
    review_stage_completed: 0,
    current_review_schedule_id: null,
    stage_labels: [],
    review_stages: [],
  }

  loadSession.mockResolvedValue({
    item: data,
    editor_doc: { root: { data: { text: 'Root' }, children: [] } },
  })
  loadProgress.mockResolvedValue({ progress: null })
  clearProgress.mockResolvedValue({ ok: true })
  saveProgress.mockResolvedValue({ ok: true })
  completeWithoutStage.mockResolvedValue(undefined)
  submitStage.mockResolvedValue(undefined)

  const config = {
    prefetchKind: 'palace-practice' as const,
    loadingText: 'Loading practice',
    notFoundText: 'Missing practice',
    loadSession: (id: number) => loadSession(id),
    loadProgress: (id: number) => loadProgress(id),
    buildSession: (session: TestSession) => ({
      data: session.item,
      title: session.item.title,
      palaceId: session.item.id,
      reviewEditorState: buildEditorState(session.editor_doc),
    }),
    clearProgress: (nextData: TestData) => clearProgress(nextData),
    saveProgress: (nextData: TestData, snapshot: PracticeProgressSnapshot) =>
      saveProgress(nextData, snapshot),
    pageEyebrow: 'Practice',
    backTo: '/palaces',
    backLabel: 'Back',
    renderBadge: (_nextData: TestData, hasResumeProgress: boolean) => (
      <span>{hasResumeProgress ? 'resume' : 'fresh'}</span>
    ),
    getFlowKey: (nextData: TestData, resetVersion: number) => `${nextData.id}-${resetVersion}`,
    getPersistKey: (nextData: TestData) => `practice:${nextData.id}`,
    getStageTarget: (nextData: TestData) => nextData,
    refreshStageTarget,
    completeWithoutStage: (nextData: TestData, payload: CompleteFlowPayload, options: { mutationId: string }) =>
      completeWithoutStage(nextData, payload, options),
    submitStage: (
      nextData: TestData,
      payload: CompleteFlowPayload,
      targetReviewNumber: number,
      needsPractice: boolean,
      options: { mutationId: string },
    ) => submitStage(nextData, payload, targetReviewNumber, needsPractice, options),
    ...overrides,
  }

  return {
    config,
    data,
    loadSession,
    loadProgress,
    clearProgress,
    saveProgress,
    completeWithoutStage,
    submitStage,
    refreshStageTarget,
  }
}

describe('PracticeSessionRoute', () => {
  beforeEach(() => {
    mocks.latestFlowProps = null
    mocks.latestStageProps = null
    mocks.latestCompletionPayload = null
    mocks.completionFinalize.mockReset()
    mocks.completionFinalize.mockResolvedValue(undefined)
    mocks.completionCancel.mockReset()
    mocks.routeId = '42'
    mocks.consumePrefetchedStudySession.mockReset()
    mocks.consumePrefetchedStudySession.mockImplementation(
      (_kind: string, _id: number, loader: () => Promise<unknown>) => loader(),
    )
    window.confirm = vi.fn(() => true)
  })

  it('loads session and progress through the warmup cache and passes the restored snapshot to the flow', async () => {
    const setup = createConfig()
    setup.loadProgress.mockResolvedValue({
      progress: {
        completed: false,
        reveal_map: { node: 'revealed' },
        red_node_ids: ['node'],
      },
    })

    render(<PracticeSessionRoute config={setup.config} />)

    await waitFor(() => expect(screen.getByTestId('flow-title').textContent).toBe('Practice title'))
    expect(mocks.consumePrefetchedStudySession).toHaveBeenCalledWith(
      'palace-practice',
      42,
      expect.any(Function),
    )
    expect(mocks.latestFlowProps).toEqual(
      expect.objectContaining({
        initialSnapshot: {
          completed: false,
          revealMap: { node: 'revealed' },
          redNodeIds: ['node'],
        },
        persistKey: 'practice:42',
      }),
    )
    expect(screen.getByText('resume')).toBeTruthy()
  })

  it('saves, clears, and restarts non-stage practice sessions through the configured operations', async () => {
    const setup = createConfig()

    render(<PracticeSessionRoute config={setup.config} />)
    await screen.findByTestId('flow-title')

    fireEvent.click(screen.getByRole('button', { name: 'save snapshot' }))
    await waitFor(() => expect(setup.saveProgress).toHaveBeenCalledTimes(1))
    expect(setup.saveProgress).toHaveBeenCalledWith(
      setup.data,
      {
        completed: false,
        reveal_map: { a: 'revealed' },
        red_node_ids: ['a'],
      },
    )

    fireEvent.click(screen.getByRole('button', { name: 'complete snapshot' }))
    await waitFor(() => expect(setup.clearProgress).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'restart' }))
    expect(window.confirm).toHaveBeenCalledWith(
      '确定重新开始本次练习吗？此操作不可撤销，会清空当前练习进度并从头开始。',
    )
    await waitFor(() => expect(setup.clearProgress).toHaveBeenCalledTimes(2))
  })

  it('passes the real completion payload to non-stage submission and finalizes exactly once after success', async () => {
    const setup = createConfig()

    render(<PracticeSessionRoute config={setup.config} />)
    await screen.findByTestId('flow-title')

    fireEvent.click(screen.getByRole('button', { name: 'complete flow' }))

    await waitFor(() => expect(setup.completeWithoutStage).toHaveBeenCalledTimes(1))
    expect(mocks.latestCompletionPayload).toEqual(
      expect.objectContaining({
        finalize: mocks.completionFinalize,
        cancel: mocks.completionCancel,
      }),
    )
    expect(setup.completeWithoutStage).toHaveBeenCalledWith(
      setup.data,
      mocks.latestCompletionPayload,
      expect.objectContaining({ mutationId: expect.any(String) }),
    )
    await waitFor(() => expect(mocks.completionFinalize).toHaveBeenCalledTimes(1))
    expect(mocks.completionCancel).not.toHaveBeenCalled()
  })

  it('completes as practice-only when stages exist but no review schedule is currently submittable', async () => {
    const setup = createConfig()
    setup.data.review_stage_total = 3
    setup.data.stage_labels = ['first', 'second', 'third']
    setup.data.review_stages = [
      { review_number: 0, label: 'first', completed: true, completed_at: null, scheduled_at: null },
      { review_number: 1, label: 'second', completed: false, completed_at: null, scheduled_at: null },
    ]
    setup.refreshStageTarget.mockResolvedValue({
      data: setup.data,
      title: setup.data.title,
      palaceId: setup.data.id,
      reviewEditorState: buildEditorState({ root: { data: { text: 'Refreshed' }, children: [] } }),
    })

    render(<PracticeSessionRoute config={setup.config} />)
    await screen.findByTestId('flow-title')
    fireEvent.click(screen.getByRole('button', { name: 'complete flow' }))

    await waitFor(() => expect(setup.completeWithoutStage).toHaveBeenCalledTimes(1))
    expect(setup.submitStage).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'confirm stage' })).toBeNull()
    expect(mocks.completionFinalize).toHaveBeenCalledTimes(1)
  })

  it('opens stage selection after refreshing stale stage metadata, submits, and finalizes exactly once', async () => {
    const setup = createConfig()
    const refreshedData: TestData = {
      ...setup.data,
      stage_labels: ['first', 'second', 'third'],
      review_stages: [
        { review_number: 0, label: 'first', completed: true, completed_at: null, scheduled_at: null },
        { review_number: 1, label: 'second', completed: false, completed_at: null, scheduled_at: null },
      ],
      review_stage_total: 3,
      review_stage_completed: 1,
      current_review_schedule_id: 2080,
    }
    setup.data.review_stage_total = 3
    setup.refreshStageTarget.mockResolvedValue({
      data: refreshedData,
      title: refreshedData.title,
      palaceId: refreshedData.id,
      reviewEditorState: buildEditorState({ root: { data: { text: 'Refreshed' }, children: [] } }),
    })

    render(<PracticeSessionRoute config={setup.config} />)
    await screen.findByTestId('flow-title')

    fireEvent.click(screen.getByRole('button', { name: 'complete flow' }))
    await screen.findByRole('button', { name: 'confirm stage' })
    expect(setup.refreshStageTarget).toHaveBeenCalledWith(setup.data)
    expect(mocks.latestStageProps).toEqual(
      expect.objectContaining({
        stageLabels: ['first', 'second', 'third'],
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'confirm stage' }))
    await waitFor(() => expect(setup.submitStage).toHaveBeenCalledTimes(1))
    expect(setup.submitStage).toHaveBeenCalledWith(
      refreshedData,
      mocks.latestCompletionPayload,
      2,
      false,
      expect.objectContaining({ mutationId: expect.any(String) }),
    )
    await waitFor(() => expect(mocks.completionFinalize).toHaveBeenCalledTimes(1))
    expect(mocks.completionCancel).not.toHaveBeenCalled()
  })

  it('keeps the stage dialog and payload after submit failure, shows the error, and retries successfully', async () => {
    const setup = createConfig()
    setup.data.stage_labels = ['first', 'second', 'third']
    setup.data.current_review_schedule_id = 2080
    setup.data.review_stages = [
      {
        review_number: 0,
        label: 'first',
        completed: true,
        completed_at: null,
        scheduled_at: null,
      },
      {
        review_number: 1,
        label: 'second',
        completed: false,
        completed_at: null,
        scheduled_at: null,
      },
      {
        review_number: 2,
        label: 'third',
        completed: false,
        completed_at: null,
        scheduled_at: null,
      },
    ]
    setup.data.review_stage_total = 3
    setup.data.review_stage_completed = 1
    setup.data.current_review_schedule_id = 2080
    setup.submitStage
      .mockRejectedValueOnce(new Error('stage submit failed'))
      .mockResolvedValueOnce(undefined)

    render(<PracticeSessionRoute config={setup.config} />)
    await screen.findByTestId('flow-title')

    fireEvent.click(screen.getByRole('button', { name: 'complete flow' }))
    fireEvent.click(await screen.findByRole('button', { name: 'confirm stage' }))

    expect((await screen.findByRole('alert')).textContent).toBe('stage submit failed')
    expect(screen.getByRole('button', { name: 'confirm stage' })).toBeTruthy()
    expect(setup.submitStage).toHaveBeenNthCalledWith(
      1,
      setup.data,
      mocks.latestCompletionPayload,
      2,
      false,
      expect.objectContaining({ mutationId: expect.any(String) }),
    )
    expect(mocks.completionFinalize).not.toHaveBeenCalled()
    expect(mocks.completionCancel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'confirm stage' }))

    await waitFor(() => expect(setup.submitStage).toHaveBeenCalledTimes(2))
    expect(setup.submitStage).toHaveBeenNthCalledWith(
      2,
      setup.data,
      mocks.latestCompletionPayload,
      2,
      false,
      expect.objectContaining({ mutationId: expect.any(String) }),
    )
    expect(setup.submitStage.mock.calls[1]?.[4]).toEqual(setup.submitStage.mock.calls[0]?.[4])
    await waitFor(() => expect(mocks.completionFinalize).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'confirm stage' })).toBeNull()
    })
  })

  it('cancels the real completion payload when stage selection is cancelled', async () => {
    const setup = createConfig()
    setup.data.stage_labels = ['first']
    setup.data.current_review_schedule_id = 2080
    setup.data.review_stages = [
      {
        review_number: 0,
        label: 'first',
        completed: false,
        completed_at: null,
        scheduled_at: null,
      },
    ]
    setup.data.review_stage_total = 1

    render(<PracticeSessionRoute config={setup.config} />)
    await screen.findByTestId('flow-title')

    fireEvent.click(screen.getByRole('button', { name: 'complete flow' }))
    fireEvent.click(await screen.findByRole('button', { name: 'cancel stage' }))

    expect(mocks.completionCancel).toHaveBeenCalledTimes(1)
    expect(mocks.completionFinalize).not.toHaveBeenCalled()
    expect(setup.submitStage).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'confirm stage' })).toBeNull()
  })
})
