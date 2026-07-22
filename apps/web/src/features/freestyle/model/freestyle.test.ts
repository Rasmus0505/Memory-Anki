import { beforeEach, describe, expect, it } from 'vitest'
import type { FreestyleActionCard, FreestyleCard } from '@/shared/api/contracts'
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
import {
  DEFAULT_TODAY_TRAINING_CONFIG,
  buildTodayTrainingQueue,
  readTodayTrainingConfig,
  readTodayTrainingProgress,
  saveTodayTrainingConfig,
  saveTodayTrainingProgress,
  restoreTodayTrainingQueue,
  todayFeedContentTypes,
} from './today-training'

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

function actionCard(
  id: string,
  priority = 10,
  contentType: FreestyleActionCard['content_type'] = 'review',
): FreestyleCard {
  return {
    id,
    type: 'action',
    content_type: contentType,
    action_kind: contentType === 'practice' ? 'practice' : contentType === 'english' ? 'english' : contentType === 'english_reading' ? 'english_reading' : 'review',
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

function palaceActionCard(id: string, palaceId: number, priority = 10): FreestyleCard {
  const card = actionCard(id, priority)
  return {
    ...card,
    palace_context: {
      id: palaceId,
      title: `宫殿 ${palaceId}`,
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

  it('downgrades resolved quiz cards after fresh cards in grouped random mode', () => {
    const queue = buildFreestyleQueue(
      [
        quizCard(1, 'palace:1'),
        quizCard(2, 'palace:1'),
        quizCard(3, 'palace:2', 2),
        quizCard(4, 'palace:2', 2),
      ],
      {
        ...DEFAULT_FREESTYLE_CONFIG,
        actionFrequency: 'none',
        seed: 3,
      },
      { resolvedQuestionIds: [1, 3] },
    )

    expect(queue.slice(0, 2).map((card) => card.id).sort()).toEqual(['quiz:2', 'quiz:4'])
    expect(queue.slice(2).map((card) => card.id).sort()).toEqual(['quiz:1', 'quiz:3'])
  })

  it('keeps all-resolved quiz cards available instead of emptying the queue', () => {
    const queue = buildFreestyleQueue(
      [quizCard(1, 'palace:1'), quizCard(2, 'palace:1')],
      {
        ...DEFAULT_FREESTYLE_CONFIG,
        actionFrequency: 'none',
      },
      { resolvedQuestionIds: [1, 2] },
    )

    expect(queue.map((card) => card.id).sort()).toEqual(['quiz:1', 'quiz:2'])
  })

  it('keeps random and sequential filters while downgrading resolved cards', () => {
    const shortCard = quizCard(2, 'palace:2', 2)
    if (shortCard.type === 'quiz_question') {
      shortCard.question.question_type = 'short_answer'
    }
    const config = sanitizeFreestyleConfig({
      ...DEFAULT_FREESTYLE_CONFIG,
      range: 'specific_palaces',
      specificPalaceIds: [2],
      orderMode: 'random',
      questionType: 'short_answer',
    })

    const randomQueue = buildFreestyleQueue(
      [quizCard(1, 'palace:1', 1), shortCard, palaceActionCard('review-2', 2)],
      config,
      { resolvedQuestionIds: [2] },
    )
    const sequentialQueue = buildFreestyleQueue(
      [quizCard(1, 'palace:1', 1), shortCard, palaceActionCard('review-2', 2)],
      { ...config, orderMode: 'sequential' },
      { resolvedQuestionIds: [2] },
    )

    expect(randomQueue.map((card) => card.id).sort()).toEqual(['quiz:2', 'review-2'])
    expect(sequentialQueue.map((card) => card.id)).toEqual(['quiz:2', 'review-2'])
  })

  it('restores normal order when local progress is cleared', () => {
    const cards = [quizCard(1, 'palace:1'), quizCard(2, 'palace:1'), quizCard(3, 'palace:1')]
    const config = {
      ...DEFAULT_FREESTYLE_CONFIG,
      orderMode: 'sequential' as const,
      actionFrequency: 'none' as const,
    }

    const downgraded = buildFreestyleQueue(cards, config, { resolvedQuestionIds: [1] })
    const cleared = buildFreestyleQueue(cards, config, { resolvedQuestionIds: [] })

    expect(downgraded.map((card) => card.id)).toEqual(['quiz:2', 'quiz:3', 'quiz:1'])
    expect(cleared.map((card) => card.id)).toEqual(['quiz:1', 'quiz:2', 'quiz:3'])
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
      activeQueueIds: ['quiz:1', 'quiz:2'],
      lastQueueSignature: buildQueueSignature([quizCard(1, 'palace:1')]),
    })

    expect(readFreestyleConfig()).toEqual(savedConfig)
    expect(readFreestyleProgress()).toEqual(savedProgress)
  })

  it('defaults missing active queue ids when reading legacy progress', () => {
    window.localStorage.setItem(
      'memory-anki.freestyle.progress',
      JSON.stringify({
        currentIndex: 2,
        correctStreak: 1,
        questionStates: {},
        resolvedQuestionIds: [1],
        lastQueueSignature: 'quiz:1|quiz:2',
      }),
    )

    expect(readFreestyleProgress().activeQueueIds).toEqual([])
  })
})

describe('today training queue model', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('orders due actions, due quiz, practice cards, then fill quiz', () => {
    const queue = buildTodayTrainingQueue(
      {
        dueCards: [
          quizCard(1, 'palace:1'),
          actionCard('due-low', 10),
          actionCard('due-high', 50),
        ],
        practiceCards: [
          quizCard(2, 'palace:2', 2),
          actionCard('practice-action', 20, 'practice'),
        ],
        fillCards: [quizCard(3, 'palace:3', 3)],
      },
      DEFAULT_TODAY_TRAINING_CONFIG,
    )

    expect(queue.map((card) => card.id)).toEqual([
      'due-high',
      'due-low',
      'quiz:1',
      'practice-action',
      'quiz:2',
      'quiz:3',
    ])
  })

  it('deduplicates cards and limits the queue to the configured round size', () => {
    const fillCards = Array.from({ length: 20 }, (_, index) =>
      quizCard(index + 1, `palace:${index + 1}`, index + 1),
    )
    const queue = buildTodayTrainingQueue(
      {
        dueCards: [fillCards[0]],
        practiceCards: [fillCards[0], fillCards[1]],
        fillCards,
      },
      DEFAULT_TODAY_TRAINING_CONFIG,
    )

    expect(queue).toHaveLength(12)
    expect(new Set(queue.map((card) => card.id)).size).toBe(12)
  })

  it('restores an active round by card id without filling missing cards', () => {
    const restored = restoreTodayTrainingQueue(
      {
        dueCards: [quizCard(1, 'palace:1'), actionCard('due-review', 20)],
        practiceCards: [quizCard(2, 'palace:2', 2)],
        fillCards: [quizCard(3, 'palace:3', 3)],
      },
      ['quiz:3', 'missing-card', 'due-review', 'quiz:1', 'quiz:3'],
    )

    expect(restored.map((card) => card.id)).toEqual(['quiz:3', 'due-review', 'quiz:1'])
  })

  it('keeps english feed content disabled by default and enables it from config', () => {
    expect(todayFeedContentTypes(DEFAULT_TODAY_TRAINING_CONFIG).fill).toEqual([
      'quiz_question',
    ])

    expect(
      todayFeedContentTypes({
        ...DEFAULT_TODAY_TRAINING_CONFIG,
        includeEnglish: true,
        includeEnglishReading: true,
      }).fill,
    ).toEqual(['quiz_question', 'english', 'english_reading'])
  })

  it('persists today training config without touching freestyle config', () => {
    saveFreestyleConfig({
      ...DEFAULT_FREESTYLE_CONFIG,
      range: 'specific_palaces',
      specificPalaceIds: [9],
    })
    const savedToday = saveTodayTrainingConfig({
      ...DEFAULT_TODAY_TRAINING_CONFIG,
      includeEnglish: true,
      includeEnglishReading: true,
      seed: 88,
    })

    expect(readTodayTrainingConfig()).toEqual(savedToday)
    expect(readFreestyleConfig().range).toBe('specific_palaces')
  })

  it('persists today training active queue ids', () => {
    const savedProgress = saveTodayTrainingProgress({
      currentIndex: 1,
      correctStreak: 0,
      questionStates: {},
      resolvedQuestionIds: [],
      activeQueueIds: ['quiz:2', 'quiz:1', '', 'quiz:2'],
      lastQueueSignature: 'quiz:2|quiz:1',
    })

    expect(savedProgress.activeQueueIds).toEqual(['quiz:2', 'quiz:1'])
    expect(readTodayTrainingProgress()).toEqual(savedProgress)
  })
})
