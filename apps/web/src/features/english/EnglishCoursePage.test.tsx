import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { EnglishCourseDetail, EnglishCourseProgress } from '@/shared/api/contracts'
import EnglishCoursePage from '@/features/english/EnglishCoursePage'
import { DEFAULT_ENGLISH_PRACTICE_SETTINGS, ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY } from '@/features/english/englishPracticeSettings'

const mocks = vi.hoisted(() => ({
  getEnglishCourseApiMock: vi.fn(),
  checkEnglishSentenceApiMock: vi.fn(),
  updateEnglishCourseProgressApiMock: vi.fn(),
  getEnglishCourseGenerationLogApiMock: vi.fn(),
  shouldAutoStartOnPageEnterMock: vi.fn(() => true),
  timerStartMock: vi.fn(),
  timerRegisterActivityMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  mediaPlayMock: vi.fn().mockResolvedValue(undefined),
  mediaPauseMock: vi.fn(),
  timerController: {
    effectiveSeconds: 0,
    idleSeconds: 0,
    pauseCount: 0,
    status: 'idle',
    startedAt: null,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    adjustDuration: vi.fn(),
    complete: vi.fn(),
    registerActivity: vi.fn(),
  },
}))

vi.mock('@/shared/api/modules/english', () => ({
  buildEnglishCourseMediaUrl: (courseId: number) => `/media/${courseId}.mp4`,
  checkEnglishSentenceApi: mocks.checkEnglishSentenceApiMock,
  getEnglishCourseApi: mocks.getEnglishCourseApiMock,
  getEnglishCourseGenerationLogApi: mocks.getEnglishCourseGenerationLogApiMock,
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

vi.mock('@/features/english/components/EnglishGenerationLogDialog', () => ({
  EnglishGenerationLogDialog: () => null,
}))

vi.mock('@/features/english/useEnglishTypingFeedbackSounds', () => ({
  useEnglishTypingFeedbackSounds: () => ({
    playKeySound: vi.fn(),
    playWrongSound: vi.fn(),
    playCorrectSound: vi.fn(),
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastErrorMock,
    success: mocks.toastSuccessMock,
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

async function typeLetters(input: HTMLElement, letters: string) {
  for (const letter of letters) {
    await act(async () => {
      fireEvent.keyDown(input, { key: letter })
    })
  }
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
    mocks.getEnglishCourseGenerationLogApiMock.mockReset()
    mocks.toastErrorMock.mockReset()
    mocks.toastSuccessMock.mockReset()
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

  it('renders inline translation after a correct sentence and then auto-advances', async () => {
    window.localStorage.setItem(
      ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
        flow: {
          autoAdvanceOnPass: true,
        },
        replay: {
          autoReplayOnPass: false,
          singleSentenceLoopEnabled: false,
        },
      }),
    )
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())
    mocks.checkEnglishSentenceApiMock.mockResolvedValue({
      passed: true,
      tokenResults: [
        { input: 'hello', correct: true, missing: false, unexpected: false },
        { input: 'world', correct: true, missing: false, unexpected: false },
      ],
      normalizedInput: ['hello', 'world'],
      tokenCount: 2,
    })
    mocks.updateEnglishCourseProgressApiMock.mockResolvedValue(
      buildProgress({
        currentSentenceIndex: 1,
        completedSentenceIndexes: [0],
      }),
    )

    renderPage()

    expect(await screen.findByText('测试英语课')).toBeTruthy()
    const translationCard = screen.getByTestId('english-course-inline-translation')
    expect(within(translationCard).getByText('答对当前句后这里会显示本句译文。')).toBeTruthy()

    const input = screen.getByTestId('english-typing-input')
    await typeLetters(input, 'helloworld')

    await waitFor(() => {
      expect(mocks.checkEnglishSentenceApiMock).toHaveBeenCalledWith(1, {
        sentenceIndex: 0,
        inputText: 'hello world',
      })
    })
    expect(await within(translationCard).findByText('你好 世界')).toBeTruthy()

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
    })
    expect(screen.queryByText('Sentence 2 / 2')).toBeNull()

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 650))
    })

    await waitFor(() => {
      expect(screen.getByText('Sentence 2 / 2')).toBeTruthy()
    })
  }, 10000)

  it('keeps the passed sentence on screen when auto advance is disabled', async () => {
    window.localStorage.setItem(
      ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
        flow: {
          autoAdvanceOnPass: false,
        },
        replay: {
          autoReplayOnPass: false,
          singleSentenceLoopEnabled: false,
        },
      }),
    )
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())
    mocks.checkEnglishSentenceApiMock.mockResolvedValue({
      passed: true,
      tokenResults: [
        { input: 'hello', correct: true, missing: false, unexpected: false },
        { input: 'world', correct: true, missing: false, unexpected: false },
      ],
      normalizedInput: ['hello', 'world'],
      tokenCount: 2,
    })
    mocks.updateEnglishCourseProgressApiMock.mockResolvedValue(
      buildProgress({
        currentSentenceIndex: 1,
        completedSentenceIndexes: [0],
      }),
    )

    renderPage()

    const input = await screen.findByTestId('english-typing-input')
    await typeLetters(input, 'helloworld')

    const translationCard = await screen.findByTestId('english-course-inline-translation')
    expect(await within(translationCard).findByText('你好 世界')).toBeTruthy()

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
    })

    expect(screen.getByText('Sentence 1 / 2')).toBeTruthy()
    expect(screen.queryByText('Sentence 2 / 2')).toBeNull()
  }, 10000)

  it('advances only after pass replay finishes when auto replay is enabled', async () => {
    mocks.mediaPlayMock.mockImplementation(function (this: HTMLMediaElement) {
      window.setTimeout(() => {
        Object.defineProperty(this, 'currentTime', {
          configurable: true,
          writable: true,
          value: 1.1,
        })
        fireEvent.ended(this)
      }, 40)
      return Promise.resolve()
    })

    window.localStorage.setItem(
      ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
        flow: {
          autoAdvanceOnPass: true,
        },
        replay: {
          autoReplayOnPass: true,
          singleSentenceLoopEnabled: false,
        },
      }),
    )
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())
    mocks.checkEnglishSentenceApiMock.mockResolvedValue({
      passed: true,
      tokenResults: [
        { input: 'hello', correct: true, missing: false, unexpected: false },
        { input: 'world', correct: true, missing: false, unexpected: false },
      ],
      normalizedInput: ['hello', 'world'],
      tokenCount: 2,
    })
    mocks.updateEnglishCourseProgressApiMock.mockResolvedValue(
      buildProgress({
        currentSentenceIndex: 1,
        completedSentenceIndexes: [0],
      }),
    )

    renderPage()

    const input = await screen.findByTestId('english-typing-input')
    await typeLetters(input, 'helloworld')

    expect(await screen.findByText('你好 世界')).toBeTruthy()
    expect(mocks.mediaPlayMock).toHaveBeenCalled()

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })

    expect(screen.getByText('Sentence 1 / 2')).toBeTruthy()

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 80))
    })

    expect(screen.getByText('Sentence 2 / 2')).toBeTruthy()
  }, 10000)

  it('does not auto advance while single sentence loop is enabled', async () => {
    window.localStorage.setItem(
      ENGLISH_PRACTICE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_ENGLISH_PRACTICE_SETTINGS,
        flow: {
          autoAdvanceOnPass: true,
        },
        replay: {
          autoReplayOnPass: false,
          singleSentenceLoopEnabled: true,
        },
      }),
    )
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())
    mocks.checkEnglishSentenceApiMock.mockResolvedValue({
      passed: true,
      tokenResults: [
        { input: 'hello', correct: true, missing: false, unexpected: false },
        { input: 'world', correct: true, missing: false, unexpected: false },
      ],
      normalizedInput: ['hello', 'world'],
      tokenCount: 2,
    })
    mocks.updateEnglishCourseProgressApiMock.mockResolvedValue(
      buildProgress({
        currentSentenceIndex: 1,
        completedSentenceIndexes: [0],
      }),
    )

    renderPage()

    const input = await screen.findByTestId('english-typing-input')
    await typeLetters(input, 'helloworld')

    expect(await screen.findByText('你好 世界')).toBeTruthy()

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
    })

    expect(screen.getByText('Sentence 1 / 2')).toBeTruthy()
    expect(screen.queryByText('Sentence 2 / 2')).toBeNull()
  }, 10000)

  it('auto starts the timer on course load with the english scene', async () => {
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())

    renderPage()

    await screen.findByText('测试英语课')

    await waitFor(() => {
      expect(mocks.shouldAutoStartOnPageEnterMock).toHaveBeenCalled()
    })
    expect(mocks.shouldAutoStartOnPageEnterMock).toHaveBeenCalledWith(expect.anything(), 'english')
    expect(mocks.timerStartMock).toHaveBeenCalledWith({ source: 'page_enter', scene: 'english_course' })
  })

  it('restores focus back to the hidden typing input after blur', async () => {
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())

    renderPage()

    const input = (await screen.findByTestId('english-typing-input')) as HTMLInputElement
    expect(document.activeElement).toBe(input)

    fireEvent.blur(input, { relatedTarget: null })

    await waitFor(() => {
      expect(document.activeElement).toBe(input)
    })
  })

  it('replays the current sentence with the global shortcut', async () => {
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())

    renderPage()

    await screen.findByText('测试英语课')
    mocks.mediaPlayMock.mockClear()

    fireEvent.keyDown(window, { key: ' ', code: 'Space', shiftKey: true })

    await waitFor(() => {
      expect(mocks.mediaPlayMock).toHaveBeenCalled()
    })
  })

  it('renders the compact timer bar and collapsed helper panel layout', async () => {
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())

    renderPage()

    await screen.findByText('测试英语课')
    expect(screen.getByTestId('session-timer-bar').dataset.layout).toBe('compact')
    const workbench = screen.getByTestId('english-course-workbench')
    const mainPanelWrapper = screen.getByTestId('english-course-main-panel').parentElement

    expect(workbench).toBeTruthy()
    expect(screen.getByTestId('english-course-main-panel')).toBeTruthy()
    expect(screen.getByTestId('english-course-helper-panel')).toBeTruthy()
    expect(screen.queryByTestId('english-course-helper-content')).toBeNull()
    expect(workbench.className).toContain('lg:min-h-[calc(100vh-3rem)]')
    expect(workbench.className).not.toContain('lg:h-[calc(100vh-3rem)]')
    expect(workbench.className).not.toContain('lg:overflow-hidden')
    expect(mainPanelWrapper).toBeTruthy()
    expect(mainPanelWrapper?.className).not.toContain('lg:overflow-hidden')

    fireEvent.click(screen.getByRole('button', { name: /辅助面板/ }))
    fireEvent.click(screen.getByRole('button', { name: '快捷键' }))

    expect(await screen.findByText('点击“练习设置”可以重新录制快捷键。默认全部使用带修饰键组合，避免和拼写输入冲突。')).toBeTruthy()
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

  it('does not advance when the final server-side check fails', async () => {
    mocks.getEnglishCourseApiMock.mockResolvedValue(buildCourse())
    mocks.checkEnglishSentenceApiMock.mockResolvedValue({
      passed: false,
      tokenResults: [
        { input: 'hello', correct: true, missing: false, unexpected: false },
        { input: 'wrld', correct: false, missing: false, unexpected: false },
      ],
      normalizedInput: ['hello', 'wrld'],
      tokenCount: 2,
    })

    renderPage()

    const input = (await screen.findByTestId('english-typing-input')) as HTMLInputElement
    await typeLetters(input, 'hello')
    await waitFor(() => {
      expect(screen.getByTestId('english-word-0').dataset.status).toBe('correct')
    })
    await typeLetters(input, 'world')

    expect(await screen.findByText('本地拼写与最终校验不同步，请重置本句后再试。')).toBeTruthy()
    expect(mocks.updateEnglishCourseProgressApiMock).not.toHaveBeenCalled()
    expect(screen.getByText('Sentence 1 / 2')).toBeTruthy()
  })
})
