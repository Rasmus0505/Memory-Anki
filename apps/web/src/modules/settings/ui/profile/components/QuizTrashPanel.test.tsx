import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getQuizTrashApi,
  permanentDeletePalaceQuizQuestionApi,
  purgeQuizTrashApi,
  restorePalaceQuizQuestionApi,
} from '@/modules/quiz/public'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { QuizTrashPanel } from './QuizTrashPanel'

vi.mock('@/modules/quiz/public', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/quiz/public')>()
  return {
    ...actual,
    getQuizTrashApi: vi.fn(),
    restorePalaceQuizQuestionApi: vi.fn(),
    permanentDeletePalaceQuizQuestionApi: vi.fn(),
    purgeQuizTrashApi: vi.fn(),
  }
})
vi.mock('@/shared/components/ui/native-dialog', () => ({ appConfirm: vi.fn(async () => false) }))
vi.mock('@/shared/feedback/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const getQuizTrashApiMock = vi.mocked(getQuizTrashApi)
const restoreMock = vi.mocked(restorePalaceQuizQuestionApi)
const permanentDeleteMock = vi.mocked(permanentDeletePalaceQuizQuestionApi)
const purgeMock = vi.mocked(purgeQuizTrashApi)
const appConfirmMock = vi.mocked(appConfirm)

const trashItem = {
  id: 42,
  palace_id: 1,
  sort_order: 3,
  correct_count: 2,
  incorrect_count: 1,
  attempt_count: 3,
  segment_ids: [],
  question_type: 'multiple_choice' as const,
  stem: '回收站里的选择题题干',
  options: [
    { id: 'A', text: '正确项' },
    { id: 'B', text: '干扰项' },
  ],
  answer_payload: { correct_option_id: 'A' },
  analysis: '这是解析内容。',
  source_meta: {
    source_kind: 'manual',
    page_numbers: null,
    image_names: null,
    extra_prompt: '',
    ai_call_log_id: null,
    generated_at: '2026-09-20T00:00:00',
    generation_mode: 'manual',
  },
  created_at: null,
  updated_at: null,
  deleted_at: '2026-09-20T10:00:00',
  palace_title: '生物宫殿',
  palace_deleted: false,
}

describe('QuizTrashPanel', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders trash items with palace, stats, and preview dialog', async () => {
    getQuizTrashApiMock.mockResolvedValue({ items: [trashItem], total: 1, limit: 500, offset: 0 })
    render(<QuizTrashPanel />)

    expect(await screen.findByText('回收站里的选择题题干')).toBeTruthy()
    expect(screen.getByText('生物宫殿')).toBeTruthy()
    expect(screen.getByText('答对 2 / 作答 3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(await screen.findByText('这是解析内容。')).toBeTruthy()
    expect(screen.getByText(/正确项/)).toBeTruthy()
  })

  it('shows the empty state when nothing was deleted', async () => {
    getQuizTrashApiMock.mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0 })
    render(<QuizTrashPanel />)

    expect(await screen.findByText('回收站是空的')).toBeTruthy()
    expect((screen.getByRole('button', { name: /清空回收站/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('restores a question without confirmation', async () => {
    getQuizTrashApiMock.mockResolvedValue({ items: [trashItem], total: 1, limit: 500, offset: 0 })
    restoreMock.mockResolvedValue({ item: trashItem as never })
    render(<QuizTrashPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /恢复/ }))

    await waitFor(() => {
      expect(restoreMock).toHaveBeenCalledWith(42)
    })
    expect(await screen.findByText('回收站是空的')).toBeTruthy()
  })

  it('permanently deletes after appConfirm', async () => {
    getQuizTrashApiMock.mockResolvedValue({ items: [trashItem], total: 1, limit: 500, offset: 0 })
    appConfirmMock.mockResolvedValue(true)
    permanentDeleteMock.mockResolvedValue({ ok: true })
    render(<QuizTrashPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /永久删除/ }))

    await waitFor(() => {
      expect(appConfirmMock).toHaveBeenCalled()
      expect(permanentDeleteMock).toHaveBeenCalledWith(42)
    })
    expect(await screen.findByText('回收站是空的')).toBeTruthy()
  })

  it('purges the whole trash after confirmation', async () => {
    getQuizTrashApiMock.mockResolvedValue({ items: [trashItem], total: 1, limit: 500, offset: 0 })
    appConfirmMock.mockResolvedValue(true)
    purgeMock.mockResolvedValue({ ok: true, purged_count: 1 })
    render(<QuizTrashPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /清空回收站/ }))

    await waitFor(() => {
      expect(purgeMock).toHaveBeenCalled()
    })
    expect(await screen.findByText('回收站是空的')).toBeTruthy()
  })
})
