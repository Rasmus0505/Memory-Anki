import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { EnglishCourseDetail, EnglishCourseProgress } from '@/shared/api/contracts'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import EnglishCoursePage from '@/modules/english/ui/english/EnglishCoursePage'

const mocks = vi.hoisted(() => ({
  getEnglishCourseApiMock: vi.fn(),
  updateEnglishCourseProgressApiMock: vi.fn(),
  toastErrorMock: vi.fn(),
  playMock: vi.fn().mockResolvedValue(undefined),
  pauseMock: vi.fn(),
  sound: {
    playKeySound: vi.fn(),
    playWrongSound: vi.fn(),
    playCorrectSound: vi.fn(),
    playSentenceComplete: vi.fn(),
  },
}))

vi.mock('@/modules/english/domain/english-entity/api', () => ({
  buildEnglishCourseMediaUrl: (courseId: number) => `/media/${courseId}.mp4`,
  getEnglishCourseApi: mocks.getEnglishCourseApiMock,
  updateEnglishCourseProgressApi: mocks.updateEnglishCourseProgressApiMock,
}))

vi.mock('@/modules/english/ui/english/useEnglishTypingFeedbackSounds', () => ({
  useEnglishTypingFeedbackSounds: () => mocks.sound,
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastErrorMock,
    success: vi.fn(),
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
    title: 'Test Course',
    originalFilename: 'test.mp4',
    sentenceCount: 2,
    completedSentenceCount: 0,
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
    <MemoryRouter initialEntries={['/english/1']}>
      <Routes>
        <Route path="/english/:id" element={<EnglishCoursePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function press(key: string, code = '') {
  fireEvent.keyDown(window, { key, code: code || key })
}

async function loadCourse(course: EnglishCourseDetail = buildCourse()) {
  mocks.getEnglishCourseApiMock.mockResolvedValue(course)
  renderPage()
  expect(await screen.findByText(course.title)).toBeTruthy()
  const video = document.querySelector('video') as HTMLVideoElement
  expect(video).toBeTruthy()
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    writable: true,
    value: 0,
  })
  fireEvent.loadedMetadata(video)
  await waitFor(() => {
    expect(mocks.playMock).toHaveBeenCalled()
  })
  return video
}

function typeWord(word: string) {
  for (const char of word) {
    press(char)
  }
}

describe('EnglishCoursePage', () => {
  beforeEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    mocks.getEnglishCourseApiMock.mockReset()
    mocks.updateEnglishCourseProgressApiMock.mockReset()
    mocks.updateEnglishCourseProgressApiMock.mockResolvedValue(buildProgress())
    mocks.toastErrorMock.mockReset()
    mocks.playMock.mockReset()
    mocks.playMock.mockResolvedValue(undefined)
    mocks.pauseMock.mockReset()
    Object.values(mocks.sound).forEach((mock) => mock.mockReset())
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      writable: true,
      value: mocks.playMock,
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      writable: true,
      value: mocks.pauseMock,
    })
  })

  it('renders the theatre stage and autoplays the first sentence', async () => {
    await loadCourse()

    expect(screen.getByTestId('english-course-workbench').className).toContain('ed-page--theater')
    expect(screen.getByText('SENTENCE 01')).toBeTruthy()
    expect(screen.getByText('Test Course')).toBeTruthy()
    expect(screen.getByRole('button', { name: '播放模式：单句' })).toBeTruthy()
    expect(screen.getByTestId('english-word-0').getAttribute('data-active-word')).toBe('true')
    expect(mocks.playMock).toHaveBeenCalledTimes(1)
  })

  it('resumes at the saved sentence position', async () => {
    await loadCourse(
      buildCourse({
        progress: buildProgress({ currentSentenceIndex: 1, completedSentenceIndexes: [0] }),
      }),
    )

    expect(screen.getByText('SENTENCE 02')).toBeTruthy()
    expect(screen.getByTestId('english-word-2')).toBeTruthy()
  })

  it('toggles between single-sentence and continuous playback', async () => {
    await loadCourse()
    expect(screen.getByRole('button', { name: '播放模式：单句' })).toBeTruthy()

    press('F3', 'F3')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '播放模式：连播' })).toBeTruthy()
    })

    press('F3', 'F3')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '播放模式：单句' })).toBeTruthy()
    })
  })

  it('stops at the current sentence end in single mode', async () => {
    await loadCourse()
    const video = document.querySelector('video') as HTMLVideoElement
    fireEvent.play(video)
    video.currentTime = 1.05

    await waitFor(() => {
      expect(mocks.pauseMock).toHaveBeenCalled()
    })
    expect(screen.getByText('SENTENCE 01')).toBeTruthy()
  })

  it('keeps playing across sentence boundaries in continuous mode', async () => {
    await loadCourse()
    press('F3', 'F3')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '播放模式：连播' })).toBeTruthy()
    })

    const video = document.querySelector('video') as HTMLVideoElement
    fireEvent.play(video)
    video.currentTime = 1.05

    await waitFor(() => {
      expect(screen.getByText('SENTENCE 02')).toBeTruthy()
    })
    expect(mocks.pauseMock).not.toHaveBeenCalled()
  })

  it('colours letters as they are typed and judges a whole word', async () => {
    await loadCourse()

    typeWord('hexx')
    const word = screen.getByTestId('english-word-0')
    const states = Array.from(word.querySelectorAll('[data-letter-state]')).map((node) =>
      node.getAttribute('data-letter-state'),
    )
    expect(states).toEqual(['correct', 'correct', 'wrong', 'wrong', 'caret'])
    expect(word.getAttribute('data-status')).toBe('active')
    expect(mocks.sound.playKeySound).toHaveBeenCalledTimes(4)

    press('Backspace', 'Backspace')
    press('Backspace', 'Backspace')
    typeWord('llo')
    await waitFor(() => {
      expect(screen.getByTestId('english-word-0').getAttribute('data-status')).toBe('correct')
    })
    expect(mocks.sound.playKeySound).toHaveBeenCalledTimes(7)
    expect(screen.getByTestId('english-word-1').getAttribute('data-active-word')).toBe('true')
    expect(mocks.sound.playCorrectSound).toHaveBeenCalled()
  })

  it('plays the error sound, shakes, and clears a wrong full word', async () => {
    await loadCourse()

    typeWord('helox')
    expect(screen.getByTestId('english-word-0').getAttribute('data-status')).toBe('wrong')
    expect(mocks.sound.playWrongSound).toHaveBeenCalled()

    await waitFor(
      () => {
        expect(screen.getByTestId('english-word-0').getAttribute('data-status')).toBe('active')
        expect(screen.getByTestId('english-word-0').querySelectorAll('.ed-letter__ink')).toHaveLength(0)
      },
      { timeout: 1800 },
    )
  })

  it('completes a sentence, shows translation, and persists progress', async () => {
    await loadCourse()

    typeWord('hello')
    typeWord('world')

    await waitFor(() => {
      expect(mocks.updateEnglishCourseProgressApiMock).toHaveBeenCalledWith(1, {
        currentSentenceIndex: 1,
        completedSentenceIndexes: [0],
      })
    })
    expect(mocks.sound.playSentenceComplete).toHaveBeenCalled()
    const translation = screen.getByTestId('english-course-inline-translation')
    expect(translation.textContent).toContain('你好 世界')
    expect(screen.getByText('SENTENCE 01')).toBeTruthy()

    press('Enter', 'Enter')
    await waitFor(() => {
      expect(screen.getByTestId('english-course-inline-translation').textContent).toContain('译文已隐藏')
    })
  })

  it('reveals one letter and one whole word with the default shortcuts', async () => {
    await loadCourse()

    press('ArrowUp', 'ArrowUp')
    await waitFor(() => {
      const firstLetter = screen
        .getByTestId('english-word-0')
        .querySelector('[data-letter-state="hinted"]')
      expect(firstLetter).toBeTruthy()
      expect(firstLetter?.textContent).toBe('h')
    })

    press('ArrowDown', 'ArrowDown')
    await waitFor(() => {
      expect(screen.getByTestId('english-word-0').getAttribute('data-status')).toBe('correct')
      expect(screen.getByTestId('english-word-1').getAttribute('data-active-word')).toBe('true')
    })

    press('ArrowDown', 'ArrowDown')
    press('ArrowDown', 'ArrowDown')
    press('ArrowDown', 'ArrowDown')
    await waitFor(() => {
      expect(screen.getByTestId('english-course-inline-translation').textContent).toContain('你好 世界')
    })
  })

  it('does not leave a stuck wrong word when navigating before the auto-clear', async () => {
    await loadCourse()

    typeWord('helox')
    expect(screen.getByTestId('english-word-0').getAttribute('data-status')).toBe('wrong')
    press('ArrowRight', 'ArrowRight')
    await waitFor(() => expect(screen.getByText('SENTENCE 02')).toBeTruthy())
    press('ArrowLeft', 'ArrowLeft')
    await waitFor(() => {
      expect(screen.getByText('SENTENCE 01')).toBeTruthy()
      expect(screen.getByTestId('english-word-0').getAttribute('data-status')).toBe('active')
      expect(screen.getByTestId('english-word-0').querySelectorAll('.ed-letter__ink')).toHaveLength(0)
    })
  })

  it('navigates sentences with the arrow shortcuts and replays with Space', async () => {
    await loadCourse()

    press('ArrowRight', 'ArrowRight')
    await waitFor(() => {
      expect(screen.getByText('SENTENCE 02')).toBeTruthy()
    })
    expect(mocks.playMock).toHaveBeenCalled()

    press('ArrowLeft', 'ArrowLeft')
    await waitFor(() => {
      expect(screen.getByText('SENTENCE 01')).toBeTruthy()
    })

    mocks.playMock.mockClear()
    press(' ', 'Space')
    await waitFor(() => {
      expect(mocks.playMock).toHaveBeenCalledTimes(1)
    })
  })

  it('toggles the mask, cycles layouts, and opens the settings panel', async () => {
    await loadCourse()

    expect(screen.queryByTestId('english-dictation-mask')).toBeNull()
    press('`', 'Backquote')
    expect(await screen.findByTestId('english-dictation-mask')).toBeTruthy()
    press('`', 'Backquote')
    await waitFor(() => {
      expect(screen.queryByTestId('english-dictation-mask')).toBeNull()
    })

    press('F2', 'F2')
    await waitFor(() => {
      expect(screen.getByTestId('english-course-workbench').className).toContain('ed-page--classic')
    })

    press('F1', 'F1')
    expect(await screen.findByRole('dialog', { name: '快捷键与练习设置' })).toBeTruthy()
    press('Escape', 'Escape')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '快捷键与练习设置' })).toBeNull()
    })
  })

  it('shows a completion summary and restarts the round', async () => {
    await loadCourse()

    typeWord('hello')
    typeWord('world')
    press('ArrowRight', 'ArrowRight')
    await waitFor(() => expect(screen.getByText('SENTENCE 02')).toBeTruthy())
    typeWord('how')
    typeWord('are')
    typeWord('you')

    expect(await screen.findByText('CURTAIN CALL', {}, { timeout: 2500 })).toBeTruthy()
    expect(screen.getAllByText('Test Course').length).toBeGreaterThan(0)

    press('Enter', 'Enter')
    await waitFor(() => {
      expect(screen.queryByText('CURTAIN CALL')).toBeNull()
      expect(screen.getByText('SENTENCE 01')).toBeTruthy()
    })
  })

  it('clears a completed sentence for retyping with Home', async () => {
    await loadCourse()
    typeWord('hello')
    typeWord('world')
    await waitFor(() => {
      expect(screen.getByTestId('english-word-0').getAttribute('data-status')).toBe('correct')
    })

    press('Home', 'Home')
    await waitFor(() => {
      expect(screen.getByTestId('english-word-0').getAttribute('data-active-word')).toBe('true')
      expect(screen.getByTestId('english-word-0').getAttribute('data-status')).toBe('active')
    })

    typeWord('hello')
    typeWord('world')
    await waitFor(() => {
      expect(screen.getByTestId('english-word-0').getAttribute('data-status')).toBe('correct')
    })
    press('Backspace', 'Backspace')
    await waitFor(() => {
      expect(screen.getByTestId('english-word-0').getAttribute('data-active-word')).toBe('true')
      expect(screen.getByTestId('english-word-0').getAttribute('data-status')).toBe('active')
    })
  })
})
