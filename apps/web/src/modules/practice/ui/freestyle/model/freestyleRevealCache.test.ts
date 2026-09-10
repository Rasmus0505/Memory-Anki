import { afterEach, describe, expect, it } from 'vitest'
import { readFreestyleRevealMap, writeFreestyleRevealMap } from './freestyleRevealCache'

describe('freestyleRevealCache', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('round-trips a reveal map for a card and ignores empty writes', () => {
    expect(readFreestyleRevealMap('card-1')).toBeNull()
    writeFreestyleRevealMap('card-1', { root: 'revealed', child: 'hidden' })
    expect(readFreestyleRevealMap('card-1')).toEqual({ root: 'revealed', child: 'hidden' })
    writeFreestyleRevealMap('card-1', { root: 'revealed', child: 'revealed' })
    expect(readFreestyleRevealMap('card-1')).toEqual({ root: 'revealed', child: 'revealed' })
  })

  it('keeps progress under the card id when an encounter id changes', () => {
    writeFreestyleRevealMap('card-1', { root: 'revealed', child: 'revealed' })
    expect(readFreestyleRevealMap('card-1:encounter-9')).toBeNull()
    expect(readFreestyleRevealMap('card-1')).toEqual({ root: 'revealed', child: 'revealed' })
  })
})
