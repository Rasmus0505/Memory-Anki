import { describe, expect, it } from 'vitest'
import {
  classifyFreestyleLearningSurface,
  freestyleLearningAdds,
  mergeFreestyleLearningTime,
  subtractFreestyleLearningTime,
  takeFreestyleLearningChunk,
} from './freestyleLearningTime'

describe('freestyleLearningTime', () => {
  it('counts quiz only while the quiz overlay is the top surface', () => {
    expect(classifyFreestyleLearningSurface({
      visible: true,
      viewingCard: true,
      scene: 'quiz',
      title: '做题',
    })).toBe('quiz')
    expect(classifyFreestyleLearningSurface({
      visible: true,
      viewingCard: true,
      scene: 'quiz',
      title: '关联题目',
    })).toBe('quiz')
    expect(classifyFreestyleLearningSurface({
      visible: true,
      viewingCard: true,
      scene: 'practice',
      title: '查看宫殿',
    })).toBe('lookup')
    expect(classifyFreestyleLearningSurface({
      visible: true,
      viewingCard: true,
      scene: 'freestyle',
      title: null,
    })).toBe('unit')
    expect(classifyFreestyleLearningSurface({
      visible: true,
      viewingCard: false,
      scene: 'freestyle',
      title: null,
    })).toBeNull()
  })

  it('merges headline totals and palace rows independently', () => {
    const merged = mergeFreestyleLearningTime(
      {
        unitSeconds: 10,
        quizSeconds: 4,
        lookupSeconds: 0,
        backfilled: true,
        byPalace: { '11': { unitSeconds: 10, quizSeconds: 0, lookupSeconds: 0 } },
      },
      {
        unitSeconds: 0,
        quizSeconds: 3,
        lookupSeconds: 2,
        backfilled: false,
        byPalace: { '11': { unitSeconds: 0, quizSeconds: 3, lookupSeconds: 1 } },
      },
    )
    expect(merged.unitSeconds).toBe(10)
    expect(merged.quizSeconds).toBe(7)
    expect(merged.lookupSeconds).toBe(2)
    expect(merged.byPalace['11']).toEqual({ unitSeconds: 10, quizSeconds: 3, lookupSeconds: 1 })
  })

  it('chunks a pending buffer without dropping the remainder', () => {
    const pending = {
      unitSeconds: 1000,
      quizSeconds: 50,
      lookupSeconds: 0,
      backfilled: true,
      byPalace: { '11': { unitSeconds: 1000, quizSeconds: 20, lookupSeconds: 0 } },
    }
    const taken = takeFreestyleLearningChunk(pending, 900)
    const rest = subtractFreestyleLearningTime(pending, taken)
    expect(taken.unitSeconds + taken.quizSeconds + taken.lookupSeconds).toBe(900)
    expect(rest.unitSeconds + rest.quizSeconds + rest.lookupSeconds).toBe(150)
    expect(freestyleLearningAdds(taken).every((item) => item.seconds <= 900)).toBe(true)
  })
})
