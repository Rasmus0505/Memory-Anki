import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuizCopyQuestionsMenu } from './QuizCopyQuestionsMenu'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'

const getEditor = vi.fn()
vi.mock('@/modules/content/public', () => ({ getPalaceEditorApi: (...args: unknown[]) => getEditor(...args) }))
vi.mock('@/shared/feedback/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const question = (id: number, palaceId: number) => ({
  id, palace_id: palaceId, stem: `题目${id}`, question_type: 'multiple_choice',
  options: [{ id: 'A', text: '选项' }], answer_payload: { correct_option_id: 'A' }, analysis: '解析',
}) as PalaceQuizQuestion

const questions = [question(1, 1), question(2, 2)]

describe('题目复制菜单', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getEditor.mockImplementation(async (id: number) => ({
      palace: { title: `宫殿${id}` }, editor_doc: { root: { data: { text: `导图${id}` }, children: [] } },
    }))
  })

  it('默认只复制本题，可附带各宫殿导图与答题信息', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<QuizCopyQuestionsMenu questions={questions} currentQuestion={questions[1]} wrongQuestions={[questions[0]]} questionStates={{ 1: { resolved: true, correct: false, selectedOptionId: 'A' } }} fallbackPalaceId={1} />)
    fireEvent.keyDown(screen.getByRole('button', { name: '复制题目' }), { key: ' ' })
    expect(screen.getByRole('menuitemcheckbox', { name: '附带导图' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('menuitem', { name: '导出本题' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('题目2')
    expect(writeText.mock.calls[0][0]).not.toContain('题目1')
    expect(getEditor).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: '复制题目' }).hasAttribute('disabled')).toBe(false))
    fireEvent.keyDown(screen.getByRole('button', { name: '复制题目' }), { key: ' ' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '附带导图' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '答题信息' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出全部题' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText.mock.calls[1][0]).toContain('导图1')
    expect(writeText.mock.calls[1][0]).toContain('导图2')
    expect(writeText.mock.calls[1][0]).toContain('作答情况：答错\n   我的答案：A. 选项')
    expect(writeText.mock.calls[1][0]).toContain('作答情况：未作答')
  })

  it('导图读取失败时不写入不完整内容', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    getEditor.mockRejectedValue(new Error('读取失败'))
    const { toast } = await import('@/shared/feedback/toast')
    render(<QuizCopyQuestionsMenu questions={questions} currentQuestion={questions[0]} wrongQuestions={[]} questionStates={{ 1: { resolved: true, correct: false, selectedOptionId: 'A' } }} fallbackPalaceId={1} />)
    fireEvent.keyDown(screen.getByRole('button', { name: '复制题目' }), { key: ' ' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '附带导图' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '导出本题' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('读取失败'))
    expect(writeText).not.toHaveBeenCalled()
  })
})
