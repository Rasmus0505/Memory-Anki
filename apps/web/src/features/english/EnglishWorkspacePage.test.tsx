import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import type {
  EnglishGenerationLogResponse,
  EnglishGenerationTask,
  EnglishWorkspaceResponse,
} from '@/shared/api/contracts'
import EnglishWorkspacePage from '@/features/english/EnglishWorkspacePage'

const mocks = vi.hoisted(() => ({
  clearEnglishCurrentTaskApiMock: vi.fn(),
  deleteEnglishCourseApiMock: vi.fn(),
  getEnglishTaskGenerationLogApiMock: vi.fn(),
  getEnglishWorkspaceApiMock: vi.fn(),
  retryEnglishCurrentTaskApiMock: vi.fn(),
  subscribeEnglishTaskStreamMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  uploadEnglishVideoApiMock: vi.fn(),
  latestStreamHandlers: null as {
    onDone?: (payload: { task: EnglishGenerationTask }) => void
    onError?: (payload: { task?: EnglishGenerationTask; error: string }) => void
    onLog?: (payload: { event: EnglishGenerationLogResponse['events'][number] }) => void
    onStatus?: (payload: { task: EnglishGenerationTask }) => void
  } | null,
}))

vi.mock('@/features/english/api', () => ({
  clearEnglishCurrentTaskApi: mocks.clearEnglishCurrentTaskApiMock,
  deleteEnglishCourseApi: mocks.deleteEnglishCourseApiMock,
  getEnglishTaskGenerationLogApi: mocks.getEnglishTaskGenerationLogApiMock,
  getEnglishWorkspaceApi: mocks.getEnglishWorkspaceApiMock,
  retryEnglishCurrentTaskApi: mocks.retryEnglishCurrentTaskApiMock,
  subscribeEnglishTaskStream: (taskId: string, handlers: NonNullable<typeof mocks.latestStreamHandlers>) => {
    mocks.subscribeEnglishTaskStreamMock(taskId, handlers)
    mocks.latestStreamHandlers = handlers
    return () => undefined
  },
  uploadEnglishVideoApi: mocks.uploadEnglishVideoApiMock,
}))

vi.mock('@/features/english/components/EnglishGenerationLogDialog', () => ({
  EnglishGenerationLogDialog: () => null,
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastErrorMock,
    success: mocks.toastSuccessMock,
  },
}))

function buildTask(overrides: Partial<EnglishGenerationTask> = {}): EnglishGenerationTask {
  return {
    id: 'task-1',
    status: 'running',
    stage: 'transcribe',
    progressPercent: 42,
    message: '正在转写音频',
    sourceFilename: 'lesson.mp4',
    fileSize: 12_345_678,
    errorMessage: '',
    courseId: null,
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

function buildWorkspace(overrides: Partial<EnglishWorkspaceResponse> = {}): EnglishWorkspaceResponse {
  return {
    currentTask: null,
    continueCourse: {
      id: 7,
      title: '继续课程',
      originalFilename: 'continue.mp4',
      sentenceCount: 12,
      durationSeconds: 180,
      status: 'unfinished',
      currentSentenceIndex: 3,
      updatedAt: null,
      createdAt: null,
    },
    recentCourses: [],
    stats: {
      total_courses: 2,
      unfinished_courses: 1,
      completed_courses: 1,
      total_reading_seconds: 0,
      total_practice_seconds: 0,
      total_seconds: 0,
      today_reading_seconds: 0,
      today_practice_seconds: 0,
      today_total_seconds: 0,
      weekly_reading_seconds: 0,
      weekly_practice_seconds: 0,
      weekly_total_seconds: 0,
    },
    ...overrides,
  }
}

function buildTaskLog(task: EnglishGenerationTask): EnglishGenerationLogResponse {
  return {
    task,
    events: [],
    aiLogs: [],
  }
}

function CourseRoute() {
  const params = useParams()
  return <div data-testid="course-route">course:{params.id}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/english']}>
      <Routes>
        <Route path="/english" element={<EnglishWorkspacePage />} />
        <Route path="/english/courses/:id" element={<CourseRoute />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EnglishWorkspacePage', () => {
  beforeEach(() => {
    mocks.clearEnglishCurrentTaskApiMock.mockReset()
    mocks.deleteEnglishCourseApiMock.mockReset()
    mocks.getEnglishTaskGenerationLogApiMock.mockReset()
    mocks.getEnglishWorkspaceApiMock.mockReset()
    mocks.retryEnglishCurrentTaskApiMock.mockReset()
    mocks.subscribeEnglishTaskStreamMock.mockReset()
    mocks.toastErrorMock.mockReset()
    mocks.toastSuccessMock.mockReset()
    mocks.uploadEnglishVideoApiMock.mockReset()
    mocks.latestStreamHandlers = null
    window.confirm = vi.fn(() => true)
  })

  it('prioritizes the current task view and hides upload actions while generation is active', async () => {
    const task = buildTask()
    mocks.getEnglishWorkspaceApiMock.mockResolvedValue(buildWorkspace({ currentTask: task }))
    mocks.getEnglishTaskGenerationLogApiMock.mockResolvedValue(buildTaskLog(task))

    renderPage()

    expect(await screen.findByText('当前生成任务')).toBeTruthy()
    expect(screen.getByText('课程生成完成后会自动进入练习页')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '上传并生成' })).toBeNull()
  })

  it('navigates straight into the generated course when the task completes', async () => {
    const task = buildTask()
    mocks.getEnglishWorkspaceApiMock
      .mockResolvedValueOnce(buildWorkspace({ currentTask: task }))
      .mockResolvedValue(buildWorkspace())
    mocks.getEnglishTaskGenerationLogApiMock.mockResolvedValue(buildTaskLog(task))

    renderPage()

    await screen.findByText('当前生成任务')

    await act(async () => {
      mocks.latestStreamHandlers?.onDone?.({
        task: buildTask({
          status: 'completed',
          stage: 'completed',
          progressPercent: 100,
          message: '课程已生成',
          courseId: 9,
        }),
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('course-route').textContent).toBe('course:9')
    })
    expect(mocks.toastSuccessMock).toHaveBeenCalledWith('英语课程已生成，正在进入课程。', undefined)
  })

  it('keeps retry and clear actions available for failed tasks', async () => {
    const failedTask = buildTask({
      status: 'failed',
      stage: 'failed',
      progressPercent: 100,
      message: '生成失败',
      errorMessage: 'mock failure',
    })
    mocks.getEnglishWorkspaceApiMock.mockResolvedValue(buildWorkspace({ currentTask: failedTask }))
    mocks.getEnglishTaskGenerationLogApiMock.mockResolvedValue(buildTaskLog(failedTask))
    mocks.retryEnglishCurrentTaskApiMock.mockResolvedValue({ task: buildTask({ status: 'queued', stage: 'queued' }) })
    mocks.clearEnglishCurrentTaskApiMock.mockResolvedValue({ ok: true })

    renderPage()

    expect(await screen.findByRole('button', { name: '重试' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => {
      expect(mocks.retryEnglishCurrentTaskApiMock).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(window.confirm).toHaveBeenCalledWith(
      '确定清除当前英语生成任务吗？此操作不可撤销，当前任务状态和生成日志会从工作台移除。',
    )
    await waitFor(() => {
      expect(mocks.clearEnglishCurrentTaskApiMock).toHaveBeenCalled()
    })
  })

  it('shows restart interruption copy for interrupted failed tasks', async () => {
    const interruptedTask = buildTask({
      status: 'failed',
      stage: 'interrupted',
      progressPercent: 45,
      message: '生成因服务重启被中断，可点击重试继续。',
      errorMessage: '服务重启导致任务中断。',
    })
    mocks.getEnglishWorkspaceApiMock.mockResolvedValue(buildWorkspace({ currentTask: interruptedTask }))
    mocks.getEnglishTaskGenerationLogApiMock.mockResolvedValue(buildTaskLog(interruptedTask))

    renderPage()

    expect(await screen.findByText('生成被服务重启中断')).toBeTruthy()
    expect(screen.getByText('点击重试将复用已完成的转写结果，不会重复计费。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })
})
