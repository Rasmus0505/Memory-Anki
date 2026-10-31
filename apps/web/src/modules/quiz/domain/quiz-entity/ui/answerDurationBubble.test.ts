import { describe, expect, it } from 'vitest'
import { answerBubbleCopy } from './answerDurationBubble'

function text(copy: ReturnType<typeof answerBubbleCopy>) {
  return copy.parts.map((part) => part.text).join('')
}

describe('answerBubbleCopy', () => {
  it('flags a fast repeat correct as muscle memory', () => {
    const copy = answerBubbleCopy(1600, { correct: true, consecutiveCorrect: 3 })

    expect(copy.tone).toBe('fast')
    expect(text(copy)).toBe('1.6s · 肌肉记忆预警')
  })

  it('keeps a first fast correct as a plain 秒选', () => {
    const copy = answerBubbleCopy(1600, { correct: true, consecutiveCorrect: 1 })

    expect(copy.tone).toBe('good')
    expect(text(copy)).toBe('1.6s · 秒选')
  })

  it('reports a steady retrieval window and the delta against the last attempt', () => {
    const copy = answerBubbleCopy(4800, {
      correct: true,
      consecutiveCorrect: 1,
      previousDurationMs: 5600,
    })

    expect(copy.tone).toBe('good')
    expect(text(copy)).toBe('4.8s · 提取稳健 · 快 0.8s')
  })

  it('marks a slow correct as effortful retrieval', () => {
    const copy = answerBubbleCopy(14200, { correct: true })

    expect(copy.tone).toBe('warn')
    expect(text(copy)).toBe('14.2s · 检索吃力')
  })

  it('confirms the wrong option without a scolding tone', () => {
    const copy = answerBubbleCopy(3200, { correct: false })

    expect(copy.tone).toBe('error')
    expect(text(copy)).toBe('3.2s · 错选干扰项')
  })

  it('shows only the duration when correctness is unknown (short answer)', () => {
    const copy = answerBubbleCopy(2100)

    expect(copy.tone).toBe('neutral')
    expect(text(copy)).toBe('2.1s')
  })
})
