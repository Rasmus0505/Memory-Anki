import { describe, expect, it } from 'vitest'
import {
  REGISTERED_STORAGE_KEYS,
  assertNoDuplicateStorageKeys,
  findDuplicateStorageKeys,
} from './storageRegistry'

describe('storageRegistry', () => {
  it('keeps production storage keys unique', () => {
    expect(findDuplicateStorageKeys(REGISTERED_STORAGE_KEYS)).toEqual([])
  })

  it('reports duplicate keys within the same storage area', () => {
    const entries = [
      {
        id: 'one',
        key: 'duplicate-key',
        area: 'localStorage',
        owner: 'test',
        purpose: 'first',
      },
      {
        id: 'two',
        key: 'duplicate-key',
        area: 'localStorage',
        owner: 'test',
        purpose: 'second',
      },
    ] as const

    expect(findDuplicateStorageKeys(entries)).toEqual([
      {
        area: 'localStorage',
        key: 'duplicate-key',
        ids: ['one', 'two'],
      },
    ])
    expect(() => assertNoDuplicateStorageKeys(entries)).toThrow(
      'Duplicate storage key registered',
    )
  })
})
