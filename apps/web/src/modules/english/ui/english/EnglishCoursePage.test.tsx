import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type {
  EnglishCourseDetail,
  EnglishCourseProgress,
  EnglishSentenceCheckResponse,
} from '@/shared/api/contracts'
import EnglishCoursePage from '@/modules/english/ui/english/EnglishCoursePage'

const mocks = vi.hoisted(() => ({
  getEnglishCourseApiMock: vi.fn(),
  checkEnglishSentenceApiMock: vi.fn(),
  updateEnglishCourseProgressApiMock: vi.fn(),
  shouldAutoStartOnPageEnterMock: vi.fn(() => true),
  timerStartMock: vi.fn(),
  timerRegisterActivityMock: vi.fn(),
  toastErrorMock: vi.fn(),
  mediaPlayMock: vi.fn().mockResolvedValue(undefined),
  mediaPauseMock: vi.fn(),
  timerController: {
    effectiveSeconds: 0,
    idleSeconds: 0,
    pauseCount: 0,
    status: 'idle',
    startedAt: null,
    durationEdited: false,
    glowState: 'idle',
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    leaveScene: vi.fn(),
    adjustDuration: vi.fn(),
    complete: vi.fn(),
    registerActivity: vi.fn(),
    logEvent: vi.fn(),
    reset: vi.fn(),
  },
}))

vi.mock('@/modules/english/domain/english-entity/api', () => ({
  buildEnglishCourseMediaUrl: (courseId: number) => `/media/${courseId}.mp4`,
  checkEnglishSentenceApi: mocks.checkEnglishSentenceApiMock,
  getEnglishCourseApi: mocks.getEnglishCourseApiMock,
  updateEnglishCourseProgressApi: mocks.updateEnglishCourseProgressApiMock,
}))

vi.mock('@/shared/hooks/useTimedSession', () => ({
  shouldAutoStartOnPageEnter: mocks.shouldAutoStartOnPageEnterMock,
  useTimedSession: () => mocks.timerController,
}))

vi.mock('@/shared/components/session/SessionTimerBar', () => ({
  SessionTimerBar: ({ layout }: { layout?: 'card' | 'compact' }) => (
    <div data-testid="session-timer-bar" data-layout={layout ?? 'card'} />
  ),
}))

vi.mock('@/modules/english/ui/english/useEnglishTypingFeedbackSounds', () => ({
  useEnglishTypingFeedbackSounds: () => ({
    playKeySound: vi.fn(),
    playWrongSound: vi.fn(),
    playCorrectSound: vi.fn(),
    playSentenceComplete: vi.fn(),
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastErrorMock,
  },
}))

function buildProgress(overrides: Partial<EnglishCourseProgress> = {}): EnglishCourseProgress {
  return {
    currentSentenceIndex: 0,
    completedSentenceIndexes: [],
    completed: false,
    updatedAt: null,
    ...overrides,
  }
}

function buildCourse(overrides: Partial<EnglishCourseDetail> = {}): EnglishCourseDetail {
  return {
    id: 1,
    title: '测试英语课',
    originalFilename: 'test.mp4',
    sentenceCount: 2,
    durationSeconds: 8,
    status: 'unfinished',
    currentSentenceIndex: 0,
    updatedAt: null,
    createdAt: null,
    mediaUrl: '/media/1.mp4',
    sentences: [
      {
        id: 101,
        index: 0,
        textEn: 'hello world',
        textZh: '你好 世界',
        startMs: 0,
        endMs: 1000,
        tokens: ['hello', 'world'],
      },
      {
        id: 102,
        index: 1,
        textEn: 'how are you',
        textZh: '你好吗',
        startMs: 1100,
        endMs: 2200,
        tokens: ['how', 'are', 'you'],
      },
    ],
    progress: buildProgress(),
    ...overrides,
  }
}

function buildPassedCheckResponse(): EnglishSentenceCheckResponse {
  return {
    passed: true,
    tokenResults: [
      { input: 'hello', correct: true, missing: false, unexpected: false },
      { input: 'world', correct: true, missing: false, unexpected: false },
    ],
    normalizedInput: ['hello', 'world'],
    tokenCount: 2,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderPage() {
  return render(
    <>
      <div data-testid="outside-space">outside</div>
      <MemoryRouter initialEntries={['/english/1']}>
        <Routes>
          <Route path="/english/:id" element={<EnglishCoursePage />} />
        </Routes>
      </MemoryRouter>
    </>,
  )
}

function getVideoElement() {
  const video = document.querySelector('video')
  expect(video).toBeTruthy()
  return video as HTMLVideoElement
}

async function typeLetters(input: HTMLElement, letters: string) {
  for (const letter of letters) {
    await act(async () => {
      fireEvent.keyDown(input, { key: letter })
    })
  }
}

async function advancePlayback(video: HTMLVideoElement, currentTime: number) {
  await act(async () => {
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      writable: true,
      value: currentTime,
    })
    fireEvent.timeUpdate(video)
  })
}

async function finishInitialPreview(currentTime = 1.05) {
  const input = (await screen.findByTestId('english-typing-input')) as HTMLInputElement
  const video = getVideoElement()
  await waitFor(() => {
    expect(mocks.mediaPlayMock).toHaveBeenCalled()
  })
  await act(async () => {
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      writable: true,
      value: currentTime,
    })
    fireEvent.ended(video)
  })
  await waitFor(() => {
    expect(mocks.mediaPauseMock).toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
  })
  return { input, video }
}

describe('EnglishCoursePage', () => {
  beforeEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
    mocks.shouldAutoStartOnPageEnterMock.mockReset()
    mocks.shouldAutoStartOnPageEnterMock.mockReturnValue(true)
    mocks.timerStartMock.mockReset()
    mocks.timerRegisterActivityMock.mockReset()
    mocks.getEnglishCourseApiMock.mockReset()
    mocks.checkEnglishSentenceApiMock.mockReset()
    mocks.updateEnglishCourseProgressApiMock.mockReset()
    mocks.toastErrorMock.mockReset()
    mocks.mediaPlayMock.mockReset()
    mocks.mediaPlayMock.mockResolvedValue(undefined)
    mocks.mediaPauseMock.mockReset()
    mocks.timerController.status = 'idle'
    mocks.timerController.startedAt = null
    mocks.timerController.start = mocks.timerStartMock
    mocks.timerController.pause = vi.fn()
    mocks.timerController.resume = vi.fn()
    mocks.timerController.adjustDuration = vi.fn()
    mocks.timerController.complete = vi.fn()
    mocks.timerController.registerActivity = mocks.timerRegisterActivityMock
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      writable: true,
      value: mocks.mediaPlayMock,
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      writable: true,
      value: mocks.mediaPauseMock,
    })
  })

  it('auto plays the sentence once, pauses, and focuses the typing input', async () => {
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())

    renderPage()

    expect(await screen.findByText('测试英语课')).toBeTruthy()
    expect(mocks.mediaPlayMock).toHaveBeenCalledTimes(1)

    const { input } = await finishInitialPreview()
    expect(document.activeElement).toBe(input)
  })

  it('shows the current translation immediately after local completion before server validation returns', async () => {
    const deferredCheck = createDeferred<EnglishSentenceCheckResponse>()
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())
    mocks.checkEnglishSentenceApiMock.mockReturnValue(deferredCheck.promise)
    mocks.updateEnglishCourseProgressApiMock.mockResolvedValue(
      buildProgress({
        currentSentenceIndex: 1,
        completedSentenceIndexes: [0],
      }),
    )

    renderPage()

    const { input } = await finishInitialPreview()
    const translationCard = screen.getByTestId('english-course-inline-translation')

    await typeLetters(input, 'helloworld')

    await waitFor(() => {
      expect(mocks.checkEnglishSentenceApiMock).toHaveBeenCalledWith(1, {
        sentenceIndex: 0,
        inputText: 'hello world',
      })
    })
    expect(within(translationCard).getByText('当前句译文')).toBeTruthy()
    expect(within(translationCard).getByText('你好 世界')).toBeTruthy()

    deferredCheck.resolve(buildPassedCheckResponse())
    await waitFor(() => {
      expect(mocks.updateEnglishCourseProgressApiMock).toHaveBeenCalled()
    })
  })

  it('treats shortcut-based reveal completion the same as manual typing', async () => {
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())
    mocks.checkEnglishSentenceApiMock.mockResolvedValue(buildPassedCheckResponse())
    mocks.updateEnglishCourseProgressApiMock.mockResolvedValue(
      buildProgress({
        currentSentenceIndex: 1,
        completedSentenceIndexes: [0],
      }),
    )

    renderPage()

    const { input } = await finishInitialPreview()
    const translationCard = screen.getByTestId('english-course-inline-translation')

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true })

    await waitFor(() => {
      expect(mocks.checkEnglishSentenceApiMock).toHaveBeenCalledWith(1, {
        sentenceIndex: 0,
        inputText: 'hello world',
      })
    })
    expect(within(translationCard).getByText('你好 世界')).toBeTruthy()
  })

  it('chain plays the current sentence into the next sentence and pauses at the end of the next sentence', async () => {
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())
    mocks.checkEnglishSentenceApiMock.mockResolvedValue(buildPassedCheckResponse())
    mocks.updateEnglishCourseProgressApiMock.mockResolvedValue(
      buildProgress({
        currentSentenceIndex: 1,
        completedSentenceIndexes: [0],
      }),
    )

    renderPage()

    const { input, video } = await finishInitialPreview(2.21)
    mocks.mediaPlayMock.mockClear()
    mocks.mediaPauseMock.mockClear()

    await typeLetters(input, 'helloworld')

    const translationCard = screen.getByTestId('english-course-inline-translation')
    expect(await within(translationCard).findByText('你好 世界')).toBeTruthy()
    await waitFor(() => {
      expect(mocks.mediaPlayMock).toHaveBeenCalledTimes(1)
    })

    await advancePlayback(video, 1.11)
    await waitFor(() => {
      expect(screen.getByText('Sentence 2 / 2')).toBeTruthy()
    })
    expect(within(translationCard).getByText('上一句译文')).toBeTruthy()
    expect(within(translationCard).getByText('你好 世界')).toBeTruthy()
    expect(screen.getByTestId('english-word-2')).toBeTruthy()

    await advancePlayback(video, 2.21)
    await waitFor(() => {
      expect(mocks.mediaPauseMock).toHaveBeenCalled()
    })
    expect(screen.getByText('Sentence 2 / 2')).toBeTruthy()
    expect(within(translationCard).getByText('你好 世界')).toBeTruthy()
  })

  it('replays only the final sentence after completion and then shows the completed view', async () => {
    mocks.getEnglishCourseApiMock.mockResolvedValue(
      buildCourse({
        progress: buildProgress({
          currentSentenceIndex: 1,
          completedSentenceIndexes: [0],
        }),
      }),
    )
    mocks.checkEnglishSentenceApiMock.mockResolvedValue({
      passed: true,
      tokenResults: [
        { input: 'how', correct: true, missing: false, unexpected: false },
        { input: 'are', correct: true, missing: false, unexpected: false },
        { input: 'you', correct: true, missing: false, unexpected: false },
      ],
      normalizedInput: ['how', 'are', 'you'],
      tokenCount: 3,
    })
    mocks.updateEnglishCourseProgressApiMock.mockResolvedValue(
      buildProgress({
        currentSentenceIndex: 2,
        completedSentenceIndexes: [0, 1],
        completed: true,
      }),
    )

    renderPage()

    expect(await screen.findByText('Sentence 2 / 2')).toBeTruthy()
    const translationCard = screen.getByTestId('english-course-inline-translation')
    expect(within(translationCard).getByText('上一句译文')).toBeTruthy()
    expect(within(translationCard).getByText('你好 世界')).toBeTruthy()

    const { input, video } = await finishInitialPreview()
    mocks.mediaPlayMock.mockClear()

    await typeLetters(input, 'howareyou')

    expect(await within(translationCard).findByText('你好吗')).toBeTruthy()
    await waitFor(() => {
      expect(mocks.mediaPlayMock).toHaveBeenCalledTimes(1)
    })

    await advancePlayback(video, 2.21)

    await waitFor(() => {
      expect(screen.getByText('课程已完成')).toBeTruthy()
    })
  })

  it('rolls back to the failed sentence if server validation rejects after the next sentence has appeared', async () => {
    const deferredCheck = createDeferred<EnglishSentenceCheckResponse>()
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())
    mocks.checkEnglishSentenceApiMock.mockReturnValue(deferredCheck.promise)

    renderPage()

    const { input, video } = await finishInitialPreview()
    await typeLetters(input, 'helloworld')

    await advancePlayback(video, 1.11)
    expect(screen.getByText('Sentence 2 / 2')).toBeTruthy()

    deferredCheck.resolve({
      passed: false,
      tokenResults: [
        { input: 'hello', correct: true, missing: false, unexpected: false },
        { input: 'wrld', correct: false, missing: false, unexpected: false },
      ],
      normalizedInput: ['hello', 'wrld'],
      tokenCount: 2,
    })

    await waitFor(() => {
      expect(screen.getByText('Sentence 1 / 2')).toBeTruthy()
    })
    expect(await screen.findByText('本句本地已完整显示，但最终校验未通过，请重新拼写这一句。')).toBeTruthy()
    expect(mocks.updateEnglishCourseProgressApiMock).not.toHaveBeenCalled()
    expect(within(screen.getByTestId('english-course-inline-translation')).getByText('翻译区')).toBeTruthy()
  })

  it('auto starts the timer and uses the fixed dense layout for long sentences', async () => {
    mocks.getEnglishCourseApiMock.mockResolvedValue(
      buildCourse({
        sentences: [
          {
            id: 201,
            index: 0,
            textEn: 'international collaboration requires carefully coordinated communication across departments',
            textZh: '跨部门协作需要非常细致的沟通协调。',
            startMs: 0,
            endMs: 1600,
            tokens: [
              'international',
              'collaboration',
              'requires',
              'carefully',
              'coordinated',
              'communication',
              'across',
              'departments',
            ],
          },
        ],
        sentenceCount: 1,
      }),
    )

    renderPage()

    await screen.findByText('测试英语课')

    await waitFor(() => {
      expect(mocks.shouldAutoStartOnPageEnterMock).toHaveBeenCalledWith(expect.anything(), 'english')
    })
    expect(mocks.timerStartMock).toHaveBeenCalledWith({ source: 'page_enter', scene: 'english_course' })
    expect(screen.queryByTestId('session-timer-bar')).toBeNull()
    expect(screen.getByTestId('english-course-workbench').className).toContain('overflow-hidden')
    expect(screen.getByTestId('english-course-main-panel').dataset.density).toBe('dense')
    expect(screen.getByTestId('english-word-rail').dataset.density).toBe('dense')
    expect(screen.queryByTestId('english-course-helper-content')).toBeNull()
  })

  it('falls back to the first unfinished sentence when progress index is out of range', async () => {
    mocks.getEnglishCourseApiMock.mockResolvedValue(
      buildCourse({
        progress: buildProgress({
          currentSentenceIndex: 99,
          completedSentenceIndexes: [0],
        }),
      }),
    )

    renderPage()

    expect(await screen.findByText('测试英语课')).toBeTruthy()
    expect(screen.getByText('Sentence 2 / 2')).toBeTruthy()
    expect(screen.getByText('当前句拼写')).toBeTruthy()
    expect(screen.getByTestId('english-typing-input')).toBeTruthy()
  })
})
