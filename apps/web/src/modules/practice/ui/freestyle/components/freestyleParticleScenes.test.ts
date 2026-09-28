import { describe, expect, it } from 'vitest'
import { crossedQuarter } from './freestyleParticleScenes'

describe('crossedQuarter', () => {
  it('reports the mark passed on the way up', () => {
    expect(crossedQuarter(0.2, 0.26)).toEqual({ mark: 0.25, label: '四分之一' })
    expect(crossedQuarter(0.45, 0.5)).toEqual({ mark: 0.5, label: '过半了' })
    expect(crossedQuarter(0.7, 0.8)).toEqual({ mark: 0.75, label: '最后四分之一' })
  })

  it('reports only the highest mark when several are passed at once', () => {
    expect(crossedQuarter(0.1, 0.6)?.mark).toBe(0.5)
  })

  it('stays quiet when no mark is passed or progress goes back (undo, new round)', () => {
    expect(crossedQuarter(0.3, 0.4)).toBeNull()
    expect(crossedQuarter(0.6, 0.4)).toBeNull()
    expect(crossedQuarter(0.9, 0)).toBeNull()
  })
})
