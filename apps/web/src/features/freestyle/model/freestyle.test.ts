import { beforeEach, describe, expect, it } from 'vitest'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  DEFAULT_FREESTYLE_CONFIG,
  buildFreestyleQueue,
  buildQueueSignature,
  readFreestyleConfig,
  readFreestyleProgress,
  saveFreestyleConfig,
  saveFreestyleProgress,
  sanitizeFreestyleConfig,
} from './freestyle'

function quizCard(id: number, groupKey: string, palaceId = 1): FreestyleCard {
  return {
    id: `quiz:${id}`,
    type: 'quiz_question',
    content_type: 'quiz_question',
    group_key: groupKey,
    palace_context: {
      id: palaceId,
      title: `宫殿 ${palaceId}`,
    },
    question: {
      id,
      palace_id: palaceId,
      mini_palace_id: null,
      mini_palace: null,
      question_type: 'multiple_choice',
      stem: `题 ${id}`,
      options: [
        { id: 'A', text: 'A' },
        { id: 'B', text: 'B' },
      ],
      answer_payload: { correct_option_id: 'A' },
      analysis: '',
      source_meta: {
        source_kind: 'manual',
        subject_document_id: null,
        page_numbers: null,
        image_names: null,
        extra_prompt: '',
        ai_call_log_id: null,
        generated_at: '',
        generation_mode: 'manual',
      },
      sort_order: id,
      correct_count: 0,
      incorrect_count: 0,
      attempt_count: 0,
      created_at: null,
      updated_at: null,
    },
  }
}

function actionCard(id: string, priority = 10): FreestyleCard {
  return {
    id,
    type: 'action',
    content_type: 'review',
    action_kind: 'review',
    title: id,
    subtitle: '',
    href: '/review/session/1',
    priority,
    reason: '待复习',
    palace_context: {
      id: 1,
      title: '宫殿 1',
    },
  }
}

describe('freestyle queue model', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('keeps quiz cards from the same group contiguous before switching groups', () => {
    const queue = buildFreestyleQueue(
      [
        quizCard(1, 'palace:1'),
        quizCard(2, 'palace:2', 2),
        quizCard(3, 'palace:1'),
        quizCard(4, 'palace:2', 2),
      ],
      {
        ...DEFAULT_FREESTYLE_CONFIG,
        actionFrequency: 'none',
        seed: 3,
      },
    )

    const groupRuns = queue.map((card) => (card.type === 'quiz_question' ? card.group_key : 'action'))
    expect(groupRuns[0]).toBe(groupRuns[1])
    expect(groupRuns[2]).toBe(groupRuns[3])
    expect(groupRuns[0]).not.toBe(groupRuns[2])
  })

  it('mixes higher-priority action cards at the configured interval', () => {
    const queue = buildFreestyleQueue(
      [
        quizCard(1, 'palace:1'),
        quizCard(2, 'palace:1'),
        quizCard(3, 'palace:1'),
        quizCard(4, 'palace:1'),
        actionCard('review-low', 10),
        actionCard('review-high', 50),
      ],
      {
        ...DEFAULT_FREESTYLE_CONFIG,
        orderMode: 'sequential',
        actionFrequency: 'high',
      },
    )

    expect(queue.map((card) => card.id)).toEqual([
      'quiz:1',
      'quiz:2',
      'quiz:3',
      'review-high',
      'quiz:4',
      'review-low',
    ])
  })

  it('filters by question type and specific palaces', () => {
    const config = sanitizeFreestyleConfig({
      ...DEFAULT_FREESTYLE_CONFIG,
      range: 'specific_palaces',
      specificPalaceIds: [2],
      questionType: 'short_answer',
    })
    const shortCard = quizCard(2, 'palace:2', 2)
    if (shortCard.type === 'quiz_question') {
      shortCard.question.question_type = 'short_answer'
    }
    const queue = buildFreestyleQueue([quizCard(1, 'palace:1', 1), shortCard], config)

    expect(queue).toHaveLength(1)
    expect(queue[0]?.id).toBe('quiz:2')
  })

  it('persists config, progress and queue signatures locally', () => {
    const savedConfig = saveFreestyleConfig({
      ...DEFAULT_FREESTYLE_CONFIG,
      range: 'due',
      seed: 99,
    })
    const savedProgress = saveFreestyleProgress({
      currentIndex: 2,
      correctStreak: 4,
      questionStates: { 1: { resolved: true, correct: true } },
      resolvedQuestionIds: [1],
      lastQueueSignature: buildQueueSignature([quizCard(1, 'palace:1')]),
    })

    expect(readFreestyleConfig()).toEqual(savedConfig)
    expect(readFreestyleProgress()).toEqual(savedProgress)
  })
})
