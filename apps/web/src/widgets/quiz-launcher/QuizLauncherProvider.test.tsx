import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  QuizLauncherProvider,
  useQuizLauncher,
} from '@/widgets/quiz-launcher'

const getPalaceApiMock = vi.fn()
const getSubjectsApiMock = vi.fn()
const promptForAiOptionsMock = vi.fn()
const dispatchGlobalFeedbackMock = vi.fn()

vi.mock('@/modules/content/domain/palace-entity/api', () => ({
  getPalaceApi: (...args: unknown[]) => getPalaceApiMock(...args),
}))

vi.mock('@/modules/content/domain/knowledge-entity/api', () => ({
  getSubjectsApi: (...args: unknown[]) => getSubjectsApiMock(...args),
}))

vi.mock('@/modules/settings/domain/ai-runtime-entity', () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: (...args: unknown[]) => promptForAiOptionsMock(...args),
    aiRunConfigDialog: null,
  }),
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
    getPalaceApiMock.mockResolvedValue({
      id: 1,
      title: '细胞生物学宫殿',
      mini_palaces: [],
      chapters: [{ id: 1, subject: { id: 2, name: '生物' } }],
    })
    getSubjectsApiMock.mockResolvedValue([{ id: 2, name: '生物' }])
    promptForAiOptionsMock.mockResolvedValue({})
  })

  afterEach(() => {
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

  it('does not offer question generation from the launcher', async () => {
    render(
      <MemoryRouter initialEntries={['/freestyle?palaceId=1']}>
        <QuizLauncherProvider>
          <LauncherHarness scene="review" />
        </QuizLauncherProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '打开做题入口' }))

    expect(await screen.findByRole('button', { name: '直接进入做题' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '基于当前复习脑图' })).toBeNull()
    expect(screen.queryByRole('button', { name: '生成并预览' })).toBeNull()
    expect(screen.queryByRole('button', { name: '确认保存到题库' })).toBeNull()
  })
})
