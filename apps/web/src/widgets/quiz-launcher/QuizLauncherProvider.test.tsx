import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  QuizLauncherProvider,
  useQuizLauncher,
} from '@/widgets/quiz-launcher'
import {
  __resetBackgroundTaskStoreForTest,
  getBackgroundTasks,
} from '@/shared/background-tasks/backgroundTaskRegistry'

const getPalaceApiMock = vi.fn()
const getSubjectsApiMock = vi.fn()
const promptForAiOptionsMock = vi.fn()
const autoGenerateAndSavePalaceQuizMock = vi.fn()
const dispatchGlobalFeedbackMock = vi.fn()

vi.mock('@/entities/palace/api', () => ({
  getPalaceApi: (...args: unknown[]) => getPalaceApiMock(...args),
}))

vi.mock('@/entities/knowledge/api', () => ({
  getSubjectsApi: (...args: unknown[]) => getSubjectsApiMock(...args),
}))

vi.mock('@/entities/ai-runtime', () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: (...args: unknown[]) => promptForAiOptionsMock(...args),
    aiRunConfigDialog: null,
  }),
}))

vi.mock('@/features/palace-quiz/quizGenerationController', () => ({
  autoGenerateAndSavePalaceQuiz: (...args: unknown[]) =>
    autoGenerateAndSavePalaceQuizMock(...args),
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: (...args: unknown[]) => dispatchGlobalFeedbackMock(...args),
}))

function LauncherHarness({
  scene,
  reviewEditorDoc,
}: {
  scene: 'edit' | 'practice' | 'review'
  reviewEditorDoc?: any
}) {
  const { openQuizLauncher } = useQuizLauncher()
  const location = useLocation()

  return (
    <>
      <button
        type="button"
        onClick={() => openQuizLauncher({ palaceId: 1, scene, reviewEditorDoc })}
      >
        打开做题入口
      </button>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
    </>
  )
}

describe('QuizLauncherProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    __resetBackgroundTaskStoreForTest()
    getPalaceApiMock.mockResolvedValue({
      id: 1,
      title: '细胞生物学宫殿',
      mini_palaces: [],
      chapters: [{ id: 1, subject: { id: 2, name: '生物' } }],
    })
    getSubjectsApiMock.mockResolvedValue([{ id: 2, name: '生物' }])
    promptForAiOptionsMock.mockResolvedValue({})
    autoGenerateAndSavePalaceQuizMock.mockResolvedValue({
      preview: {
        palace_id: 1,
        questions: [],
        source_meta: {
          source_kind: 'review-mindmap',
          page_numbers: null,
          image_names: null,
          extra_prompt: '',
          ai_call_log_id: 'log-1',
          generated_at: '2026-06-15T00:00:00',
          generation_mode: 'review_mindmap',
        },
        ai_call_log_id: 'log-1',
      },
      savedCount: 4,
    })
  })

  afterEach(() => {
    __resetBackgroundTaskStoreForTest()
  })

  it('opens the unified launcher and navigates directly to practice mode', async () => {
    render(
      <MemoryRouter initialEntries={['/palaces/1/edit']}>
        <QuizLauncherProvider>
          <LauncherHarness scene="edit" />
        </QuizLauncherProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '打开做题入口' }))

    expect(await screen.findByText('直接进入做题')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '直接进入做题' }))

    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_nav_open_practice',
      expect.objectContaining({ label: '直接进入做题', audioScope: 'global' }),
    )

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/palaces/1/quiz?tab=practice')
    })
  })

  it('starts review-based generation as a quiz-generation background task', async () => {
    render(
      <MemoryRouter initialEntries={['/review/session/1']}>
        <QuizLauncherProvider>
          <LauncherHarness
            scene="review"
            reviewEditorDoc={{
              root: {
                data: { text: 'Root', uid: 'root' },
                children: [],
              },
            }}
          />
        </QuizLauncherProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '打开做题入口' }))

    expect(await screen.findByRole('button', { name: '基于当前复习脑图' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '生成新题并稍后去做' }))

    await waitFor(() => {
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_generate_start',
        expect.objectContaining({ audioScope: 'global' }),
      )
    })

    await waitFor(() => {
      expect(autoGenerateAndSavePalaceQuizMock).toHaveBeenCalledWith(
        expect.objectContaining({
          palaceId: 1,
          sourceKind: 'review-mindmap',
          reviewMindmap: expect.objectContaining({
            mode: 'chapter',
            question_count: 6,
          }),
        }),
      )
    })

    await waitFor(() => {
      const [task] = getBackgroundTasks()
      expect(task.kind).toBe('quiz-generation')
      expect(task.status).toBe('completed')
      expect(task.navigateTarget).toBe('/palaces/1/quiz?tab=practice')
      expect(task.detail).toContain('已保存 4 题')
    })
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_generate_save',
      expect.objectContaining({ label: '已入题库', audioScope: 'global' }),
    )
  })
})
