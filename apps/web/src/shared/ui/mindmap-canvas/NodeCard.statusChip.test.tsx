import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderNodeCard } from '@/shared/ui/mindmap-canvas/nodeCardTestUtils'

describe('NodeCard status chips', () => {
  it('opens the unit summary from a permanent-mark chip without selecting the node', () => {
    const onStatusChipClick = vi.fn()
    const onWrapperClick = vi.fn()
    renderNodeCard(
      {
        label: '已标记单元',
        metadata: {
          depth: 1,
          layoutRole: 'branch',
          visual: { statusChips: [{ text: 'L1', tone: 'warning', style: 'filled' }] },
        },
        onStatusChipClick,
      },
      onWrapperClick,
    )

    fireEvent.click(screen.getByRole('button', { name: 'L1' }))

    expect(onStatusChipClick).toHaveBeenCalledWith('peg-1', 'L1')
    // The chip stops the click: a mark popover must not also select/toggle the card.
    expect(onWrapperClick).not.toHaveBeenCalled()
  })
})
