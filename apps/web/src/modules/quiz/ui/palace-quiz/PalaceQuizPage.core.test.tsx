import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { QUIZ_ANSWER_MODE_STORAGE_KEY } from '@/modules/quiz/domain/quiz-entity/model/quizAnswerModeSettings'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import {
  baseQuestions,
  batchDeletePalaceQuizQuestionsApiMock,
  dispatchGlobalFeedbackMock,
  emitReviewCelebrationMock,
  getPalaceEditorApiMock,
  getPalacesGroupedApiMock,
  getPalaceQuizQuestionsApiMock,
  listQuestionNodeBindingsApiMock,
  mindMapFramePropsMock,
  recordPalaceQuizChoiceAttemptApiMock,
  renderPage,
  resetPalaceQuizQuestionAttemptsApiMock,
  setupPalaceQuizPageTest,
} from '@/modules/quiz/ui/palace-quiz/PalaceQuizPage.test-utils'

describe('PalaceQuizPage core flows', () => {
  beforeEach(setupPalaceQuizPageTest)

  async function startPractice(questionText?: string) {
    if (questionText) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(questionText) }))
    } else {
      fireEvent.click(await screen.findByRole('button', { name: '开始做题' }))
    }
  }

  it('renders the route and switches between practice and manage', async () => {
    renderPage()

    expect(await screen.findByText('细胞生物学宫殿 · 配套习题')).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看记忆宫殿' })).toBeTruthy()
    expect(screen.getByText('3 道关联题目')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    expect(await screen.findByText('题库列表')).toBeTruthy()
    expect(screen.getByRole('button', { name: /新增题目/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'AI生成' })).toBeNull()
    expect(screen.queryByRole('button', { name: '审核发布' })).toBeNull()
  })

  it('opens a floating memory palace lookup without leaving the quiz state', async () => {
    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '查看记忆宫殿' }))

    expect(
      await screen.findByText('改动会自动保存。'),
    ).toBeTruthy()
    await waitFor(() => {
      expect(getPalacesGroupedApiMock).toHaveBeenCalled()
      expect(getPalaceEditorApiMock).toHaveBeenCalledWith(1)
    })
    // 默认就是编辑模式：没有模式切换，地图可编辑。
    expect((await screen.findByTestId('memory-lookup-mindmap')).getAttribute('data-readonly')).toBe(
      'false',
    )
    expect(screen.queryByRole('button', { name: '查看模式' })).toBeNull()
    expect(screen.queryByRole('button', { name: '翻卡模式' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑模式' })).toBeNull()
    expect(screen.getByText('直接修改节点，改动会自动保存。')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-root-uid')).toBe(
        'root-1',
      )
    })
    expect(mindMapFramePropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        focusRequestNodeUid: 'root-1',
        focusRequestNonce: expect.any(Number),
        forceExpanded: false,
        mobileViewPolicy: 'map',
      }),
    )
    expect(screen.getByRole('button', { name: '从右下角调整记忆宫殿查看大小' })).toBeTruthy()
    expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-doc-root-uid')).toBe(
      'root-1',
    )

    fireEvent.click(screen.getByRole('button', { name: '缩小为胶囊' }))
    expect(await screen.findByRole('button', { name: '打开记忆宫殿查看' })).toBeTruthy()
    expect(screen.getByText('细胞的控制中心是？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '打开记忆宫殿查看' }))
    expect(await screen.findByText('直接修改节点，改动会自动保存。')).toBeTruthy()
    const firstFocusNonce = Number(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-focus-nonce'))

    // 第四章 只有一个宫殿，目录把它折叠成那一行宫殿本身（不再单独出现章节展开行）。
    const secondPalaceButton = await screen.findByRole('button', { name: '遗传学宫殿' })
    fireEvent.click(secondPalaceButton)
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
  }, 10000)

  it('opens the memory palace lookup with the bound node as the mind-map center', async () => {
    listQuestionNodeBindingsApiMock.mockResolvedValue({
      question_id: 11,
      items: [{ question_id: 11, node_uid: 'child-1', palace_id: 1, target_palace_id: 1 }],
      item_count: 1,
    })

    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '查看记忆宫殿' }))

    expect(await screen.findByText('改动会自动保存。')).toBeTruthy()
    await waitFor(() => {
      expect(listQuestionNodeBindingsApiMock).toHaveBeenCalledWith(11)
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-doc-root-uid')).toBe(
        'root-1',
      )
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-root-uid')).toBe(
        'child-1',
      )
    })
    expect(mindMapFramePropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        focusRequestNodeUid: 'child-1',
        initialFocusNodeUid: 'child-1',
        forceExpanded: false,
      }),
    )
    expect(screen.getByText('绑定节点已置于中央 · 改动会自动保存')).toBeTruthy()
    expect(screen.getByTestId('memory-node-root-1')).toBeTruthy()
    expect(screen.getByTestId('memory-node-child-1')).toBeTruthy()
    expect(screen.getByTestId('memory-node-grandchild-1')).toBeTruthy()
  })

  it('centers the deepest bound card when the question is also bound to the palace root', async () => {
    listQuestionNodeBindingsApiMock.mockResolvedValue({
      question_id: 11,
      items: [
        { question_id: 11, node_uid: 'root-1', palace_id: 1, target_palace_id: 1 },
        { question_id: 11, node_uid: 'child-1', palace_id: 1, target_palace_id: 1 },
        { question_id: 11, node_uid: 'grandchild-1', palace_id: 1, target_palace_id: 1 },
      ],
      item_count: 3,
    })

    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看记忆宫殿' }))

    await waitFor(() => {
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-doc-root-uid')).toBe(
        'root-1',
      )
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-root-uid')).toBe(
        'grandchild-1',
      )
    })
    expect(mindMapFramePropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        focusRequestNodeUid: 'grandchild-1',
        initialFocusNodeUid: 'grandchild-1',
        highlightedNodeUids: ['grandchild-1'],
      }),
    )
    expect(screen.getByText('绑定节点已置于中央 · 改动会自动保存')).toBeTruthy()
    expect(screen.getByTestId('memory-node-root-1')).toBeTruthy()
    expect(screen.getByTestId('memory-node-grandchild-1')).toBeTruthy()
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
    listQuestionNodeBindingsApiMock.mockResolvedValue({
      question_id: 11,
      items: [{ question_id: 11, node_uid: 'child-1', palace_id: 1, target_palace_id: 1 }],
      item_count: 1,
    })

    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '查看记忆宫殿' }))

    expect(await screen.findByRole('button', { name: '关闭记忆宫殿查看' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '查看模式' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑模式' })).toBeNull()
    expect(screen.queryByRole('button', { name: '从右下角调整记忆宫殿查看大小' })).toBeNull()
    await waitFor(() => {
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-readonly')).toBe(
        'false',
      )
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-doc-root-uid')).toBe(
        'root-1',
      )
      expect(screen.getByTestId('memory-lookup-mindmap').getAttribute('data-root-uid')).toBe(
        'child-1',
      )
    })
    expect(screen.getByText('绑定节点已置于中央 · 改动会自动保存')).toBeTruthy()
    expect(screen.getByTestId('memory-node-root-1')).toBeTruthy()
    expect(screen.getByTestId('memory-node-child-1')).toBeTruthy()
  })

  it('judges multiple-choice questions immediately and records one attempt', async () => {
    window.localStorage.setItem(QUIZ_ANSWER_MODE_STORAGE_KEY, JSON.stringify({ mcqMode: 'choice' }))
    resetClientPreferenceCacheForTest()
    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()
    await startPractice('细胞的控制中心是？')

    fireEvent.click(await screen.findByRole('button', { name: /^(B\. )?细胞核$/ }))
    expect(await screen.findByText('回答正确')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('已完成 1 / 3 题')).toBeTruthy()
    })
    // The shared window owns the once-per-answer cue pair: result, then reveal.
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_result_correct',
      expect.objectContaining({ audioScope: 'local' }),
    )
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_result_reveal',
      expect.objectContaining({ audioScope: 'local' }),
    )
    await waitFor(() => {
      expect(recordPalaceQuizChoiceAttemptApiMock).toHaveBeenCalledTimes(1)
    })
    expect(recordPalaceQuizChoiceAttemptApiMock).toHaveBeenCalledWith(
      11,
      'B',
      expect.objectContaining({ updateMutationStats: true }),
    )
    expect(emitReviewCelebrationMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'quiz_correct' }),
    )
  })

  it('emits incorrect quiz feedback without result confetti', async () => {
    window.localStorage.setItem(QUIZ_ANSWER_MODE_STORAGE_KEY, JSON.stringify({ mcqMode: 'choice' }))
    resetClientPreferenceCacheForTest()
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
    await startPractice('细胞的控制中心是？')

    fireEvent.click(await screen.findByRole('button', { name: /^(A\. )?细胞膜$/ }))

    expect(await screen.findByText('回答错误')).toBeTruthy()
    await waitFor(() => {
      expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
        'quiz_result_incorrect',
        expect.objectContaining({ audioScope: 'local' }),
      )
    })
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_result_reveal',
      expect.objectContaining({ label: '答案', audioScope: 'local' }),
    )
    expect(emitReviewCelebrationMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'quiz_correct' }),
    )
  })

  it('clears attempt statistics for the current question scope', async () => {
    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /大宫殿/ }))
    fireEvent.click(screen.getByRole('button', { name: '清空当前范围进度' }))
    expect(await screen.findByText('只清空筛选范围内的答对、答错和作答次数，不删除题目。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清空进度' }))

    await waitFor(() => {
      expect(resetPalaceQuizQuestionAttemptsApiMock).toHaveBeenCalledWith([11, 12])
    })
    await waitFor(() => {
      expect(getPalaceQuizQuestionsApiMock).toHaveBeenCalledTimes(2)
    })
  })

  it('opens the shared answer window at the question selected from the browsable list', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /细胞核的主要作用是什么/ }))

    expect(await screen.findByText('细胞核的主要作用是什么？')).toBeTruthy()
    expect(screen.getByText('已完成 0 / 3 题')).toBeTruthy()
    expect(screen.getByRole('button', { name: '做题配置' })).toBeTruthy()
  })

  it('opens short-answer questions in the shared window and reveals reference content', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /简述有丝分裂的意义/ }))

    const answerInput = await screen.findByPlaceholderText('先写下你的答案，再点击提交')
    fireEvent.change(answerInput, { target: { value: '能让细胞分裂。' } })
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }))

    expect(await screen.findByText('参考答案')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'AI点评' })).toBeNull()
    expect(screen.getAllByRole('button', { name: '标记' }).length).toBeGreaterThan(0)
  })

  it('uses Ctrl+Z to retry only the current question and preserves native undo in answer inputs', async () => {
    window.localStorage.setItem(QUIZ_ANSWER_MODE_STORAGE_KEY, JSON.stringify({ mcqMode: 'choice' }))
    resetClientPreferenceCacheForTest()
    renderPage()
    expect(await screen.findByText('细胞的控制中心是？')).toBeTruthy()
    await startPractice('细胞的控制中心是？')

    fireEvent.click(await screen.findByRole('button', { name: /^(B\. )?细胞核$/ }))
    expect(await screen.findByText('回答正确')).toBeTruthy()
    // Scope every query to the shared window: the palace list behind it is
    // aria-hidden, and its rows are not navigation targets while the window owns
    // the keyboard.
    const dialog = screen.getByTestId('freestyle-scope-quiz-dialog')
    const correctOption = within(dialog).getByRole('button', { name: /^(B\. )?细胞核$/ })
    expect(correctOption.className).toContain('border-success')

    const retryEvent = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(retryEvent)
    expect(retryEvent.defaultPrevented).toBe(true)
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: /^(B\. )?细胞核$/ }).className).not.toContain('border-success')
    })

    // Walk the window itself until the short-answer question is on screen.
    fireEvent.click(within(dialog).getByRole('button', { name: '下一题' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '下一题' }))
    const answerInput = await within(dialog).findByPlaceholderText('先写下你的答案，再点击提交')
    fireEvent.change(answerInput, { target: { value: '保留这段草稿' } })
    const undoEvent = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    answerInput.dispatchEvent(undoEvent)

    expect(undoEvent.defaultPrevented).toBe(false)
    expect((answerInput as HTMLTextAreaElement).value).toBe('保留这段草稿')
  })

  it('supports filtering questions by palace scope in manage view', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByRole('button', { name: '细胞核学习组' }))
    expect(dispatchGlobalFeedbackMock).toHaveBeenCalledWith(
      'quiz_nav_scope_change',
      expect.objectContaining({ label: '细胞核学习组', audioScope: 'global' }),
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
