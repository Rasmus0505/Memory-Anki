import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RevealState } from '@/modules/memory/public'
import { useFreestyleEnterRevealFollow } from './useFreestyleEnterRevealFollow'

function Harness({ active }: { active: boolean }) {
  useFreestyleEnterRevealFollow({
    active,
    isEditMode: false,
    palaceTitle: '测试宫殿',
    unitTitle: '当前单元',
    anchorUid: 'unit-node',
    revealApiRef: {
      current: {
        revealMap: {} as Record<string, RevealState>,
        applyTargetRevealFrom: vi.fn(() => null),
      },
    },
  })
  return null
}

describe('useFreestyleEnterRevealFollow', () => {
  it('releases a unit-switch control focus when a card takes over', () => {
    const view = render(<Harness active={false} />)
    const pagerButton = document.createElement('button')
    pagerButton.type = 'button'
    document.body.appendChild(pagerButton)
    try {
      pagerButton.focus()
      expect(document.activeElement).toBe(pagerButton)

      view.rerender(<Harness active />)

      expect(document.activeElement).not.toBe(pagerButton)
    } finally {
      pagerButton.remove()
    }
  })
})
