import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { interpolateNumericText, RollingNumber, splitNumericRuns } from './rolling-number'

describe('interpolateNumericText', () => {
  it('splits every numeric run and keeps the text between', () => {
    expect(splitNumericRuns('1小时20分')).toEqual([{ value: 1, decimals: 0 }, '小时', { value: 20, decimals: 0 }, '分'])
  })

  it('rolls each number from the previous value, preserving decimals', () => {
    expect(interpolateNumericText('1小时20分', null, 0)).toBe('0小时0分')
    expect(interpolateNumericText('40.5%', '20.5%', 0.5)).toBe('30.5%')
    expect(interpolateNumericText('3/天', '1/天', 1)).toBe('3/天')
  })
})

describe('RollingNumber', () => {
  it('shows the final value immediately without a compositor (tests, reduced motion)', () => {
    render(<RollingNumber value="12 天" />)
    expect(screen.getByText('12 天')).toBeTruthy()
    expect(screen.getByLabelText('12 天')).toBeTruthy()
  })
})
