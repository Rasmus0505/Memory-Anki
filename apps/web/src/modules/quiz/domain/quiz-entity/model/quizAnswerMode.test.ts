import { describe, expect, it } from 'vitest'
import {
  canSwitchQuizAnswerMode,
  DEFAULT_QUIZ_ANSWER_MODE_SETTINGS,
  isQuizChoiceShortcutActive,
  isQuizSubjectivePresentation,
  mcqReferenceAnswer,
  formatMcqSubjectiveAnalysis,
  mcqRevealOptions,
  mcqSubjectiveReferenceAnswer,
  quizDisplayStem,
  quizInteractionRestoreKey,
  sanitizeQuizAnswerModeSettings,
} from './quizAnswerMode'

describe('quizAnswerMode', () => {
  it('allows switching only on multiple-choice questions', () => {
    expect(canSwitchQuizAnswerMode('multiple_choice')).toBe(true)
    expect(canSwitchQuizAnswerMode('short_answer')).toBe(false)
    expect(canSwitchQuizAnswerMode('true_false')).toBe(false)
  })

  it('treats converted multiple-choice as a short-answer presentation', () => {
    expect(isQuizSubjectivePresentation('multiple_choice', 'subjective')).toBe(true)
    expect(isQuizSubjectivePresentation('multiple_choice', 'choice')).toBe(false)
    expect(isQuizSubjectivePresentation('short_answer', 'choice')).toBe(true)
  })

  it('disables choice shortcuts in subjective mode', () => {
    expect(isQuizChoiceShortcutActive('multiple_choice', 'choice')).toBe(true)
    expect(isQuizChoiceShortcutActive('multiple_choice', 'subjective')).toBe(false)
    expect(isQuizChoiceShortcutActive('short_answer', 'choice')).toBe(false)
  })

  it('builds the multiple-choice reference answer from the correct option', () => {
    expect(
      mcqReferenceAnswer({
        options: [
          { id: 'A', text: '细胞膜' },
          { id: 'B', text: '线粒体' },
        ],
        answer_payload: { correct_option_id: 'B' },
      }),
    ).toBe('B. 线粒体')
    expect(mcqReferenceAnswer({ options: [], answer_payload: { correct_option_id: 'A' } })).toBe('A')
    expect(mcqReferenceAnswer({ options: [], answer_payload: {} })).toBe('')
  })

  it('rewrites multiple-choice stems only in subjective mode', () => {
    const question = {
      question_type: 'multiple_choice',
      stem: '以下哪项不符合乌申斯基的教育观点',
      options: [
        { id: 'A', text: '培养全面和谐发展的个人' },
        { id: 'B', text: '教育的最终目的在于满足社会的要求' },
      ],
      answer_payload: { correct_option_id: 'B' },
    }
    expect(quizDisplayStem(question, 'choice')).toBe('以下哪项不符合乌申斯基的教育观点')
    expect(quizDisplayStem(question, 'subjective')).toBe('乌申斯基的教育观点有哪些')
    expect(
      quizDisplayStem({ ...question, question_type: 'short_answer' }, 'subjective'),
    ).toBe('以下哪项不符合乌申斯基的教育观点')
    expect(mcqSubjectiveReferenceAnswer(question)).toBe('培养全面和谐发展的个人')
  })

  it('puts the converted multiple-choice answer on the first analysis line', () => {
    expect(formatMcqSubjectiveAnalysis('体操学校', '本题属于对识记性知识的考查。')).toBe(
      '答案：体操学校\n本题属于对识记性知识的考查。',
    )
    expect(formatMcqSubjectiveAnalysis('体操学校', '')).toBe('答案：体操学校')
    expect(formatMcqSubjectiveAnalysis('', '其余选项符合其观点。')).toBe('其余选项符合其观点。')
    expect(formatMcqSubjectiveAnalysis('', '')).toBe('暂无解析')
  })

  it('lists every option for the post-submit reveal', () => {
    expect(
      mcqRevealOptions({
        options: [
          { id: 'A', text: '细胞膜' },
          { id: 'B', text: '线粒体' },
        ],
        answer_payload: { correct_option_id: 'B' },
      }),
    ).toEqual([
      { id: 'A', text: '细胞膜', correct: false },
      { id: 'B', text: '线粒体', correct: true },
    ])
  })

  it('changes the shortcut restore key when the question or mode changes', () => {
    expect(quizInteractionRestoreKey({ id: 1, question_type: 'multiple_choice' }, 'choice')).not.toBe(
      quizInteractionRestoreKey({ id: 2, question_type: 'multiple_choice' }, 'choice'),
    )
    expect(quizInteractionRestoreKey({ id: 1, question_type: 'multiple_choice' }, 'choice')).not.toBe(
      quizInteractionRestoreKey({ id: 1, question_type: 'multiple_choice' }, 'subjective'),
    )
  })

  it('sanitizes persisted answer-mode settings', () => {
    expect(sanitizeQuizAnswerModeSettings(null)).toEqual(DEFAULT_QUIZ_ANSWER_MODE_SETTINGS)
    expect(sanitizeQuizAnswerModeSettings('subjective')).toEqual({ mcqMode: 'subjective' })
    expect(sanitizeQuizAnswerModeSettings({ mcqMode: 'subjective' })).toEqual({ mcqMode: 'subjective' })
    expect(sanitizeQuizAnswerModeSettings({ mcqMode: 'nope' })).toEqual({ mcqMode: 'choice' })
  })
})
