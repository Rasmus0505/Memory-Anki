import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeBoundQuizDialog } from '@/widgets/node-bound-quiz'

const getPalaceQuizQuestionsByIdsApiMock = vi.fn()
const getPalaceQuizQuestionsApiMock = vi.fn()
const listPalaceQuizNodeBindingsApiMock = vi.fn()
const recordPalaceQuizChoiceAttemptApiMock = vi.fn()

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
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: vi.fn(),
}))

vi.mock('@/widgets/palace-memory-lookup', () => ({
  PalaceMemoryLookupDialog: ({
    open,
    onOpenChange,
    currentPalaceId,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    currentPalaceId: number | null
  }) =>
    open ? (
      <div data-testid="palace-memory-lookup" data-palace-id={String(currentPalaceId)}>
        <button type="button" onClick={() => onOpenChange(false)}>
          关闭宫殿查看
        </button>
      </div>
    ) : null,
}))

const sampleQuestion = {
  id: 42,
  palace_id: 1,
  sort_order: 0,
  correct_count: 0,
  incorrect_count: 0,
  attempt_count: 0,
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
    vi.clearAllMocks()
    getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
      items: [sampleQuestion, secondQuestion],
      item_count: 2,
    })
    getPalaceQuizQuestionsApiMock.mockResolvedValue({ items: [sampleQuestion, secondQuestion] })
    recordPalaceQuizChoiceAttemptApiMock.mockImplementation(async (questionId: number) => ({
      question: questionId === secondQuestion.id ? secondQuestion : sampleQuestion,
    }))
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
    fireEvent.keyDown(window, { key: '2' })

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
    fireEvent.keyDown(window, { key: 'd' })

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
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.getByText('回答错误')).toBeTruthy()
    expect(onQuestionCompleted).toHaveBeenCalledWith(42)
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
    fireEvent.keyDown(window, { key: 'ArrowRight' })

    expect(await screen.findByText('第二道关联题目')).toBeTruthy()
    expect(screen.queryByText('回答错误')).toBeNull()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })

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

      fireEvent.keyDown(window, { key: '1' })
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
      fireEvent.keyDown(window, { key: '2' })

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

      fireEvent.keyDown(window, { key: '1' })
      fireEvent.click(screen.getByRole('button', { name: '完成' }))
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
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
    fireEvent.keyDown(nextButton, { key: 'Enter' })

    expect(screen.queryByText('回答错误')).toBeNull()
    expect(onQuestionCompleted).not.toHaveBeenCalled()
  })
})
