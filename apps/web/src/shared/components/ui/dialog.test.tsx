import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'

describe('Dialog', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

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
    const dialog = screen.getByRole('dialog')

    expect(overlay).not.toBeNull()
    expect(overlay?.className).toContain('z-[240]')
    expect(dialog.className).toContain('fixed')
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
    expect(screen.getByText('floating').className).not.toContain('relative')
    const overlay = Array.from(document.querySelectorAll('[data-state="open"]')).find((element) =>
      element.className.includes('z-[240]'),
    )
    expect(overlay).toBeUndefined()
    expect(screen.getByText('floating').className).toContain('z-[241]')
  })

  it('collapses a floating dialog into a draggable capsule and restores it', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent>
          <DialogHeader>
            <div>
              <DialogTitle>capsule dialog</DialogTitle>
              <DialogDescription>description</DialogDescription>
            </div>
          </DialogHeader>
          dialog body
        </DialogContent>
      </Dialog>,
    )

    fireEvent.click(screen.getByLabelText('缩小为胶囊'))

    expect(screen.queryByText('dialog body')).toBeNull()
    const restoreButton = screen.getByRole('button', { name: '恢复capsule dialog' })
    expect(restoreButton).toBeTruthy()

    fireEvent.click(restoreButton)

    expect(screen.getByText('dialog body')).toBeTruthy()
  })

  it('keeps the collapsed floating dialog capsule draggable from the capsule button itself', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent floatingId="drag-test">
          <DialogHeader>
            <div>
              <DialogTitle>draggable capsule</DialogTitle>
              <DialogDescription>description</DialogDescription>
            </div>
          </DialogHeader>
          dialog body
        </DialogContent>
      </Dialog>,
    )

    fireEvent.click(screen.getByLabelText('缩小为胶囊'))
    const restoreButton = screen.getByRole('button', { name: '恢复draggable capsule' })
    act(() => {
      restoreButton.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }),
      )
      window.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 160, clientY: 145 }),
      )
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })

    const stored = JSON.parse(window.localStorage.getItem('memory-anki-floating-dialog:drag-test') || '{}')
    expect(stored.x).toBeGreaterThan(16)
    expect(stored.y).toBeGreaterThan(16)
    expect(stored.collapsed).toBe(true)
  })

  it('prevents outside dismissal while pinned', () => {
    const onOpenChange = vi.fn()

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <div>
              <DialogTitle>pinned dialog</DialogTitle>
              <DialogDescription>description</DialogDescription>
            </div>
          </DialogHeader>
          dialog body
        </DialogContent>
      </Dialog>,
    )

    fireEvent.click(screen.getByLabelText('置顶弹窗'))
    fireEvent.pointerDown(document.body)

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

})
