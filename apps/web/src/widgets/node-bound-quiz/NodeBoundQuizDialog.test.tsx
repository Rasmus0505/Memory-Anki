import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQuizSessionProgress, readQuizSessionState, saveQuizAnswerMode, writeQuizSessionState } from '@/modules/quiz/public'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { NodeBoundQuizDialog } from '@/widgets/node-bound-quiz'

const getPalaceQuizQuestionsByIdsApiMock = vi.fn()
const getPalaceQuizQuestionsApiMock = vi.fn()
const listPalaceQuizNodeBindingsApiMock = vi.fn()
const recordPalaceQuizChoiceAttemptApiMock = vi.fn()
const setPalaceQuizQuestionMarkedApiMock = vi.fn()
const deletePalaceQuizQuestionApiMock = vi.fn()

vi.mock('@/modules/settings/public', () => ({
  useAiRunConfigDialog: () => ({
    promptForAiOptions: vi.fn(),
    aiRunConfigDialog: null,
  }),
}))

vi.mock('@/modules/quiz/domain/quiz-entity/api', () => ({
  getPalaceQuizQuestionsByIdsApi: (...args: unknown[]) => getPalaceQuizQuestionsByIdsApiMock(...args),
  getPalaceQuizQuestionsApi: (...args: unknown[]) => getPalaceQuizQuestionsApiMock(...args),
  listPalaceQuizNodeBindingsApi: (...args: unknown[]) => listPalaceQuizNodeBindingsApiMock(...args),
  recordPalaceQuizChoiceAttemptApi: (...args: unknown[]) => recordPalaceQuizChoiceAttemptApiMock(...args),
  setPalaceQuizQuestionMarkedApi: (...args: unknown[]) => setPalaceQuizQuestionMarkedApiMock(...args),
  deletePalaceQuizQuestionApi: (...args: unknown[]) => deletePalaceQuizQuestionApiMock(...args),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: vi.fn(),
}))

vi.mock('@/modules/content/public', () => ({
  getPalacesGroupedApi: vi.fn(async () => ({
    groups: [],
    ungrouped: [],
    subjects: [{
      subject: null,
      chapter_groups: [],
      ungrouped_palaces: [{ id: 1, title: '第一节', resolved_title: '第一节新教育运动' }],
    }],
  })),
}))

vi.mock('@/widgets/palace-memory-lookup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/widgets/palace-memory-lookup')>()
  return {
    ...actual,
    PalaceMemoryLookupDialog: ({
    open,
    onOpenChange,
    currentPalaceId,
    focusNodeUid,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    currentPalaceId: number | null
    focusNodeUid?: string | null
  }) =>
    open ? (
      <div
        data-testid="palace-memory-lookup"
        data-palace-id={String(currentPalaceId)}
        data-focus-node={String(focusNodeUid ?? '')}
      >
        <button type="button" onClick={() => onOpenChange(false)}>
          关闭宫殿查看
        </button>
      </div>
    ) : null,
  }
})

const sampleQuestion = {
  id: 42,
  palace_id: 1,
  sort_order: 0,
  correct_count: 16,
  incorrect_count: 13,
  attempt_count: 29,
  last_attempt_at: null,
  segment_ids: [],
  question_type: 'multiple_choice' as const,
  stem: '下列哪一项是细胞膜的主要成分？',
  options: [
    { id: 'A', text: '磷脂' },
    { id: 'B', text: '纤维素' },
    { id: 'C', text: '淀粉' },
    { id: 'D', text: '糖原' },
  ],
  answer_payload: { correct_option_id: 'A' },
  analysis: '细胞膜主要由磷脂双分子层构成。',
  source_meta: {
    source_kind: 'manual',
    page_numbers: null,
    image_names: null,
    extra_prompt: '',
    ai_call_log_id: null,
    generated_at: '2026-07-26T00:00:00',
    generation_mode: 'manual',
  },
}

const secondQuestion = {
  ...sampleQuestion,
  id: 43,
  stem: '第二道关联题目',
}

const shortAnswerQuestion = {
  ...sampleQuestion,
  id: 41,
  sort_order: 0,
  question_type: 'short_answer' as const,
  stem: '简述细胞膜的主要成分。',
  options: [],
  answer_payload: { reference_answer: '磷脂双分子层。' },
}

describe('NodeBoundQuizDialog', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearQuizSessionProgress()
    resetClientPreferenceCacheForTest()
    saveQuizAnswerMode('choice')
    vi.clearAllMocks()
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [sampleQuestion, secondQuestion],
      item_count: 2,
    })
    getPalaceQuizQuestionsApiMock.mockResolvedValue({ items: [sampleQuestion, secondQuestion] })
    recordPalaceQuizChoiceAttemptApiMock.mockImplementation(async (questionId: number) => ({
      question: questionId === secondQuestion.id ? secondQuestion : sampleQuestion,
    }))
    deletePalaceQuizQuestionApiMock.mockResolvedValue({ ok: true })
    listPalaceQuizNodeBindingsApiMock.mockResolvedValue({
      items: [
        {
          question_id: 42,
          node_uid: 'node-1',
          palace_id: 1,
          question_owner_palace_id: 1,
        },
      ],
      item_count: 1,
    })
  })

  afterEach(() => {
    saveQuizAnswerMode('choice')
  })

  it('opens multiple-choice questions before short-answer questions', async () => {
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [shortAnswerQuestion, sampleQuestion],
      item_count: 2,
    })
    getPalaceQuizQuestionsApiMock.mockResolvedValue({
      items: [shortAnswerQuestion, sampleQuestion],
    })

    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[41, 42]}
        onQuestionCompleted={() => {}}
      />,
    )

    expect(await screen.findByText('下列哪一项是细胞膜的主要成分？')).toBeTruthy()
    expect(screen.getByText('选择题')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    expect(await screen.findByText('简述细胞膜的主要成分。')).toBeTruthy()
    expect(screen.getByText('简答题')).toBeTruthy()
  })

  it('renders the question stem above the options', async () => {
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42]}
        onQuestionCompleted={() => {}}
      />,
    )

    const stem = await screen.findByText('下列哪一项是细胞膜的主要成分？')
    expect(stem).toBeTruthy()
    expect(stem.closest('button')).toBeNull()
    expect(screen.getByText('选择题')).toBeTruthy()
    expect(screen.getByRole('button', { name: /磷脂/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /纤维素/ })).toBeTruthy()
  })

  it('shows historical attempt stats left of the question type badge', async () => {
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42]}
        onQuestionCompleted={() => {}}
      />,
    )

    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    const stats = screen.getByTestId('quiz-attempt-stats')
    const typeBadge = screen.getByText('选择题')
    expect(stats.textContent).toBe('16/29')
    expect(
      stats.compareDocumentPosition(typeBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('optimistically bumps attempt stats after answering', async () => {
    recordPalaceQuizChoiceAttemptApiMock.mockImplementation(
      () => new Promise(() => {}),
    )
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42]}
        onQuestionCompleted={() => {}}
      />,
    )

    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    expect(screen.getByTestId('quiz-attempt-stats').textContent).toBe('17/30')
  })

  it('opens the current palace lookup without closing the answer window', async () => {
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42]}
        onQuestionCompleted={() => {}}
      />,
    )

    const stem = await screen.findByText('下列哪一项是细胞膜的主要成分？')
    expect(screen.queryByTestId('palace-memory-lookup')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '查看宫殿' }))

    const lookup = screen.getByTestId('palace-memory-lookup')
    expect(lookup.getAttribute('data-palace-id')).toBe('1')
    expect(lookup.getAttribute('data-focus-node')).toBe('node-1')
    expect(stem).toBeTruthy()

    fireEvent.click(within(lookup).getByRole('button', { name: '关闭宫殿查看', hidden: true }))
    expect(screen.queryByTestId('palace-memory-lookup')).toBeNull()
    expect(screen.getByText('下列哪一项是细胞膜的主要成分？')).toBeTruthy()
  })

  it('hides the palace lookup button when no palace is available', () => {
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={null}
        nodeUid="node-1"
        questionIds={[42]}
        onQuestionCompleted={() => {}}
      />,
    )

    expect(screen.queryByRole('button', { name: '查看宫殿' })).toBeNull()
  })

  it('puts 清除进度 to the right of 查看宫殿 and clears the current answers', async () => {
    writeQuizSessionState(42, { resolved: true, correct: false, selectedOptionId: 'B' }, 1)
    writeQuizSessionState(43, { resolved: true, correct: true, selectedOptionId: 'A' }, 1)
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42, 43]}
        onQuestionCompleted={() => {}}
      />,
    )

    await screen.findByText('已答 2 / 2')
    const lookup = screen.getByRole('button', { name: '查看宫殿' })
    const clear = screen.getByRole('button', { name: '清除进度' })
    expect(lookup.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(clear)
    expect(screen.getByRole('radio', { name: '当前题' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '指定宫殿' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '全部题' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByText('已答 2 / 2')).toBeTruthy()
    expect(readQuizSessionState(42).resolved).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '清除进度' }))
    fireEvent.click(screen.getByRole('button', { name: '清除' }))

    expect(screen.getByText('已答 1 / 2')).toBeTruthy()
    expect(readQuizSessionState(42)).toEqual({})
    expect(readQuizSessionState(43).resolved).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '清除进度' }))
    fireEvent.click(screen.getByRole('radio', { name: '指定宫殿' }))
    expect((screen.getByRole('combobox', { name: '指定宫殿' }) as HTMLSelectElement).value).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: '清除' }))

    expect(screen.getByText('已答 0 / 2')).toBeTruthy()
    expect(readQuizSessionState(43)).toEqual({})
    expect(screen.getByText('16/29')).toBeTruthy()
  })

  it('answers the linked question with number and letter keys', async () => {
    const onQuestionCompleted = vi.fn()
    const firstRender = render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42]}
        onQuestionCompleted={onQuestionCompleted}
      />,
    )

    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    fireEvent.keyDown(window, { key: '2', code: 'Digit2' })

    expect(screen.getByText('回答错误')).toBeTruthy()
    expect(onQuestionCompleted).toHaveBeenCalledWith(42)

    firstRender.unmount()
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42]}
        onQuestionCompleted={onQuestionCompleted}
      />,
    )

    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    fireEvent.keyDown(window, { key: 'd', code: 'KeyD' })

    expect(screen.getByText('回答错误')).toBeTruthy()
    expect(onQuestionCompleted).toHaveBeenCalledWith(42)
  })

  it('moves through linked choices with vertical arrows and confirms with Enter', async () => {
    const onQuestionCompleted = vi.fn()
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42]}
        onQuestionCompleted={onQuestionCompleted}
      />,
    )

    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    fireEvent.keyDown(window, { key: 'ArrowDown', code: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' })

    expect(screen.getByText('回答错误')).toBeTruthy()
    expect(onQuestionCompleted).toHaveBeenCalledWith(42)
  })

  it('does not answer with number keys after switching to subjective recall', async () => {
    const onQuestionCompleted = vi.fn()
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42]}
        onQuestionCompleted={onQuestionCompleted}
      />,
    )

    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    fireEvent.click(screen.getByRole('button', { name: '主观' }))
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })

    expect(onQuestionCompleted).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('先写下你的答案，再点击提交')).toBeTruthy()
    expect(screen.getByText('细胞膜的主要成分是什么')).toBeTruthy()
    expect(screen.queryByText('下列哪一项是细胞膜的主要成分？')).toBeNull()
  })

  it('switches linked questions with horizontal arrows without submitting an option', async () => {
    const onQuestionCompleted = vi.fn()
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42, 43]}
        onQuestionCompleted={onQuestionCompleted}
      />,
    )

    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    fireEvent.keyDown(window, { key: 'ArrowRight', code: 'ArrowRight' })

    expect(await screen.findByText('第二道关联题目')).toBeTruthy()
    expect(screen.queryByText('回答错误')).toBeNull()
    fireEvent.keyDown(window, { key: 'ArrowLeft', code: 'ArrowLeft' })

    expect(await screen.findByText('下列哪一项是细胞膜的主要成分？')).toBeTruthy()
    expect(onQuestionCompleted).not.toHaveBeenCalled()
  })

  describe('window sizing and reach', () => {
    it('lets the floating window own its width instead of capping it at max-w-xl', async () => {
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42]}
          onQuestionCompleted={() => {}}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      // `max-w-xl` used to beat the floating panel's own width, so dragging the
      // right edge wider did nothing.
      const dialog = screen.getByTestId('node-bound-quiz-dialog')
      expect(dialog.className).toContain('max-w-none')
      expect(dialog.className).not.toContain('max-w-xl')
    })

    it('scrolls the body by flex instead of a fixed 70vh', async () => {
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42]}
          onQuestionCompleted={() => {}}
        />,
      )

      const stem = await screen.findByText('下列哪一项是细胞膜的主要成分？')
      const body = stem.closest('div.overflow-y-auto')
      expect(body).toBeTruthy()
      // A resized window must hand its height to the body, not leave dead space.
      expect(body?.className).toContain('flex-1')
      expect(body?.getAttribute('style') ?? '').not.toContain('70vh')
    })

    it('reports answered progress in the footer, within thumb reach', async () => {
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42, 43]}
          onQuestionCompleted={() => {}}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      expect(screen.getByText('已答 0 / 2')).toBeTruthy()

      fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
      expect(screen.getByText('已答 1 / 2')).toBeTruthy()
    })

    it('marks answered questions right or wrong on the jump pills', async () => {
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42, 43]}
          onQuestionCompleted={() => {}}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      fireEvent.keyDown(window, { key: '2', code: 'Digit2' })

      // Pill state was previously "answered" only — right and wrong looked the same.
      expect(screen.getByRole('button', { name: '1', hidden: true }).getAttribute('title'))
        .toBe('第 1 题（已答·错）')
    })

    it('offers an explicit way out once the last question is answered', async () => {
      const onOpenChange = vi.fn()
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={onOpenChange}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42]}
          onQuestionCompleted={() => {}}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      expect(screen.queryByRole('button', { name: '完成' })).toBeNull()

      fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
      fireEvent.click(screen.getByRole('button', { name: '完成' }))
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('keeps Enter submit after moving to the next question', async () => {
    const onQuestionCompleted = vi.fn()
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42, 43]}
        onQuestionCompleted={onQuestionCompleted}
      />,
    )

    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    fireEvent.click(screen.getByRole('button', { name: '下一题' }))
    await screen.findByText('第二道关联题目')

    expect(document.activeElement?.hasAttribute('data-quiz-shortcut-surface')).toBe(true)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter', code: 'Enter' })

    expect(screen.getByText('回答正确')).toBeTruthy()
    expect(onQuestionCompleted).toHaveBeenCalledWith(43)
  })

  it('does not submit the current option when Enter is pressed on navigation', async () => {
    const onQuestionCompleted = vi.fn()
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42, 43]}
        onQuestionCompleted={onQuestionCompleted}
      />,
    )

    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    const nextButton = screen.getByRole('button', { name: '下一题' })
    fireEvent.keyDown(nextButton, { key: 'Enter', code: 'Enter' })

    expect(screen.queryByText('回答错误')).toBeNull()
    expect(onQuestionCompleted).not.toHaveBeenCalled()
  })

  describe('move to trash', () => {
    it('removes the question from the queue after confirming', async () => {
      const toastMock = await import('@/shared/feedback/toast')
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42, 43]}
          onQuestionCompleted={() => {}}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      expect(screen.getByText('已答 0 / 2')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))

      await vi.waitFor(() => {
        expect(deletePalaceQuizQuestionApiMock).toHaveBeenCalledWith(42)
        expect(screen.getByText('第二道关联题目')).toBeTruthy()
      })
      expect(screen.queryByText('下列哪一项是细胞膜的主要成分？')).toBeNull()
      expect(toastMock.toast.success).toHaveBeenCalledWith('题目已移入回收站。')
    })

    it('keeps the question and reports when the delete fails', async () => {
      const toastMock = await import('@/shared/feedback/toast')
      deletePalaceQuizQuestionApiMock.mockRejectedValue(new Error('网络错误。'))
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42]}
          onQuestionCompleted={() => {}}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))

      await vi.waitFor(() => {
        expect(toastMock.toast.error).toHaveBeenCalledWith('网络错误。')
      })
      expect(screen.getByText('下列哪一项是细胞膜的主要成分？')).toBeTruthy()
    })

    it('removes a question the server already deleted without an error toast', async () => {
      const toastMock = await import('@/shared/feedback/toast')
      const onQuestionDeleted = vi.fn()
      deletePalaceQuizQuestionApiMock.mockRejectedValue(new Error('题目不存在。'))
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42, 43]}
          onQuestionCompleted={() => {}}
          onQuestionDeleted={onQuestionDeleted}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))

      await vi.waitFor(() => {
        expect(screen.getByText('第二道关联题目')).toBeTruthy()
        expect(screen.queryByText('下列哪一项是细胞膜的主要成分？')).toBeNull()
      })
      expect(toastMock.toast.error).not.toHaveBeenCalled()
      expect(toastMock.toast.success).toHaveBeenCalledWith('题目已移入回收站。')
      expect(onQuestionDeleted).toHaveBeenCalledWith(42)
    })

    it('does not restore a deleted question from a stale palace question list', async () => {
      const view = render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42, 43]}
          onQuestionCompleted={() => {}}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
      await vi.waitFor(() => {
        expect(screen.queryByText('下列哪一项是细胞膜的主要成分？')).toBeNull()
      })

      getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
        items: [secondQuestion],
        item_count: 1,
      })
      getPalaceQuizQuestionsApiMock.mockResolvedValue({
        items: [sampleQuestion, secondQuestion],
      })
      view.rerender(
        <NodeBoundQuizDialog
          open={false}
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42, 43]}
          onQuestionCompleted={() => {}}
        />,
      )
      view.rerender(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42, 43]}
          onQuestionCompleted={() => {}}
        />,
      )

      await vi.waitFor(() => {
        expect(screen.getByText('第二道关联题目')).toBeTruthy()
      })
      expect(screen.queryByText('下列哪一项是细胞膜的主要成分？')).toBeNull()
    })

    it('does not toast when an in-flight attempt learns the question was deleted', async () => {
      const toastMock = await import('@/shared/feedback/toast')
      let rejectAttempt: (error: Error) => void = () => {}
      recordPalaceQuizChoiceAttemptApiMock.mockImplementation(
        () => new Promise((_resolve, reject) => {
          rejectAttempt = reject
        }),
      )
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42, 43]}
          onQuestionCompleted={() => {}}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
      await vi.waitFor(() => {
        expect(screen.queryByText('下列哪一项是细胞膜的主要成分？')).toBeNull()
      })
      rejectAttempt(new Error('题目不存在。'))
      await vi.waitFor(() => {
        expect(deletePalaceQuizQuestionApiMock).toHaveBeenCalledWith(42)
      })
      expect(toastMock.toast.error).not.toHaveBeenCalled()
    })

    it('closes the dialog when the last question is deleted', async () => {
      const onOpenChange = vi.fn()
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={onOpenChange}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42]}
          onQuestionCompleted={() => {}}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))

      await vi.waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
    })

    it('scales the question body with ctrl+wheel and leaves the type badge alone', async () => {
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42]}
          onQuestionCompleted={() => {}}
        />,
      )

      const stem = await screen.findByText('下列哪一项是细胞膜的主要成分？')
      const body = screen.getByTestId('quiz-font-scale-body')
      expect(body.contains(stem)).toBe(true)
      expect(body.contains(screen.getByText('选择题'))).toBe(false)
      const zoomIn = new WheelEvent('wheel', {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      act(() => {
        stem.dispatchEvent(zoomIn)
      })
      expect(zoomIn.defaultPrevented).toBe(true)
      expect(body.style.zoom).toBe('110%')
      expect(screen.getByTestId('quiz-font-scale-hint').textContent).toBe('110%')
    })
  })
})
