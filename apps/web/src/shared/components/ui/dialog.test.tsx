import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { resetWindowLayoutMemoryForTest } from '@/shared/preferences/windowLayoutMemory'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
}

describe('Dialog', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    resetWindowLayoutMemoryForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetClientPreferenceCacheForTest()
    resetWindowLayoutMemoryForTest()
    setViewport(1024, 768)
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

  it('restores a remembered floating width ratio after the viewport shrinks', () => {
    setViewport(1200, 800)
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent floatingId="ratio-test">
          <DialogHeader>
            <div>
              <DialogTitle>ratio dialog</DialogTitle>
              <DialogDescription>description</DialogDescription>
            </div>
          </DialogHeader>
          dialog body
        </DialogContent>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog')
    const wideWidth = dialog.style.width
    const stored = () => JSON.parse(window.localStorage.getItem('memory-anki-floating-dialog:ratio-test') || '{}')
    const ratio = stored().widthRatio
    expect(typeof ratio).toBe('number')
    expect(ratio).toBeGreaterThan(0)

    act(() => {
      setViewport(640, 480)
      window.dispatchEvent(new Event('resize'))
    })

    expect(stored().widthRatio).toBe(ratio)
    expect(dialog.style.width).not.toBe(wideWidth)

    act(() => {
      setViewport(1200, 800)
      window.dispatchEvent(new Event('resize'))
    })

    expect(dialog.style.width).toBe(wideWidth)
    expect(stored().widthRatio).toBe(ratio)
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

  it('centers compact max-w-md dialogs using the inferred width', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    })

    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent className="max-w-md" floatingId="compact-center-test">
          <DialogHeader>
            <div>
              <DialogTitle>compact dialog</DialogTitle>
              <DialogDescription>description</DialogDescription>
            </div>
          </DialogHeader>
          dialog body
        </DialogContent>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.style.width).toBe('448px')
    expect(dialog.style.left).toBe('476px')
  })

  it('keeps a viewport-relative dialog centered instead of stranding it at a remembered position', () => {
    setViewport(1825, 982)

    // Seed a remembered off-center position the way a real user drag would: a wide
    // panel clamped to the floating cap leaves this pixel position far from center
    // on the next open. (Uses mindmap-import's class as a wide-panel stand-in — the
    // real 随心配置 panel is covered by the deferral-rule tests in
    // dialogFloatingLayout.test.ts.)
    window.localStorage.setItem(
      'memory-anki-floating-dialog:mindmap-import',
      JSON.stringify({ x: 40, y: 620, width: 1600, height: 600, collapsed: false, pinned: false }),
    )

    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent
          floatingId="mindmap-import"
          className="h-[min(92vh,980px)] max-w-[min(92vw,1440px)] rounded-lg border bg-card/98 p-0 shadow-floating"
        >
          <DialogHeader>
            <div>
              <DialogTitle>wide dialog</DialogTitle>
              <DialogDescription>description</DialogDescription>
            </div>
          </DialogHeader>
          dialog body
        </DialogContent>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog')
    // Falls back to the centered layout: no absolute placement at all, so the
    // remembered x/y cannot strand it off-center.
    expect(dialog.style.left).toBe('')
    expect(dialog.style.top).toBe('')
    expect(dialog.className).not.toContain('shadow-popover')
    // ...and no inline width either, so the class's declared width wins instead of
    // being clamped down to the floating panel's cap.
    expect(dialog.style.width).toBe('')
    expect(dialog.className).toContain('max-w-[min(92vw,1440px)]')

    const centerWrapper = document.querySelector('[data-floating-dialog-root]')?.parentElement
      ?? Array.from(document.querySelectorAll('div')).find(
        (element) =>
          element.className.includes('items-center') && element.className.includes('justify-center'),
      )
    expect(centerWrapper?.className).toContain('items-center')
    expect(centerWrapper?.className).toContain('justify-center')
  })

  it('centers from layout height so the entrance zoom does not push the panel down', () => {
    setViewport(1200, 900)
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    // The open animation (zoom-in-95) reports a shrunken box; layout metrics must win.
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 480, bottom: 285, width: 480, height: 285,
      toJSON: () => ({}),
    } as DOMRect)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 })
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 480 })

    try {
      render(
        <Dialog open onOpenChange={vi.fn()}>
          <DialogContent floatingId="vertical-center-test">
            <DialogHeader>
              <div>
                <DialogTitle>vertical dialog</DialogTitle>
                <DialogDescription>description</DialogDescription>
              </div>
            </DialogHeader>
            dialog body
          </DialogContent>
        </Dialog>,
      )

      const dialog = screen.getByRole('dialog')
      // (900 - 300) / 2, not the (900 - 285) / 2 the zoomed rect would produce.
      expect(dialog.style.top).toBe('300px')
    } finally {
      rectSpy.mockRestore()
      if (heightDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDescriptor)
      if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDescriptor)
    }
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
