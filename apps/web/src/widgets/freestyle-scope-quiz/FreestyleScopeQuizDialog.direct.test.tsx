// Import the shared mocks before the widget: an ESM import list runs in source
// order, and importing the widget first would bind the real API modules.
import {
  deletePalaceQuizQuestionApiMock,
  getPalaceQuizQuestionsByIdsApiMock,
} from './FreestyleScopeQuizDialog.mocks'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { clearQuizSessionProgress, writeQuizSessionState } from '@/modules/quiz/public'
import { FreestyleScopeQuizDialog } from './FreestyleScopeQuizDialog'

const question = {
  id: 101,
  palace_id: 7,
  sort_order: 1,
  correct_count: 0,
  incorrect_count: 0,
  attempt_count: 0,
  question_type: 'multiple_choice',
  stem: '角标打开的关联题目',
  options: [{ id: 'A', text: '甲' }, { id: 'B', text: '乙' }],
  answer_payload: { correct_option_id: 'A' },
  analysis: '解析文本',
  marked: false,
  source_meta: {},
}

function renderDirect(overrides: {
  questionIds?: number[]
  onQuestionDeleted?: (questionId: number) => void
  onOpenChange?: (open: boolean) => void
} = {}) {
  return render(
    <FreestyleScopeQuizDialog
      source="questions"
      open
      onOpenChange={overrides.onOpenChange ?? vi.fn()}
      questionSet={{
        palaceId: 7,
        nodeUid: 'node-1',
        questionIds: overrides.questionIds ?? [101],
        onQuestionDeleted: overrides.onQuestionDeleted,
      }}
    />,
  )
}

describe('FreestyleScopeQuizDialog direct question set', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearQuizSessionProgress()
    resetClientPreferenceCacheForTest()
    vi.clearAllMocks()
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({ items: [question], item_count: 1 } as never)
    deletePalaceQuizQuestionApiMock.mockResolvedValue({ ok: true } as never)
  })

  it('uses the shared 做题 chrome and keeps round-only actions in the same slots', async () => {
    renderDirect()

    expect(await screen.findByText('角标打开的关联题目')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '做题' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '做题配置' })).toBeTruthy()
    const wrongPriority = screen.getByRole('button', { name: '错题优先' }) as HTMLButtonElement
    expect(wrongPriority.disabled).toBe(true)
    expect(screen.getByRole('button', { name: '移除本宫殿本轮题目' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: '做题快捷键' })).toBeNull()
    expect(screen.getByRole('button', { name: '查看宫殿' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制题目' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '打乱题库' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '清除进度' })).toBeTruthy()
    expect(getPalaceQuizQuestionsByIdsApiMock).toHaveBeenCalledWith([101])
  })

  it('opens shared shortcut and option-shuffle settings from 做题配置', async () => {
    renderDirect()
    await screen.findByText('角标打开的关联题目')

    fireEvent.click(screen.getByRole('button', { name: '做题配置' }))

    expect(screen.getByText('当前卡片关联的 1 道题')).toBeTruthy()
    expect(screen.getAllByText('快捷键')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: '自动打乱选项' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '录制下一题' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '完成配置' })).toBeTruthy()
  })

  it('deletes the last question and reports it to the opener', async () => {
    const onQuestionDeleted = vi.fn()
    const onOpenChange = vi.fn()
    renderDirect({ onQuestionDeleted, onOpenChange })
    await screen.findByText('角标打开的关联题目')

    fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
    fireEvent.click(await screen.findByRole('button', { name: '移入回收站' }))

    await waitFor(() => expect(deletePalaceQuizQuestionApiMock).toHaveBeenCalledWith(101))
    expect(onQuestionDeleted).toHaveBeenCalledWith(101)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('retries a direct load that only returned part of its question set', async () => {
    const secondQuestion = { ...question, id: 102, sort_order: 2, stem: '第二道关联题目' }
    getPalaceQuizQuestionsByIdsApiMock
      .mockResolvedValueOnce({ items: [question], item_count: 1 } as never)
      .mockResolvedValueOnce({ items: [question, secondQuestion], item_count: 2 } as never)
    renderDirect({ questionIds: [101, 102] })
    await screen.findByText('有些关联题目未能加载，可能已删除。')
    fireEvent.click(screen.getByRole('button', { name: '再试一次' }))
    await waitFor(() => expect(getPalaceQuizQuestionsByIdsApiMock).toHaveBeenCalledTimes(2))
    const questionIndexes = screen.getByTestId('freestyle-scope-quiz-dialog')
      .querySelectorAll<HTMLButtonElement>('[data-quiz-index-item]')
    fireEvent.click(questionIndexes[1]!)
    expect(await screen.findByText('第二道关联题目')).toBeTruthy()
    expect(screen.queryByText('有些关联题目未能加载，可能已删除。')).toBeNull()
  })

  it('resumes from shared progress and advances through the remaining questions', async () => {
    const secondQuestion = { ...question, id: 102, sort_order: 2, stem: '第二道关联题目' }
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [question, secondQuestion], item_count: 2,
    } as never)
    writeQuizSessionState(101, { resolved: true, correct: true }, 7)
    renderDirect({ questionIds: [101, 102] })

    expect(await screen.findByText('第二道关联题目')).toBeTruthy()
    expect(screen.getByText('已完成 1 / 2 题')).toBeTruthy()
    expect(screen.getByText('已答 1')).toBeTruthy()
  })

  it('disables 打乱题库 for a single question', async () => {
    renderDirect()
    await screen.findByText('角标打开的关联题目')

    expect(screen.getByRole('button', { name: '打乱题库' }).hasAttribute('disabled')).toBe(true)
  })
})
