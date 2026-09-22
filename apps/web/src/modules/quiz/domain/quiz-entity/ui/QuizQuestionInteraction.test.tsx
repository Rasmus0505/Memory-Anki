import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  QuizQuestionInteraction,
  type QuizRuntimeState,
} from '@/modules/quiz/domain/quiz-entity'
import type { PalaceQuizQuestionDraft } from '@/shared/api/contracts'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { saveQuizAnswerMode } from '@/modules/quiz/domain/quiz-entity/model/quizAnswerModeSettings'

function renderInteraction(question: PalaceQuizQuestionDraft, initialState: QuizRuntimeState = {}) {
  let latestState: QuizRuntimeState = initialState

  function Harness() {
    return (
      <QuizQuestionInteraction
        question={question}
        state={latestState}
        onStateChange={(updater) => {
          latestState = updater(latestState)
        }}
      />
    )
  }

  const view = render(<Harness />)
  return {
    ...view,
    rerenderWithLatestState: () =>
      view.rerender(
        <QuizQuestionInteraction
          question={question}
          state={latestState}
          onStateChange={(updater) => {
            latestState = updater(latestState)
          }}
        />,
      ),
  }
}

const MANUAL_SOURCE = {
  source_kind: 'manual' as const,
  page_numbers: null,
  image_names: null,
  extra_prompt: '',
  ai_call_log_id: null,
  generated_at: '2026-06-15T00:00:00',
  generation_mode: 'manual' as const,
}

describe('QuizQuestionInteraction', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    saveQuizAnswerMode('choice')
  })

  afterEach(() => {
    saveQuizAnswerMode('choice')
  })

  it('supports true_false questions with corrective feedback', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'true_false',
      stem: 'DNA 复制只发生在分裂后期。',
      options: [],
      answer_payload: {
        correct_answer: false,
        false_explanation: 'DNA 复制发生在间期。',
      },
      analysis: '复制在细胞分裂前完成准备。',
      source_meta: {
        source_kind: 'manual',
        page_numbers: null,
        image_names: null,
        extra_prompt: '',
        ai_call_log_id: null,
        generated_at: '2026-06-15T00:00:00',
        generation_mode: 'manual',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '对' }))
    rerenderWithLatestState()

    expect(screen.getByText('错误点：DNA 复制发生在间期。')).toBeTruthy()
    expect(screen.getByText('再调整一下')).toBeTruthy()
  })

  it('supports fill_blank questions and validates all blanks together', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'fill_blank',
      stem: '写出细胞中的供能结构。',
      options: [],
      answer_payload: {
        blanks: [{ id: '空1', answer: '线粒体', aliases: ['mitochondria'] }],
      },
      analysis: '线粒体是细胞主要供能结构。',
      source_meta: {
        source_kind: 'manual',
        page_numbers: null,
        image_names: null,
        extra_prompt: '',
        ai_call_log_id: null,
        generated_at: '2026-06-15T00:00:00',
        generation_mode: 'manual',
      },
    })

    fireEvent.change(screen.getByPlaceholderText('输入后按 Enter 提交此空'), {
      target: { value: '线粒体' },
    })
    rerenderWithLatestState()
    fireEvent.click(screen.getByRole('button', { name: '提交全部' }))
    rerenderWithLatestState()

    expect(screen.getByText('回答正确')).toBeTruthy()
  })

  it('supports matching questions', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'matching',
      stem: '把结构和功能连起来。',
      options: [],
      answer_payload: {
        pairs: [
          { left_id: 'l1', left: '线粒体', right_id: 'r1', right: '供能' },
          { left_id: 'l2', left: '核糖体', right_id: 'r2', right: '蛋白质合成' },
        ],
      },
      analysis: '两个细胞器分别负责供能和蛋白质合成。',
      source_meta: {
        source_kind: 'manual',
        page_numbers: null,
        image_names: null,
        extra_prompt: '',
        ai_call_log_id: null,
        generated_at: '2026-06-15T00:00:00',
        generation_mode: 'manual',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '线粒体' }))
    rerenderWithLatestState()
    fireEvent.click(screen.getByRole('button', { name: '供能' }))
    rerenderWithLatestState()
    fireEvent.click(screen.getByRole('button', { name: '核糖体' }))
    rerenderWithLatestState()
    fireEvent.click(screen.getByRole('button', { name: '蛋白质合成' }))
    rerenderWithLatestState()
    fireEvent.click(screen.getByRole('button', { name: '提交连线' }))
    rerenderWithLatestState()

    expect(screen.getByText('回答正确')).toBeTruthy()
  })

  it('supports ordering questions', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'ordering',
      stem: '按步骤排序。',
      options: [],
      answer_payload: {
        items: [
          { id: 'o1', text: 'DNA 复制' },
          { id: 'o2', text: '细胞分裂' },
        ],
        correct_order_ids: ['o1', 'o2'],
      },
      analysis: '先复制遗传物质，再进入分裂。',
      source_meta: {
        source_kind: 'manual',
        page_numbers: null,
        image_names: null,
        extra_prompt: '',
        ai_call_log_id: null,
        generated_at: '2026-06-15T00:00:00',
        generation_mode: 'manual',
      },
    })

    fireEvent.click(screen.getAllByRole('button', { name: '上移' })[1]!)
    rerenderWithLatestState()
    fireEvent.click(screen.getByRole('button', { name: '提交排序' }))
    rerenderWithLatestState()

    expect(screen.getByText('回答正确')).toBeTruthy()
    expect(screen.getByText(/正确顺序：DNA 复制 → 细胞分裂/)).toBeTruthy()
  })

  it('supports categorization questions', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'categorization',
      stem: '把结构归到对应系统。',
      options: [],
      answer_payload: {
        categories: [
          { id: 'c1', name: '细胞器' },
          { id: 'c2', name: '细胞结构' },
        ],
        items: [
          { id: 'i1', text: '线粒体', category_id: 'c1' },
          { id: 'i2', text: '细胞膜', category_id: 'c2' },
        ],
      },
      analysis: '线粒体属于细胞器，细胞膜属于细胞结构。',
      source_meta: {
        source_kind: 'manual',
        page_numbers: null,
        image_names: null,
        extra_prompt: '',
        ai_call_log_id: null,
        generated_at: '2026-06-15T00:00:00',
        generation_mode: 'manual',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '线粒体' }))
    rerenderWithLatestState()
    fireEvent.click(screen.getByRole('button', { name: '细胞器' }))
    rerenderWithLatestState()
    fireEvent.click(screen.getByRole('button', { name: '细胞膜' }))
    rerenderWithLatestState()
    fireEvent.click(screen.getByRole('button', { name: '细胞结构' }))
    rerenderWithLatestState()
    fireEvent.click(screen.getByRole('button', { name: '提交归类' }))
    rerenderWithLatestState()

    expect(screen.getByText('回答正确')).toBeTruthy()
    expect(screen.getByText(/正确归类：线粒体 → 细胞器；细胞膜 → 细胞结构/)).toBeTruthy()
  })

  it('renders structured short-answer AI feedback by section', () => {
    renderInteraction(
      {
        question_type: 'short_answer',
        stem: '简述有丝分裂的意义。',
        options: [],
        answer_payload: {
          reference_answer: '保证遗传信息稳定传递。',
        },
        analysis: '核心在于遗传物质平均分配。',
        source_meta: {
          source_kind: 'manual',
          page_numbers: null,
          image_names: null,
          extra_prompt: '',
          ai_call_log_id: null,
          generated_at: '2026-06-15T00:00:00',
          generation_mode: 'manual',
        },
      },
      {
        shortAnswerSubmitted: true,
        shortAnswerFeedback: {
          question_id: 2,
          feedback_text: '答到的要点：要点A',
          verdict: 'partial',
          hit_points: ['要点A'],
          missed_points: ['要点B'],
          suggestion: '补充完整因果关系。',
          ai_call_log_id: 'log-structured',
        },
      },
    )

    expect(screen.getByText('部分正确')).toBeTruthy()
    expect(screen.getByText('答到的要点')).toBeTruthy()
    expect(screen.getByText('要点A')).toBeTruthy()
    expect(screen.getByText('遗漏或有偏差')).toBeTruthy()
    expect(screen.getByText('要点B')).toBeTruthy()
    expect(screen.getByText('建议')).toBeTruthy()
  })

  it('puts the mark button beside submit in subjective mode and keeps it below choices', () => {
    const onToggle = vi.fn()
    const question = {
      question_type: 'multiple_choice' as const,
      stem: '细胞的供能结构是？',
      options: [
        { id: 'A', text: '细胞膜' },
        { id: 'B', text: '线粒体' },
      ],
      answer_payload: { correct_option_id: 'B' },
      analysis: '线粒体是主要供能结构。',
      source_meta: MANUAL_SOURCE,
    }
    const { rerender } = render(
      <QuizQuestionInteraction
        question={question}
        state={{}}
        onStateChange={() => {}}
        mark={{ marked: false, onToggle }}
      />,
    )

    expect(screen.queryByRole('button', { name: 'AI点评' })).toBeNull()
    expect(screen.queryByRole('button', { name: '提交答案' })).toBeNull()
    expect(screen.getByRole('button', { name: '标记' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '主观' }))
    const submit = screen.getByRole('button', { name: '提交答案' })
    const mark = screen.getByRole('button', { name: '标记' })
    expect(screen.getAllByRole('button', { name: '标记' })).toHaveLength(1)
    expect(submit.parentElement?.contains(mark)).toBe(true)
    expect(screen.queryByRole('button', { name: 'AI点评' })).toBeNull()

    fireEvent.click(mark)
    expect(onToggle).toHaveBeenCalledWith(true)

    rerender(
      <QuizQuestionInteraction
        question={question}
        state={{}}
        onStateChange={() => {}}
        mark={{ marked: true, onToggle }}
      />,
    )
    expect(screen.getByRole('button', { name: '取消标记' })).toBeTruthy()
  })

  it('does not show the choice/subjective toggle on non-choice questions', () => {
    renderInteraction({
      question_type: 'true_false',
      stem: 'DNA 复制只发生在分裂后期。',
      options: [],
      answer_payload: { correct_answer: false },
      analysis: '',
      source_meta: MANUAL_SOURCE,
    })

    expect(screen.queryByRole('button', { name: '主观' })).toBeNull()
  })

  it('rewrites a multiple-choice question as a short-answer prompt', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'multiple_choice',
      stem: '细胞的供能结构是？',
      options: [
        { id: 'A', text: '细胞膜' },
        { id: 'B', text: '线粒体' },
      ],
      answer_payload: { correct_option_id: 'B' },
      analysis: '线粒体是主要供能结构。',
      source_meta: MANUAL_SOURCE,
    })

    fireEvent.click(screen.getByRole('button', { name: '主观' }))
    expect(screen.getByPlaceholderText('先写下你的答案，再点击提交')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /线粒体/ })).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('先写下你的答案，再点击提交'), {
      target: { value: '线粒体负责供能' },
    })
    rerenderWithLatestState()
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }))
    rerenderWithLatestState()

    expect(screen.queryByText('参考答案')).toBeNull()
    expect(screen.getByText('选项')).toBeTruthy()
    expect(screen.getByText('A. 细胞膜')).toBeTruthy()
    expect(screen.getByText('B. 线粒体')).toBeTruthy()
    expect(screen.queryByText('B. 线粒体（正确答案）')).toBeNull()
    expect(screen.getByText((_, node) => node?.textContent === '答案：线粒体\n线粒体是主要供能结构。')).toBeTruthy()
  })

  it('reveals except-item options without treating them as the recall answer', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'multiple_choice',
      stem: '以下哪项不符合乌申斯基的教育观点',
      options: [
        { id: 'A', text: '教育应培养全面和谐发展的个人' },
        { id: 'B', text: '教育的最终目的在于满足社会的要求' },
        { id: 'C', text: '教学要适应儿童的年龄特征' },
      ],
      answer_payload: { correct_option_id: 'B' },
      analysis: '其余选项符合其观点。',
      source_meta: MANUAL_SOURCE,
    })

    fireEvent.click(screen.getByRole('button', { name: '主观' }))
    fireEvent.click(screen.getByRole('button', { name: '提交答案' }))
    rerenderWithLatestState()

    expect(screen.getByText('B. 教育的最终目的在于满足社会的要求')).toBeTruthy()
    expect(screen.queryByText('B. 教育的最终目的在于满足社会的要求（原题例外项）')).toBeNull()
    expect(screen.queryByText('B. 教育的最终目的在于满足社会的要求（正确答案）')).toBeNull()
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent ===
          '答案：教育应培养全面和谐发展的个人；教学要适应儿童的年龄特征\n其余选项符合其观点。',
      ),
    ).toBeTruthy()
  })

  it('submits a converted multiple-choice recall with Enter', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'multiple_choice',
      stem: '细胞的供能结构是？',
      options: [
        { id: 'A', text: '细胞膜' },
        { id: 'B', text: '线粒体' },
      ],
      answer_payload: { correct_option_id: 'B' },
      analysis: '线粒体是主要供能结构。',
      source_meta: MANUAL_SOURCE,
    })

    fireEvent.click(screen.getByRole('button', { name: '主观' }))
    expect(document.activeElement).toBe(document.querySelector('[data-quiz-shortcut-surface]'))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' })
    rerenderWithLatestState()

    expect(screen.queryByText('参考答案')).toBeNull()
    expect(screen.getByText('A. 细胞膜')).toBeTruthy()
    expect(screen.getByText('B. 线粒体')).toBeTruthy()
    expect(screen.queryByText('B. 线粒体（正确答案）')).toBeNull()
    expect(screen.getByText((_, node) => node?.textContent === '答案：线粒体\n线粒体是主要供能结构。')).toBeTruthy()
  })

  it('submits a short answer with Enter while typing', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'short_answer',
      stem: '简述有丝分裂的意义。',
      options: [],
      answer_payload: { reference_answer: '保证遗传信息稳定传递。' },
      analysis: '核心在于遗传物质平均分配。',
      source_meta: MANUAL_SOURCE,
    })

    const textarea = screen.getByPlaceholderText('先写下你的答案，再点击提交')
    fireEvent.change(textarea, { target: { value: '保证传递' } })
    rerenderWithLatestState()
    fireEvent.keyDown(screen.getByPlaceholderText('先写下你的答案，再点击提交'), {
      key: 'Enter',
    })
    rerenderWithLatestState()
    expect(screen.getByText('保证遗传信息稳定传递。')).toBeTruthy()
  })

  it('keeps Shift+Enter as a newline while typing', () => {
    renderInteraction({
      question_type: 'short_answer',
      stem: '简述有丝分裂的意义。',
      options: [],
      answer_payload: { reference_answer: '保证遗传信息稳定传递。' },
      analysis: '',
      source_meta: MANUAL_SOURCE,
    })

    const textarea = screen.getByPlaceholderText('先写下你的答案，再点击提交')
    fireEvent.change(textarea, { target: { value: '保证传递' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(screen.queryByText('保证遗传信息稳定传递。')).toBeNull()
  })

  it('submits an empty short answer with Space in the textarea', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'short_answer',
      stem: '简述有丝分裂的意义。',
      options: [],
      answer_payload: { reference_answer: '保证遗传信息稳定传递。' },
      analysis: '核心在于遗传物质平均分配。',
      source_meta: MANUAL_SOURCE,
    })

    const textarea = screen.getByPlaceholderText('先写下你的答案，再点击提交')
    fireEvent.keyDown(textarea, { key: ' ', code: 'Space' })
    rerenderWithLatestState()
    expect(screen.getByText('保证遗传信息稳定传递。')).toBeTruthy()
  })

  it('submits with Enter when the prompt is not focused in a text field', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'short_answer',
      stem: '简述有丝分裂的意义。',
      options: [],
      answer_payload: { reference_answer: '保证遗传信息稳定传递。' },
      analysis: '核心在于遗传物质平均分配。',
      source_meta: MANUAL_SOURCE,
    })

    expect(document.activeElement).toBe(document.querySelector('[data-quiz-shortcut-surface]'))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' })
    rerenderWithLatestState()
    expect(screen.getByText('保证遗传信息稳定传递。')).toBeTruthy()
  })

  it('submits with Space when the prompt is not focused in a text field', () => {
    const { rerenderWithLatestState } = renderInteraction({
      question_type: 'short_answer',
      stem: '简述有丝分裂的意义。',
      options: [],
      answer_payload: { reference_answer: '保证遗传信息稳定传递。' },
      analysis: '核心在于遗传物质平均分配。',
      source_meta: MANUAL_SOURCE,
    })

    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })
    rerenderWithLatestState()
    expect(screen.getByText('保证遗传信息稳定传递。')).toBeTruthy()
  })

  it('keeps Space as a character while typing a non-empty answer', () => {
    renderInteraction({
      question_type: 'short_answer',
      stem: '简述有丝分裂的意义。',
      options: [],
      answer_payload: { reference_answer: '保证遗传信息稳定传递。' },
      analysis: '',
      source_meta: MANUAL_SOURCE,
    })

    const textarea = screen.getByPlaceholderText('先写下你的答案，再点击提交')
    fireEvent.change(textarea, { target: { value: '遗传' } })
    fireEvent.keyDown(textarea, { key: ' ', code: 'Space' })
    expect(screen.queryByText('保证遗传信息稳定传递。')).toBeNull()
  })
})
