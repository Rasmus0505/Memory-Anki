import { describe, expect, it } from 'vitest'
import { fitPageSize } from './useFitPageSize'

describe('fitPageSize', () => {
  it('uses the fallback before the container has a measured height', () => {
    expect(fitPageSize(0, 58, 8, 4)).toBe(4)
  })

  it('fits as many rows as the height allows, counting gaps only between rows', () => {
    expect(fitPageSize(58, 58, 8, 4)).toBe(1)
    expect(fitPageSize(124, 58, 8, 4)).toBe(2)
    expect(fitPageSize(123, 58, 8, 4)).toBe(1)
    expect(fitPageSize(400, 58, 8, 4)).toBe(6)
  })

  it('always shows at least one row', () => {
    expect(fitPageSize(10, 58, 8, 4)).toBe(1)
  })
})
