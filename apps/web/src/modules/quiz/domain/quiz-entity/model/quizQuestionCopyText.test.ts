import { describe, expect, it } from 'vitest'
import type { PalaceQuizQuestionType } from '@/shared/api/contracts'
import {
  buildQuizQuestionsCopyText,
  formatQuizQuestionCopyAnswer,
  type QuizCopyQuestion,
} from './quizQuestionCopyText'

function question(
  questionType: PalaceQuizQuestionType,
  overrides: Partial<QuizCopyQuestion> = {},
): QuizCopyQuestion {
  return {
    question_type: questionType,
    stem: '题干',
    options: [],
    answer_payload: {},
    analysis: '',
    ...overrides,
  }
}

describe('quizQuestionCopyText', () => {
  it('copies a single-choice question as stem, options, answer and analysis', () => {
    const text = buildQuizQuestionsCopyText([
      question('multiple_choice', {
        stem: '书院教学的基本精神是（　）。',
        options: [
          { id: 'A', text: '分斋教学' },
          { id: 'B', text: '自由讲学' },
          { id: 'C', text: '注重考试' },
          { id: 'D', text: '藏书读书' },
        ],
        answer_payload: { correct_option_id: 'B' },
        analysis: '书院以自由讲学为基本精神。',
      }),
    ])

    expect(text).toBe([
      '1. 书院教学的基本精神是（　）。',
      '   A. 分斋教学',
      '   B. 自由讲学',
      '   C. 注重考试',
      '   D. 藏书读书',
      '   答案：B. 自由讲学',
      '   解析：书院以自由讲学为基本精神。',
    ].join('\n'))
  })

  it('lists every correct option of a multi-select question', () => {
    const answer = formatQuizQuestionCopyAnswer(
      question('multiple_choice', {
        options: [
          { id: 'A', text: '甲' },
          { id: 'B', text: '乙' },
          { id: 'C', text: '丙' },
        ],
        answer_payload: { correct_option_ids: ['A', 'C'] },
      }),
    )

    expect(answer).toBe('答案：A. 甲；C. 丙')
  })

  it('copies a true/false answer with its correction point', () => {
    expect(
      formatQuizQuestionCopyAnswer(
        question('true_false', {
          answer_payload: { correct_answer: false, false_explanation: '应为分斋教学。' },
        }),
      ),
    ).toBe(['答案：错', '错误点：应为分斋教学。'].join('\n'))
  })

  it('copies fill-blank answers per blank', () => {
    expect(
      formatQuizQuestionCopyAnswer(
        question('fill_blank', {
          answer_payload: { blanks: [{ id: '空1', answer: '线粒体' }] },
        }),
      ),
    ).toBe('答案：线粒体')
    expect(
      formatQuizQuestionCopyAnswer(
        question('fill_blank', {
          answer_payload: {
            blanks: [
              { id: '空1', answer: '线粒体' },
              { id: '空2', answer: '叶绿体' },
            ],
          },
        }),
      ),
    ).toBe('答案：空1：线粒体；空2：叶绿体')
  })

  it('copies matching pairs', () => {
    expect(
      formatQuizQuestionCopyAnswer(
        question('matching', {
          answer_payload: {
            pairs: [{ left_id: 'l1', left: '书院', right_id: 'r1', right: '自由讲学' }],
          },
        }),
      ),
    ).toBe('答案：书院 → 自由讲学')
  })

  it('copies the ordering answer in the correct order', () => {
    expect(
      formatQuizQuestionCopyAnswer(
        question('ordering', {
          answer_payload: {
            items: [
              { id: 'a', text: '第一' },
              { id: 'b', text: '第二' },
              { id: 'c', text: '第三' },
            ],
            correct_order_ids: ['b', 'a', 'c'],
          },
        }),
      ),
    ).toBe('答案：第二 → 第一 → 第三')
  })

  it('copies categorization assignments', () => {
    expect(
      formatQuizQuestionCopyAnswer(
        question('categorization', {
          answer_payload: {
            items: [
              { id: 'i1', text: '分斋教学', category_id: 'c1' },
              { id: 'i2', text: '自由讲学', category_id: 'c2' },
            ],
            categories: [
              { id: 'c1', name: '教学制度' },
              { id: 'c2', name: '教学精神' },
            ],
          },
        }),
      ),
    ).toBe('答案：分斋教学 → 教学制度；自由讲学 → 教学精神')
  })

  it('copies a short-answer reference and keeps missing answers out of the text', () => {
    expect(
      formatQuizQuestionCopyAnswer(
        question('short_answer', { answer_payload: { reference_answer: '磷脂双分子层。' } }),
      ),
    ).toBe('答案：磷脂双分子层。')
    expect(formatQuizQuestionCopyAnswer(question('short_answer'))).toBe('')
  })

  it('separates questions with a blank line and numbers them in window order', () => {
    const text = buildQuizQuestionsCopyText([
      question('multiple_choice', {
        stem: '第一题',
        options: [{ id: 'A', text: '甲' }],
        answer_payload: { correct_option_id: 'A' },
      }),
      question('short_answer', {
        stem: '第二题',
        answer_payload: { reference_answer: '答案乙' },
        analysis: '解析乙',
      }),
    ])

    expect(text).toBe([
      '1. 第一题',
      '   A. 甲',
      '   答案：A. 甲',
      '',
      '2. 第二题',
      '   答案：答案乙',
      '   解析：解析乙',
    ].join('\n'))
  })

  it('returns empty text for an empty window', () => {
    expect(buildQuizQuestionsCopyText([])).toBe('')
  })
})
