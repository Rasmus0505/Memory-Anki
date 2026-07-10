import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  baseQuestions,
  batchDeletePalaceQuizQuestionsApiMock,
  dispatchGlobalFeedbackMock,
  emitReviewConfettiMock,
  getPalaceEditorApiMock,
  getPalacesGroupedApiMock,
  getPalaceQuizQuestionsApiMock,
  mindMapFramePropsMock,
  promptForAiOptionsMock,
  recordPalaceQuizChoiceAttemptApiMock,
  renderPage,
  resetPalaceQuizQuestionAttemptsApiMock,
  requestPalaceShortAnswerFeedbackApiMock,
  setupPalaceQuizPageTest,
  useTimedSessionMock,
} from '@/features/palace-quiz/PalaceQuizPage.test-utils'

describe('PalaceQuizPage core flows', () => {
  beforeEach(setupPalaceQuizPageTest)

  it('renders the route and switches among practice, manage, and AI tabs', async () => {
    renderPage()

    expect(await screen.findByText('细胞生物学宫殿 · 配套习题')).toBeTruthy()
    const shelfLink = screen.getByRole('link', { name: '返回学科书架' })
    expect(shelfLink.getAttribute('href')).toBe('/palaces')
    expect(screen.getByRole('button', { name: '查看记忆宫殿' })).toBeTruthy()
    expect(screen.getByText('多图生成')).toBeTruthy()
    expect(useTimedSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'quiz',
        palaceId: 1,
        automationScene: 'quiz',
        sourceKind: 'palace',
        persistKey: 'palace_quiz:1',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    expect(await screen.findByText('题库列表')).toBeTruthy()
    expect(screen.getByRole('button', { name: /新增题目/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'AI生成' }))
    expect(await screen.findByText('AI 题库生成工作台')).toBeTruthy()
    expect(await screen.findByText('生物 / 第三章')).toBeTruthy()
  })

  it('opens a floating memory palace lookup without leaving the quiz state', async () => {
    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '查看记忆宫殿' }))

    expect(await screen.findByText('做题时快速查看宫殿内容，关闭后继续当前题目。')).toBeTruthy()
    await waitFor(() => {
      expect(getPalacesGroupedApiMock).toHaveBeenCalled()
      expect(getPalaceEditorApiMock).toHaveBeenCalledWith(1)
    })
    expect((await screen.findByTestId('memory-lookup-mindmap')).getAttribute('data-readonly')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: '查看模式' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '翻卡模式' })).toBeTruthy()
    expect(screen.getByText('只读脑图预览')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-root-uid')).toBe(
        'root-1',
      )
    })
    expect(mindMapFramePropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        focusRequestNodeUid: 'root-1',
        focusRequestNonce: expect.any(Number),
      }),
    )
    expect(screen.getByRole('button', { name: '从右下角调整记忆宫殿查看大小' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '翻卡模式' }))
    expect(screen.getByText(/翻卡模式：点击已显示知识点展开下一层知识点/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /重新开始/ })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-practice-mode')).toBe(
        'true',
      )
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-sync-reason')).toBe(
        'review_flip',
      )
    })
    expect(screen.getByText('细胞核知识点')).toBeTruthy()
    expect(screen.getByText('染色体线索')).toBeTruthy()

    fireEvent.contextMenu(screen.getByTestId('memory-node-child-1'))
    await waitFor(() => {
      expect(screen.queryByText('染色体线索')).toBeNull()
    })
    fireEvent.click(screen.getByTestId('memory-node-child-1'))
    expect(await screen.findByText('待回忆')).toBeTruthy()
    fireEvent.click(screen.getByTestId('memory-node-grandchild-1'))
    await waitFor(() => {
      expect(screen.getByText('染色体线索')).toBeTruthy()
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-review-fx')).toBe(
        'card_reveal',
      )
    })

    fireEvent.click(screen.getByRole('button', { name: '查看模式' }))
    await waitFor(() => {
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-practice-mode')).toBe(
        'false',
      )
    })

    fireEvent.click(screen.getByRole('button', { name: '缩小为胶囊' }))
    expect(await screen.findByRole('button', { name: '打开记忆宫殿查看' })).toBeTruthy()
    expect(screen.queryByText('只读脑图预览')).toBeNull()
    expect(screen.getByText('细胞的控制中心是？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '打开记忆宫殿查看' }))
    expect(await screen.findByText('只读脑图预览')).toBeTruthy()
    const firstFocusNonce = Number(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-focus-nonce'))

    const secondPalaceButton = screen.getByText('遗传学宫殿').closest('button')
    expect(secondPalaceButton).toBeTruthy()
    fireEvent.click(secondPalaceButton!)
    await waitFor(() => {
      expect(getPalaceEditorApiMock).toHaveBeenCalledWith(2)
    })
    await waitFor(() => {
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-root-uid')).toBe(
        'root-2',
      )
    })
    expect(Number(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-focus-nonce'))).toBeGreaterThan(
      firstFocusNonce,
    )
    expect(screen.getByText('细胞的控制中心是？')).toBeTruthy()
  })

  it('opens the memory palace lookup as a mobile full-screen dialog on narrow viewports', async () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width: 1023px'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia

    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '查看记忆宫殿' }))

    expect(await screen.findByRole('button', { name: '关闭记忆宫殿查看' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看模式' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '从右下角调整记忆宫殿查看大小' })).toBeNull()
    await waitFor(() => {
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-readonly')).toBe(
        'true',
      )
    })
  })

  it('judges multiple-choice questions immediately, refreshes stats, and supports retry', async () => {
    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'B. 细胞核' }))
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_answer_select',
      expect.objectContaining({ label: 'B', audioScope: 'local' }),
    )
    expect(await screen.findByText('回答正确')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('答对 3 次 / 答错 1 次')).toBeTruthy()
    })
    await waitFor(() => {
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_result_correct',
        expect.objectContaining({ audioScope: 'local' }),
      )
    })
    expect(emitReviewConfettiMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'quiz_correct' }),
    )
    fireEvent.click(screen.getByRole('button', { name: /再做一次/ }))
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_answer_reset',
      expect.objectContaining({ label: '重做', audioScope: 'local' }),
    )
  })

  it('emits incorrect quiz feedback without result confetti', async () => {
    recordPalaceQuizChoiceAttemptApiMock.mockResolvedValueOnce({
      question: {
        ...baseQuestions[0],
        correct_count: 2,
        incorrect_count: 2,
        attempt_count: 4,
      },
      selected_option_id: 'A',
      is_correct: false,
    })

    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'A. 细胞膜' }))

    expect(await screen.findByText('回答错误')).toBeTruthy()
    await waitFor(() => {
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_result_incorrect',
        expect.objectContaining({ audioScope: 'local' }),
      )
    })
    expect(emitReviewConfettiMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'quiz_correct' }),
    )
  })

  it('clears attempt statistics for the current question scope', async () => {
    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /大宫殿/ }))
    fireEvent.click(screen.getByRole('button', { name: '清空当前范围进度' }))
    expect(await screen.findByText('只会清空当前筛选范围内题目的累计答对、答错和作答次数，不会删除题目。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清空进度' }))

    await waitFor(() => {
      expect(resetPalaceQuizQuestionAttemptsApiMock).toHaveBeenCalledWith([11, 12])
    })
    await waitFor(() => {
      expect(getPalaceQuizQuestionsApiMock).toHaveBeenCalledTimes(2)
    })
  })

  it('reveals short-answer reference content after submit and enables AI feedback', async () => {
    window.localStorage.setItem('memory_anki_palace_quiz_view_mode', 'list')
    renderPage()

    expect(await screen.findByText('简述有丝分裂的意义。')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('先写下你的答案，再点击提交'), {
      target: { value: '能让细胞分裂。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }))

    expect(await screen.findByText('参考答案')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'AI点评' }))
    expect(
      await screen.findByText('你的答案方向是对的，还可以补充遗传稳定性。'),
    ).toBeTruthy()
    expect(promptForAiOptionsMock).toHaveBeenCalled()
    expect(requestPalaceShortAnswerFeedbackApiMock).toHaveBeenCalled()
  })

  it('supports filtering questions by palace scope in manage view', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByRole('button', { name: '细胞核专项训练' }))
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_nav_scope_change',
      expect.objectContaining({ label: '细胞核专项训练', audioScope: 'global' }),
    )
    expect(await screen.findByText('细胞核的主要作用是什么？')).toBeTruthy()
    expect(screen.queryByText('简述有丝分裂的意义。')).toBeNull()
  })

  it('keeps complex question types viewable and deletable in manage mode without edit actions', async () => {
    getPalaceQuizQuestionsApiMock.mockResolvedValue({
      items: [
        ...baseQuestions,
        {
          id: 14,
          palace_id: 1,
          question_type: 'true_false' as const,
          stem: 'DNA 复制发生在间期。',
          options: [],
          answer_payload: { correct_answer: true },
          analysis: '这是细胞周期中的基础知识点。',
          mini_palace_id: null,
          origin_question_id: null,
          mini_palace: null,
          source_meta: {
            source_kind: 'manual',
            page_numbers: null,
            image_names: null,
            extra_prompt: '',
            ai_call_log_id: null,
            generated_at: '2026-06-12T00:00:00',
            generation_mode: 'manual',
          },
          sort_order: 4,
          correct_count: 0,
          incorrect_count: 0,
          attempt_count: 0,
          created_at: '2026-06-12T00:00:00',
          updated_at: '2026-06-12T00:00:00',
        },
      ],
    })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '管理' }))
    expect(await screen.findByText('DNA 复制发生在间期。')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(4)
  })

  it('supports selecting and batch deleting questions in the manage tab', async () => {
    getPalaceQuizQuestionsApiMock
      .mockResolvedValueOnce({ items: baseQuestions })
      .mockResolvedValueOnce({ items: [baseQuestions[2]] })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择题目 细胞的控制中心是？' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择题目 简述有丝分裂的意义。' }))
    fireEvent.click(screen.getByRole('button', { name: '批量删除所选' }))

    await waitFor(() => {
      expect(batchDeletePalaceQuizQuestionsApiMock).toHaveBeenCalledWith([11, 12])
    })
    await waitFor(() => {
      expect(screen.getByText('已选 0 题')).toBeTruthy()
    })
  })
})
