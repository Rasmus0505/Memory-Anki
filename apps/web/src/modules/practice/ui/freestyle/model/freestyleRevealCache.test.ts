import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFreestyleRevealMap, writeFreestyleRevealMap } from './freestyleRevealCache'

const STORAGE_KEY = 'memory-anki.freestyle.reveal-map.v1'

describe('freestyleRevealCache', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
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

  it('parses the stored blob once across repeated reads', () => {
    writeFreestyleRevealMap('card-1', { root: 'revealed' })
    writeFreestyleRevealMap('card-2', { root: 'revealed' })

    const parse = vi.spyOn(JSON, 'parse')
    parse.mockClear()

    // Reading cards on every flip must not re-parse the whole blob each time.
    for (let i = 0; i < 10; i += 1) {
      readFreestyleRevealMap('card-1')
      readFreestyleRevealMap('card-2')
    }

    expect(parse).not.toHaveBeenCalled()
  })

  it('re-parses after an external write changes the stored blob', () => {
    writeFreestyleRevealMap('card-1', { root: 'revealed' })
    readFreestyleRevealMap('card-1')

    // Another tab, or a direct write, must invalidate the memo.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'card-1': { root: 'hidden' } }))
    expect(readFreestyleRevealMap('card-1')).toEqual({ root: 'hidden' })
  })

  it('recovers when the stored blob is corrupt', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    expect(readFreestyleRevealMap('card-1')).toBeNull()

    writeFreestyleRevealMap('card-1', { root: 'revealed' })
    expect(readFreestyleRevealMap('card-1')).toEqual({ root: 'revealed' })
  })

  it('caps how many cards are retained', () => {
    for (let i = 0; i < 45; i += 1) {
      writeFreestyleRevealMap(`card-${i}`, { root: 'revealed' })
    }
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    expect(Object.keys(stored).length).toBeLessThanOrEqual(40)
    expect(readFreestyleRevealMap('card-44')).toEqual({ root: 'revealed' })
  })
})
