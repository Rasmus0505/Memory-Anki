import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent } from '@/shared/components/ui/dialog'

describe('Dialog', () => {
  it('renders above immersive fullscreen shells', () => {
    render(
      <>
        <div className="fixed inset-0 z-[90]">immersive-shell</div>
        <Dialog open onOpenChange={vi.fn()}>
          <DialogContent>dialog body</DialogContent>
        </Dialog>
      </>,
    )

    const portalRoot = screen.getByLabelText('关闭弹窗').parentElement

    expect(portalRoot).not.toBeNull()
    expect(portalRoot?.className).toContain('z-[140]')
  })

  it('closes when clicking the overlay', () => {
    const onOpenChange = vi.fn()

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>dialog body</DialogContent>
      </Dialog>,
    )

    fireEvent.click(screen.getByLabelText('关闭弹窗'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
