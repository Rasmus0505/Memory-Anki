import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import type { EnglishCourseSummary, EnglishWorkspaceResponse } from '@/shared/api/contracts'
import EnglishWorkspacePage from '@/modules/english/ui/english/EnglishWorkspacePage'

const mocks = vi.hoisted(() => ({
  deleteEnglishCourseApiMock: vi.fn(),
  getEnglishWorkspaceApiMock: vi.fn(),
  importEnglishCourseApiMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/modules/english/domain/english-entity/api', () => ({
  deleteEnglishCourseApi: mocks.deleteEnglishCourseApiMock,
  getEnglishWorkspaceApi: mocks.getEnglishWorkspaceApiMock,
  importEnglishCourseApi: mocks.importEnglishCourseApiMock,
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastErrorMock,
    success: mocks.toastSuccessMock,
  },
}))

function buildCourse(overrides: Partial<EnglishCourseSummary> = {}): EnglishCourseSummary {
  return {
    id: 7,
    title: 'The Quiet Ocean',
    originalFilename: 'ocean.mp4',
    sentenceCount: 12,
    completedSentenceCount: 3,
    durationSeconds: 180,
    status: 'unfinished',
    currentSentenceIndex: 3,
    updatedAt: '2026-10-20T10:00:00',
    createdAt: '2026-10-01T10:00:00',
    ...overrides,
  }
}

function buildWorkspace(overrides: Partial<EnglishWorkspaceResponse> = {}): EnglishWorkspaceResponse {
  return {
    currentTask: null,
    continueCourse: buildCourse(),
    recentCourses: [
      buildCourse(),
      buildCourse({
        id: 8,
        title: 'Night Train',
        status: 'completed',
        currentSentenceIndex: 9,
        sentenceCount: 9,
        completedSentenceCount: 9,
      }),
    ],
    stats: {
      total_courses: 2,
      unfinished_courses: 1,
      completed_courses: 1,
    },
    ...overrides,
  }
}

function CourseRoute() {
  const params = useParams()
  return <div data-testid="course-route">course:{params.id}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/english/listening']}>
      <Routes>
        <Route path="/english/listening" element={<EnglishWorkspacePage />} />
        <Route path="/english/listening/courses/:id" element={<CourseRoute />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EnglishWorkspacePage', () => {
  beforeEach(() => {
    mocks.deleteEnglishCourseApiMock.mockReset()
    mocks.getEnglishWorkspaceApiMock.mockReset()
    mocks.importEnglishCourseApiMock.mockReset()
    mocks.toastErrorMock.mockReset()
    mocks.toastSuccessMock.mockReset()
    window.confirm = vi.fn(() => true)
  })

  it('renders the dark listening library with continue card and history', async () => {
    mocks.getEnglishWorkspaceApiMock.mockResolvedValue(buildWorkspace())

    renderPage()

    expect(await screen.findByTestId('english-dictation-library')).toBeTruthy()
    expect(screen.getByTestId('english-zone-nav')).toBeTruthy()
    expect(screen.getByTestId('english-continue-card')).toBeTruthy()
    expect(screen.getAllByText('The Quiet Ocean').length).toBeGreaterThan(0)
    expect(screen.getByText('Night Train')).toBeTruthy()
    expect(screen.getByText('片库')).toBeTruthy()
  })

  it('does not claim the shelf is empty when every course is completed', async () => {
    mocks.getEnglishWorkspaceApiMock.mockResolvedValue(
      buildWorkspace({
        continueCourse: null,
        recentCourses: [
          buildCourse({
            id: 8,
            title: 'Night Train',
            status: 'completed',
            currentSentenceIndex: 9,
            sentenceCount: 9,
            completedSentenceCount: 9,
          }),
        ],
      }),
    )

    renderPage()

    expect(await screen.findByText('手头的课程都完成了')).toBeTruthy()
    expect(screen.getByText('Night Train')).toBeTruthy()
    expect(screen.queryByText('片库还是空的')).toBeNull()
  })

  it('filters the shelf by status and search query', async () => {
    mocks.getEnglishWorkspaceApiMock.mockResolvedValue(buildWorkspace())

    renderPage()
    await screen.findAllByText('The Quiet Ocean')

    fireEvent.click(screen.getByRole('tab', { name: '已完成' }))
    let grid = screen.getByTestId('english-course-grid')
    expect(within(grid).queryByText('The Quiet Ocean')).toBeNull()
    expect(within(grid).getByText('Night Train')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '全部' }))
    fireEvent.change(screen.getByLabelText('搜索课程'), { target: { value: 'ocean' } })
    grid = screen.getByTestId('english-course-grid')
    expect(within(grid).getByText('The Quiet Ocean')).toBeTruthy()
    expect(within(grid).queryByText('Night Train')).toBeNull()
  })

  it('imports a video with subtitles and navigates into the new course', async () => {
    mocks.getEnglishWorkspaceApiMock.mockResolvedValue(buildWorkspace())
    mocks.importEnglishCourseApiMock.mockResolvedValue({
      course: buildCourse({ id: 21, title: 'New Lesson' }),
      matchedTranslationCount: 2,
    })

    renderPage()
    await screen.findAllByText('The Quiet Ocean')

    fireEvent.click(screen.getByRole('button', { name: '导入课程' }))
    expect(screen.getByRole('dialog', { name: '导入英语课程' })).toBeTruthy()

    const video = new File(['video'], 'new-lesson.mp4', { type: 'video/mp4' })
    const english = new File(['1\n00:00:00,000 --> 00:00:01,000\nHello.\n'], 'new.en.srt', {
      type: 'text/plain',
    })
    const chinese = new File(['1\n00:00:00,000 --> 00:00:01,000\n你好。\n'], 'new.zh.srt', {
      type: 'text/plain',
    })

    fireEvent.change(document.querySelector('#ed-import-video') as HTMLInputElement, {
      target: { files: [video] },
    })
    fireEvent.change(document.querySelector('#ed-import-english') as HTMLInputElement, {
      target: { files: [english] },
    })
    fireEvent.change(document.querySelector('#ed-import-chinese') as HTMLInputElement, {
      target: { files: [chinese] },
    })

    const titleInput = screen.getByPlaceholderText('默认使用视频文件名') as HTMLInputElement
    await waitFor(() => {
      expect(titleInput.value).toBe('new lesson')
    })

    fireEvent.click(screen.getByRole('button', { name: /导入并开始/ }))

    await waitFor(() => {
      expect(mocks.importEnglishCourseApiMock).toHaveBeenCalledWith({
        videoFile: video,
        englishSubtitle: english,
        chineseSubtitle: chinese,
        title: 'new lesson',
      })
    })
    expect((await screen.findByTestId('course-route')).textContent).toBe('course:21')
    expect(mocks.toastSuccessMock).toHaveBeenCalled()
  })

  it('shows an import error from the API without leaving the dialog', async () => {
    mocks.getEnglishWorkspaceApiMock.mockResolvedValue(buildWorkspace())
    mocks.importEnglishCourseApiMock.mockRejectedValue(new Error('字幕文件中没有解析到可用句子。'))

    renderPage()
    await screen.findAllByText('The Quiet Ocean')
    fireEvent.click(screen.getByRole('button', { name: '导入课程' }))
    fireEvent.change(document.querySelector('#ed-import-video') as HTMLInputElement, {
      target: { files: [new File(['v'], 'lesson.mp4', { type: 'video/mp4' })] },
    })
    fireEvent.change(document.querySelector('#ed-import-english') as HTMLInputElement, {
      target: { files: [new File(['s'], 'lesson.srt', { type: 'text/plain' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: /导入并开始/ }))

    expect(await screen.findByText('字幕文件中没有解析到可用句子。')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '导入英语课程' })).toBeTruthy()
  })

  it('deletes a course after confirmation', async () => {
    mocks.getEnglishWorkspaceApiMock.mockResolvedValue(buildWorkspace())
    mocks.deleteEnglishCourseApiMock.mockResolvedValue({ ok: true })

    renderPage()
    await screen.findAllByText('The Quiet Ocean')

    fireEvent.click(screen.getByRole('button', { name: '删除课程 The Quiet Ocean' }))
    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => {
      expect(mocks.deleteEnglishCourseApiMock).toHaveBeenCalledWith(7)
    })
  })
})
