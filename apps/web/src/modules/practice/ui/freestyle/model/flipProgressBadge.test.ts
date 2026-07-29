import { describe, expect, it } from 'vitest'
import {
  flipProgressLabel,
  flipProgressTitle,
  flipProgressTone,
  normalizeFlipProgress,
} from './flipProgressBadge'

describe('flipProgressBadge', () => {
  it('normalizes and clamps revealed to total', () => {
    expect(normalizeFlipProgress(-2, 14)).toEqual({ revealed: 0, total: 14 })
    expect(normalizeFlipProgress(20, 14)).toEqual({ revealed: 14, total: 14 })
    expect(normalizeFlipProgress(2.7, 14.2)).toEqual({ revealed: 3, total: 14 })
  })

  it('maps empty / partial / complete tones', () => {
    expect(flipProgressTone(0, 14)).toBe('empty')
    expect(flipProgressTone(2, 14)).toBe('partial')
    expect(flipProgressTone(14, 14)).toBe('complete')
    expect(flipProgressTone(0, 0)).toBe('complete')
  })

  it('formats label and title', () => {
    expect(flipProgressLabel(2, 14)).toBe('2/14')
    expect(flipProgressTitle(0, 14)).toContain('尚未翻卡')
    expect(flipProgressTitle(2, 14)).toContain('已翻 2')
    expect(flipProgressTitle(14, 14)).toContain('翻卡完成')
  })
})
