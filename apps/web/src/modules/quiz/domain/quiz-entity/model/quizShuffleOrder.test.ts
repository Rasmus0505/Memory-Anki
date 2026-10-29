import { beforeEach, describe, expect, it } from 'vitest'
import {
  resetClientPreferenceCacheForTest,
  setClientPreference,
} from '@/shared/preferences/clientPreferences'
import {
  applyQuizShuffleOrder,
  quizShuffleSetStorageKey,
  quizShuffleStorageKey,
  readQuizShuffleOrder,
  saveQuizShuffleOrder,
  shuffleQuizQuestionsForPractice,
} from './quizShuffleOrder'

const questions = [1, 2, 3, 4, 5].map((id) => ({ id, stem: `题 ${id}` }))
const ids = (items: readonly { id: number }[]) => items.map((item) => item.id)

describe('shuffleQuizQuestionsForPractice', () => {
  it('reorders only the unanswered questions, answered ones keep their slot', () => {
    const answered = new Set([2, 4])
    const shuffled = shuffleQuizQuestionsForPractice(questions, answered, () => 0)
    expect(shuffled[1].id).toBe(2)
    expect(shuffled[3].id).toBe(4)
    expect(new Set([shuffled[0].id, shuffled[2].id, shuffled[4].id])).toEqual(new Set([1, 3, 5]))
    expect(shuffled).not.toBe(questions)
    expect(ids(questions)).toEqual([1, 2, 3, 4, 5])
  })

  it('shuffles the whole list when every question is answered', () => {
    const answered = new Set([1, 2, 3, 4, 5])
    const shuffled = shuffleQuizQuestionsForPractice(questions, answered, () => 0)
    expect(shuffled).toHaveLength(5)
    expect(new Set(ids(shuffled))).toEqual(new Set([1, 2, 3, 4, 5]))
    expect(ids(shuffled)).not.toEqual([1, 2, 3, 4, 5])
  })

  it('leaves a single question alone', () => {
    const single = [{ id: 9 }]
    expect(shuffleQuizQuestionsForPractice(single, new Set(), () => 0)).toEqual(single)
  })
})

describe('applyQuizShuffleOrder', () => {
  it('follows the remembered order and appends questions it has never seen', () => {
    const ordered = applyQuizShuffleOrder(questions, [4, 1])
    expect(ids(ordered)).toEqual([4, 1, 2, 3, 5])
  })

  it('drops remembered ids that no longer exist and survives an empty memory', () => {
    expect(ids(applyQuizShuffleOrder(questions, [99, 3]))).toEqual([3, 1, 2, 4, 5])
    expect(ids(applyQuizShuffleOrder(questions, []))).toEqual([1, 2, 3, 4, 5])
    expect(ids(applyQuizShuffleOrder(questions, [99]))).toEqual([1, 2, 3, 4, 5])
  })
})

describe('quiz shuffle order storage', () => {
  const source = { palaceId: 7, nodeUid: 'node-a' }

  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
  })

  it('keys the order by palace and node', () => {
    expect(quizShuffleStorageKey(source)).toBe('7:node-a')
    expect(quizShuffleStorageKey({ palaceId: 7, nodeUid: null })).toBe('7:palace')
    expect(quizShuffleSetStorageKey(source, [3, 1, 2])).toBe('7:set:1,2,3')
  })

  it('round-trips the saved order', () => {
    saveQuizShuffleOrder(source, [3, 1, 2])
    expect(readQuizShuffleOrder(source)).toEqual([3, 1, 2])
    expect(readQuizShuffleOrder({ palaceId: 7, nodeUid: 'node-b' })).toEqual([])
  })

  it('reads the order from the shared preference, not this browser', () => {
    // Another surface (desktop window / the other device) already shuffled.
    void setClientPreference('quiz_shuffle_orders', { '7:node-a': [5, 4, 3, 2, 1] })
    expect(window.localStorage.getItem('memory-anki.quiz.shuffle-order.v1')).toBeNull()
    expect(readQuizShuffleOrder(source)).toEqual([5, 4, 3, 2, 1])
  })

  it('reuses the order for the same questions opened from another entry point', () => {
    saveQuizShuffleOrder(source, [3, 1, 2])
    expect(readQuizShuffleOrder({ palaceId: 7, nodeUid: 'node-b' }, [1, 2, 3])).toEqual([3, 1, 2])
    expect(readQuizShuffleOrder({ palaceId: 7, nodeUid: 'node-b' }, [1, 2, 3, 4])).toEqual([])
  })

  it('ignores corrupt storage instead of throwing', () => {
    window.localStorage.setItem('memory-anki.quiz.shuffle-order.v1', '{not json')
    expect(readQuizShuffleOrder(source)).toEqual([])
    window.localStorage.setItem('memory-anki.quiz.shuffle-order.v1', JSON.stringify({ '7:node-a': ['x', 2] }))
    expect(readQuizShuffleOrder(source)).toEqual([2])
  })

  it('does not save an unusable single-question order', () => {
    saveQuizShuffleOrder(source, [5])
    expect(readQuizShuffleOrder(source)).toEqual([])
  })
})
