import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'

describe('Dialog', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1024,
    })
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

  it('keeps a non-modal workbench open during outside interaction when dismissal is disabled', () => {
    const onOpenChange = vi.fn()

    render(
      <>
        <button type={'button'}>outside control</button>
        <Dialog open onOpenChange={onOpenChange} modal={false}>
          <DialogContent floating={false} dismissOnInteractOutside={false}>
            <DialogTitle>persistent workbench</DialogTitle>
            workbench body
          </DialogContent>
        </Dialog>
      </>,
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside control' }))
    fireEvent.focus(screen.getByRole('button', { name: 'outside control' }))

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole('dialog', { name: 'persistent workbench' })).toBeTruthy()
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

  it('keeps header controls clickable while blank header space remains draggable', () => {
    const onAction = vi.fn()

    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent floatingId="header-drag-test">
          <DialogHeader>
            <div>
              <DialogTitle>header drag dialog</DialogTitle>
              <button type="button" onClick={onAction}>toolbar action</button>
            </div>
          </DialogHeader>
          dialog body
        </DialogContent>
      </Dialog>,
    )

    const action = screen.getByRole('button', { name: 'toolbar action' })
    fireEvent.pointerDown(action, { clientX: 100, clientY: 100 })
    fireEvent.click(action)
    fireEvent.pointerMove(window, { clientX: 180, clientY: 160 })
    fireEvent.pointerUp(window)

    expect(onAction).toHaveBeenCalledTimes(1)
    // Open always persists a centered layout; control clicks must not drag.
    const beforeDrag = JSON.parse(
      window.localStorage.getItem('memory-anki-floating-dialog:header-drag-test') || '{}',
    )
    expect(typeof beforeDrag.x).toBe('number')

    const header = screen.getByText('header drag dialog').closest('div.cursor-move')
    expect(header).toBeTruthy()
    fireEvent(
      header as HTMLElement,
      new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }),
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 180, clientY: 160 }),
    )
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))

    const stored = JSON.parse(
      window.localStorage.getItem('memory-anki-floating-dialog:header-drag-test') || '{}',
    )
    expect(stored.x).not.toBe(beforeDrag.x)
    expect(stored.x).toBeGreaterThan(16)
    expect(stored.y).toBeGreaterThan(16)
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

  it('provides a hidden title fallback and suppresses optional description warnings', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent accessibleTitle="fallback dialog">
          dialog body
        </DialogContent>
      </Dialog>,
    )

    await new Promise((resolve) => window.setTimeout(resolve, 0))

    expect(screen.getByRole('dialog', { name: 'fallback dialog' })).toBeTruthy()
    expect(errorSpy.mock.calls.flat().join('\n')).not.toContain('DialogContent requires a DialogTitle')
    expect(warnSpy.mock.calls.flat().join('\n')).not.toContain('Missing `Description`')
  })

  it('can provide a hidden description when content has no visible DialogDescription', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent
          accessibleTitle="command dialog"
          accessibleDescription="Search operations and pages."
        >
          dialog body
        </DialogContent>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog', { name: 'command dialog' })
    const descriptionId = dialog.getAttribute('aria-describedby')

    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId ?? '')?.textContent).toBe('Search operations and pages.')
  })

  it('disables floating controls on small coarse pointer viewports', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 390,
    })
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query === '(pointer: coarse)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    )

    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <div>
              <DialogTitle>mobile dialog</DialogTitle>
              <DialogDescription>description</DialogDescription>
            </div>
          </DialogHeader>
          dialog body
        </DialogContent>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog')

    expect(dialog.className).not.toContain('touch-none')
    expect(screen.queryByLabelText('缩小为胶囊')).toBeNull()
    expect(screen.queryByLabelText('置顶弹窗')).toBeNull()
  })

})
