import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  QuizQuestionInteraction,
  type QuizRuntimeState,
} from '@/entities/quiz'
import type { PalaceQuizQuestionDraft } from '@/shared/api/contracts'

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

describe('QuizQuestionInteraction', () => {
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
})
