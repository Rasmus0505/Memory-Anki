// Must be imported before the widget: it registers the `vi.mock` calls for the
// dialog's module boundaries, and ESM imports run in source order.
import {
  ensureFreestyleOverlayQuizApiMock,
  getPalaceEditorApiMock,
  getPalaceQuizQuestionsApiMock,
  getPalaceQuizQuestionsByIdsApiMock,
} from './FreestyleScopeQuizDialog.mocks'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQuizSessionProgress } from '@/modules/quiz/public'
import { renderScopeQuizDialog } from './FreestyleScopeQuizDialog.testHelpers'

function question(id: number) {
  return {
    id,
    palace_id: 7,
    sort_order: id,
    correct_count: 0,
    incorrect_count: 0,
    attempt_count: 0,
    question_type: 'multiple_choice',
    stem: `第 ${id} 题干`,
    options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
    answer_payload: { correct_option_id: 'A' },
    analysis: '',
    source_meta: {},
    created_at: null,
    updated_at: null,
  }
}

function questionBlock(id: number, number: number, suffix = '') {
  return [
    `${number}. 第 ${id} 题干${suffix}`,
    '   A. A',
    '   B. B',
    '   答案：A. A',
  ]
}

describe('FreestyleScopeQuizDialog 导出错题', () => {
  beforeEach(() => {
    clearQuizSessionProgress()
    vi.clearAllMocks()
    ensureFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 1,
      plan: {
        overlay_quiz: {
          question_ids: [11, 12, 13],
          current_index: 0,
          completed_ids: [11, 12],
          states: {
            11: { resolved: true, correct: false, selectedOptionId: 'B' },
            12: { resolved: true, correct: true, selectedOptionId: 'A' },
          },
          quiz_scope: 'cross_palace_random',
          seed: 1,
          scope_signature: 'sig',
          limit_reached: false,
          candidate_count: 3,
          question_palace_ids: { 11: 7, 12: 7, 13: 7 },
        },
      },
    } as never)
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [question(11), question(12), question(13)],
      item_count: 3,
    } as never)
    getPalaceEditorApiMock.mockResolvedValue({
      palace: { id: 7, title: '第一节' },
      editor_doc: {
        root: {
          data: { text: '第一节' },
          children: [{ data: { text: '知识点' }, children: [] }],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)
    getPalaceQuizQuestionsApiMock.mockResolvedValue({
      items: [question(11), question(12)],
    } as never)
  })

  async function openExportMenu() {
    renderScopeQuizDialog()
    const trigger = await screen.findByRole('button', { name: '导出错题' })
    // The round's answers arrive after the first render; wait until the export
    // is actually enabled. Space opens the menu because the quiz shortcut layer
    // already owns Arrow/Enter while a question is on screen.
    await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false))
    await act(async () => {
      fireEvent.keyDown(trigger, { key: ' ' })
    })
  }

  it('copies only the questions still answered wrong', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await openExportMenu()

    const item = await screen.findByRole('menuitem', { name: /只复制当前答错/ })
    await act(async () => { fireEvent.click(item) })

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]?.[0]).toBe([
      '本轮错题（1 道）',
      '',
      ...questionBlock(11, 1),
    ].join('\n'))
    expect(getPalaceEditorApiMock).not.toHaveBeenCalled()
  })

  it('adds the involved palace outline and complete question bank', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await openExportMenu()

    const item = await screen.findByRole('menuitem', { name: /另附涉及宫殿/ })
    await act(async () => { fireEvent.click(item) })

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(getPalaceEditorApiMock).toHaveBeenCalledWith(7)
    expect(getPalaceQuizQuestionsApiMock).toHaveBeenCalledWith(7)
    expect(writeText.mock.calls[0]?.[0]).toBe([
      '本轮错题（1 道）',
      '',
      ...questionBlock(11, 1),
      '',
      '────────',
      '',
      '宫殿：第一节',
      '',
      '脑图',
      '- 第一节',
      '  - 知识点',
      '',
      '全部题目（2 道）',
      '',
      ...questionBlock(11, 1, '（本轮答错）'),
      '',
      ...questionBlock(12, 2),
    ].join('\n'))
  })

  it('keeps the export disabled until the round has a wrong answer', async () => {
    ensureFreestyleOverlayQuizApiMock.mockResolvedValue({
      round_id: 'round-1',
      plan_version: 1,
      plan: {
        overlay_quiz: {
          question_ids: [11],
          current_index: 0,
          completed_ids: [11],
          states: { 11: { resolved: true, correct: true, selectedOptionId: 'A' } },
          quiz_scope: 'cross_palace_random',
          seed: 1,
          scope_signature: 'sig',
          limit_reached: false,
          candidate_count: 1,
          question_palace_ids: { 11: 7 },
        },
      },
    } as never)
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [question(11)],
      item_count: 1,
    } as never)

    renderScopeQuizDialog()

    const trigger = await screen.findByRole('button', { name: '导出错题' })
    expect(trigger.hasAttribute('disabled')).toBe(true)
  })
})
