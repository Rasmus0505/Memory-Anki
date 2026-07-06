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
  consumePrefetchedStudySession: vi.fn(),
  routeId: '42',
}))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useParams: () => ({ id: mocks.routeId }),
}))

vi.mock('@/features/review/studyWarmup', () => ({
  consumePrefetchedStudySession: (...args: unknown[]) =>
    mocks.consumePrefetchedStudySession(...args),
}))

vi.mock('@/features/review/components/MindMapReviewFlow', () => ({
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
          onClick={() =>
            props.onComplete({
              durationSeconds: 9,
              completionMode: 'manual_complete',
              revealedRemaining: true,
              redNodeIds: ['a', 'b'],
            })
          }
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
      <button type="button" onClick={() => props.onConfirm(2, false)}>
        confirm stage
      </button>
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
  const completeWithoutStage = vi.fn<(data: TestData) => Promise<void>>()
  const submitStage = vi.fn<
    (
      data: TestData,
      payload: CompleteFlowPayload,
      targetReviewNumber: number,
      needsPractice: boolean,
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
    completeWithoutStage: (nextData: TestData) => completeWithoutStage(nextData),
    submitStage: (
      nextData: TestData,
      payload: CompleteFlowPayload,
      targetReviewNumber: number,
      needsPractice: boolean,
    ) => submitStage(nextData, payload, targetReviewNumber, needsPractice),
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

  it('saves, clears, restarts, and completes non-stage practice sessions through the configured operations', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'complete flow' }))
    await waitFor(() => expect(setup.completeWithoutStage).toHaveBeenCalledWith(setup.data))
  })

  it('opens stage selection after refreshing stale stage metadata and submits the selected stage', async () => {
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
        currentReviewNumber: 0,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'confirm stage' }))
    await waitFor(() => expect(setup.submitStage).toHaveBeenCalledTimes(1))
    expect(setup.submitStage).toHaveBeenCalledWith(
      refreshedData,
      {
        durationSeconds: 9,
        completionMode: 'manual_complete',
        revealedRemaining: true,
        redNodeIds: ['a', 'b'],
      },
      2,
      false,
    )
  })
})
