import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getNodeShell, renderNodeCard } from '@/shared/ui/mindmap-canvas/nodeCardTestUtils'

describe('NodeCard visual states', () => {
  it('uses the unified root card shadow', () => {
    renderNodeCard()

    const { container } = getNodeShell()
    expect(container.className).toContain('mindmap-node-card--root')
    expect(container.className).not.toContain('shadow-md')
  })

  it('shows emerald feedback and child-slot placeholder when dropping inside a node', () => {
    renderNodeCard({ dropHighlight: true, dropMode: 'inside' })
    expect(document.querySelector('[data-drop-placeholder="inside"]')).toBeTruthy()
    expect(document.querySelector('[data-drop-placeholder-label="inside"]')?.textContent).toContain(
      '成为子卡片',
    )

    const { container } = getNodeShell()
    expect(container.className).toContain('ring-success/70')
    expect(container.className).toContain('bg-success/10')
  })

  it('shows blue feedback when dropping before or after a node', () => {
    renderNodeCard({ dropHighlight: true, dropMode: 'before' })

    const { container } = getNodeShell()
    expect(container.className).toContain('ring-primary/70')
  })

  it('makes dragged nodes ghosted even when the node is also muted', () => {
    renderNodeCard({ previewGhost: true, metadata: { depth: 1, layoutRole: 'branch', visual: { muted: true } } })

    const { shell } = getNodeShell()
    expect(shell.className).toContain('opacity-35')
    expect(shell.className).toContain('scale-[0.97]')
    expect(shell.className).not.toContain('opacity-60')
  })

  it('keeps non-dragged muted nodes at the lighter dim state', () => {
    renderNodeCard({ metadata: { depth: 1, layoutRole: 'branch', visual: { muted: true } } })

    const { shell } = getNodeShell()
    expect(shell.className).toContain('opacity-60')
  })

  it('uses a stronger preview shift while dragging', () => {
    renderNodeCard({ previewShifted: true })

    const { shell } = getNodeShell()
    expect(shell.className).toContain('translate-y-2')
  })

  it('reads recall and marker states from metadata when top-level fields are absent', () => {
    renderNodeCard({
      metadata: {
        depth: 1,
        layoutRole: 'branch',
        branchColor: '#89a89e',
        visual: {
          placeholder: true,
          borderColor: '#ef4444',
          outlineTones: ['danger', 'info'],
        },
      },
    })

    const { container } = getNodeShell()
    expect(container.className).toContain('ring-primary/35')
    expect(container.className).toContain('outline-destructive/55')
    expect(container.className).toContain('outline-rate-easy/70')
    expect(container.style.borderColor).toBe('rgb(239, 68, 68)')
  })

  it('reads hidden recall state from metadata', () => {
    renderNodeCard({
      label: '线粒体内膜',
      metadata: {
        depth: 1,
        layoutRole: 'branch',
        branchColor: '#89a89e',
        visual: { concealText: true },
      },
    })

    const button = screen.getByRole('button', { name: '待回忆' })
    // The real label stays laid out (invisible) so revealing never resizes the card.
    const sizer = button.querySelector('.mindmap-node-concealed-sizer') as HTMLElement
    expect(sizer.textContent).toBe('线粒体内膜')
    expect(sizer.getAttribute('aria-hidden')).toBe('true')
  })

})
