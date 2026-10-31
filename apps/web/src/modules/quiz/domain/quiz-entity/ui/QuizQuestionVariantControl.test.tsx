import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PalaceQuizQuestion, PalaceQuizQuestionVersions } from '@/shared/api/contracts'

import {
  activatePalaceQuizQuestionVariantApi,
  getPalaceQuizQuestionVersionsApi,
  setPalaceQuizQuestionMutationMarkApi,
} from '../api'
import { QuizQuestionVariantControl } from './QuizQuestionVariantControl'

vi.mock('../api', () => ({
  setPalaceQuizQuestionMutationMarkApi: vi.fn(),
  activatePalaceQuizQuestionVariantApi: vi.fn(),
  getPalaceQuizQuestionVersionsApi: vi.fn(),
  deletePalaceQuizQuestionVariantApi: vi.fn(),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

const baseQuestion: PalaceQuizQuestion = {
  id: 1024,
  palace_id: 1,
  question_type: 'multiple_choice',
  stem: '原题',
  options: [
    { id: 'A', text: '甲' },
    { id: 'B', text: '乙' },
  ],
  answer_payload: { correct_option_id: 'A' },
  analysis: '原解析',
  source_meta: { source_kind: 'manual', page_numbers: null, image_names: null, extra_prompt: '', ai_call_log_id: null, generated_at: '', generation_mode: 'manual' },
  sort_order: 1,
  correct_count: 0,
  incorrect_count: 0,
  attempt_count: 0,
  needs_mutation: false,
  active_version_id: 'original',
  variant_count: 0,
  created_at: null,
  updated_at: null,
}

const variantQuestion: PalaceQuizQuestion = {
  ...baseQuestion,
  stem: '变体题',
  active_version_id: 'v1',
  variant_count: 1,
  needs_mutation: false,
  original_content: {
    question_type: 'multiple_choice',
    stem: '原题',
    options: baseQuestion.options,
    answer_payload: baseQuestion.answer_payload,
    analysis: '原解析',
  },
}

const versions: PalaceQuizQuestionVersions = {
  question_id: 1024,
  active_version_id: 'v1',
  needs_mutation: false,
  original: {
    version_id: 'original',
    created_at: null,
    question_type: 'multiple_choice',
    stem: '原题',
    options: baseQuestion.options,
    answer_payload: baseQuestion.answer_payload,
    analysis: '原解析',
  },
  versions: [
    {
      version_id: 'v1',
      created_at: '2026-10-31T08:00:00',
      question_type: 'multiple_choice',
      stem: '变体题',
      options: baseQuestion.options,
      answer_payload: { correct_option_id: 'B' },
      analysis: '变体解析',
      base_version_id: 'original',
    },
  ],
  mutation_attempt_count: 3,
  consecutive_correct_count: 3,
  last_answer_duration_ms: 4200,
  variant_activated_at: null,
}

describe('QuizQuestionVariantControl', () => {
  beforeEach(() => {
    vi.mocked(setPalaceQuizQuestionMutationMarkApi).mockReset()
    vi.mocked(activatePalaceQuizQuestionVariantApi).mockReset()
    vi.mocked(getPalaceQuizQuestionVersionsApi).mockReset()
  })

  it('marks an original question and reports the updated item', async () => {
    const onUpdated = vi.fn()
    vi.mocked(setPalaceQuizQuestionMutationMarkApi).mockResolvedValue({
      item: { ...baseQuestion, needs_mutation: true },
    })
    render(
      <QuizQuestionVariantControl question={baseQuestion} onQuestionUpdated={onUpdated} />,
    )
    expect(screen.getByText('🏛️ 原真题')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /标记换题/ }))
    await waitFor(() =>
      expect(setPalaceQuizQuestionMutationMarkApi).toHaveBeenCalledWith(1024, true),
    )
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ needs_mutation: true }),
    )
  })

  it('restores the original version and resets the local answer', async () => {
    const onUpdated = vi.fn()
    const onAnswerReset = vi.fn()
    vi.mocked(activatePalaceQuizQuestionVariantApi).mockResolvedValue({
      item: { ...baseQuestion, active_version_id: 'original' },
    })
    render(
      <QuizQuestionVariantControl
        question={variantQuestion}
        onQuestionUpdated={onUpdated}
        onAnswerReset={onAnswerReset}
      />,
    )
    expect(screen.getByText('🧬 AI 变体 · v1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /恢复真题/ }))
    await waitFor(() =>
      expect(activatePalaceQuizQuestionVariantApi).toHaveBeenCalledWith(1024, 'original'),
    )
    expect(onAnswerReset).toHaveBeenCalledWith(1024)
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ active_version_id: 'original' }),
    )
  })

  it('opens the version sheet and can activate the original', async () => {
    vi.mocked(getPalaceQuizQuestionVersionsApi).mockResolvedValue(versions)
    vi.mocked(activatePalaceQuizQuestionVariantApi).mockResolvedValue({
      item: { ...baseQuestion, active_version_id: 'original' },
    })
    render(<QuizQuestionVariantControl question={variantQuestion} />)
    fireEvent.click(screen.getByRole('button', { name: /历史版本/ }))
    await waitFor(() => expect(getPalaceQuizQuestionVersionsApi).toHaveBeenCalledWith(1024))
    expect(screen.getAllByText(/原始真题/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/AI 变体 · v1/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '设为当前显示' }))
    await waitFor(() =>
      expect(activatePalaceQuizQuestionVariantApi).toHaveBeenCalledWith(1024, 'original'),
    )
  })
})
