import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'

describe('Dialog', () => {
  it('renders above immersive fullscreen shells', () => {
    render(
      <>
        <div className="fixed inset-0 z-[90]">immersive-shell</div>
        <Dialog open onOpenChange={vi.fn()}>
          <DialogContent showCloseButton>
            <DialogHeader>
              <div>
                <DialogTitle>test dialog</DialogTitle>
                <DialogDescription>description</DialogDescription>
              </div>
            </DialogHeader>
            dialog body
          </DialogContent>
        </Dialog>
      </>,
    )

    const overlay = Array.from(document.querySelectorAll('[data-state="open"]')).find((element) =>
      element.className.includes('z-[240]'),
    )
    const centeredLayer = Array.from(document.querySelectorAll('div')).find((element) =>
      element.className.includes('z-[241]') && element.className.includes('pointer-events-none'),
    )

    expect(overlay).not.toBeNull()
    expect(overlay?.className).toContain('z-[240]')
    expect(centeredLayer).not.toBeUndefined()
  })

  it('closes when clicking the close button', () => {
    const onOpenChange = vi.fn()

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <div>
              <DialogTitle>test dialog</DialogTitle>
              <DialogDescription>description</DialogDescription>
            </div>
          </DialogHeader>
          dialog body
        </DialogContent>
      </Dialog>,
    )

    fireEvent.click(screen.getByLabelText('关闭弹窗'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('supports unstyled non-modal floating panels without overlay', () => {
    render(
      <Dialog open onOpenChange={vi.fn()} modal={false}>
        <DialogContent layout="unstyled" className="fixed left-[120px] top-[80px] w-40">
          <DialogTitle>floating title</DialogTitle>
          <DialogDescription>floating description</DialogDescription>
          floating
        </DialogContent>
      </Dialog>,
    )

    expect(screen.getByText('floating').className).toContain('fixed')
    const overlay = Array.from(document.querySelectorAll('[data-state="open"]')).find((element) =>
      element.className.includes('z-[240]'),
    )
    expect(overlay).toBeUndefined()
    expect(screen.getByText('floating').className).toContain('z-[241]')
  })
})
