import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sanitizeFreestyleFeedConfig } from './feedConfig'

interface ConfigCase {
  name: string
  input: unknown
  expected: unknown
}

// Same golden file the backend test reads. If a field is normalized on one
// side only, this test (or the backend one) fails before the config ships.
const cases = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../api/tests/fixtures/freestyle_config_cases.json'),
    'utf8',
  ),
) as ConfigCase[]

/**
 * The backend keeps two flat mirrors for older clients. They are not part of
 * `FreestyleFeedConfig`: the frontend must not grow them back, and the
 * backend must not add any other backend-only field unnoticed.
 */
const LEGACY_BACKEND_ONLY_KEYS = ['quiz_order', 'unit_order']

describe('freestyle config contract parity', () => {
  it('has shared cases', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  for (const testCase of cases) {
    it(`matches the backend goldens: ${testCase.name}`, () => {
      const expected = testCase.expected as Record<string, unknown>
      const canonical = Object.fromEntries(
        Object.entries(expected).filter(([key]) => !LEGACY_BACKEND_ONLY_KEYS.includes(key)),
      )
      const sanitized = sanitizeFreestyleFeedConfig(testCase.input) as unknown as Record<string, unknown>

      expect(sanitized).toEqual(canonical)
      expect(
        Object.keys(expected).filter((key) => !(key in sanitized)).sort(),
      ).toEqual(LEGACY_BACKEND_ONLY_KEYS)
    })
  }
})
