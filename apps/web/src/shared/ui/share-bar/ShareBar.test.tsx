import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ShareBar, shareRatio } from './ShareBar'

describe('shareRatio', () => {
  it('divides the part by the whole', () => {
    expect(shareRatio(3, 20)).toBeCloseTo(0.15)
  })

  it('reads an unknown or empty whole as zero', () => {
    expect(shareRatio(3, null)).toBe(0)
    expect(shareRatio(3, 0)).toBe(0)
    expect(shareRatio(null, 20)).toBe(0)
  })

  it('clamps a part larger than its whole', () => {
    expect(shareRatio(25, 20)).toBe(1)
  })
})

describe('ShareBar', () => {
  it('exposes a labelled meter with the rounded percent', () => {
    render(<ShareBar ratio={0.15} label="章节题目占比 3/20" />)
    const meter = screen.getByRole('meter', { name: '章节题目占比 3/20' })
    expect(meter.getAttribute('aria-valuenow')).toBe('15')
  })

  it('stays decorative when no label is given', () => {
    const { container } = render(<ShareBar ratio={0.5} />)
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('meter')).toBeNull()
  })
})
