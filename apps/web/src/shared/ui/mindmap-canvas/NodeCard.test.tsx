import * as React from 'react'
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NodeCard from '@/shared/ui/mindmap-canvas/NodeCard'

const LONG_PRESS_DELAY_MS = 550

vi.mock('@xyflow/react', () => ({
  Handle: () => <div data-testid="handle" />,
  NodeToolbar: ({
    children,
    isVisible,
  }: {
    children: React.ReactNode
    isVisible?: boolean
  }) => (isVisible ? <div data-testid="node-toolbar">{children}</div> : null),
  Position: {
    Bottom: 'bottom',
    Left: 'left',
    Right: 'right',
    Top: 'top',
  },
  useStore: () => 'top:center',
  useUpdateNodeInternals: () => vi.fn(),
}))

function renderNodeCard(
  overrides?: Record<string, unknown>,
  wrapperOnClick?: () => void,
  wrapperOnContextMenu?: () => void,
) {
  const onFinishEdit = vi.fn()
  const nodeCard = (
    <NodeCard
      id="peg-1"
      draggable
      selected={false}
      dragging={false}
      selectable
      deletable
      zIndex={1}
      isConnectable
      positionAbsoluteX={0}
      positionAbsoluteY={0}
      type="mindmapNode"
      data={{
        id: 'peg-1',
        type: 'peg',
        label: '第一行\n第二行',
        originalId: 1,
        parentId: null,
        metadata: { depth: 0, layoutRole: 'root', branchColor: '#89a89e' },
        onFinishEdit,
        ...overrides,
      }}
    />
  )
  const view = render(
    wrapperOnClick || wrapperOnContextMenu ? (
      <div onClick={wrapperOnClick} onContextMenu={wrapperOnContextMenu}>
        {nodeCard}
      </div>
    ) : nodeCard,
  )
  return { ...view, onFinishEdit }
}

function getNodeShell() {
  const button = document.querySelector('.mindmap-node-text') as HTMLButtonElement | null
  if (!button) throw new Error('NodeCard text button was not rendered')
  const container = button.parentElement
  const shell = container?.parentElement

  if (!container || !shell) {
    throw new Error('NodeCard shell was not rendered')
  }

  return { container, shell }
}

function createRect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect
}

describe('NodeCard', () => {
  it('uses single click for selection and double click for editing', () => {
    renderNodeCard({ label: '可编辑内容' })
    const textButton = screen.getByRole('button', { name: '可编辑内容' })

    fireEvent.click(textButton)
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.doubleClick(textButton)
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('limits node dragging to a dedicated handle and keeps text non-draggable', () => {
    renderNodeCard({ label: '可编辑内容' })

    const dragHandle = screen.getByRole('button', { name: '拖动节点' })
    expect(dragHandle.className).toContain(
      'mindmap-node-drag-handle',
    )
    expect(screen.getByRole('button', { name: '可编辑内容' }).className).toContain('nodrag')
    expect(screen.getByRole('button', { name: '可编辑内容' }).className).toContain('nopan')
    fireEvent.doubleClick(dragHandle)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps the text editor isolated from node dragging while selecting text', () => {
    renderNodeCard({ label: '需要选中的部分文字' })

    fireEvent.doubleClick(screen.getByRole('button', { name: '需要选中的部分文字' }))
    const editor = screen.getByRole('textbox')

    expect(editor.className).toContain('nodrag')
    expect(editor.className).toContain('nopan')
    expect(editor.className).toContain('nowheel')
  })

  it('shows non-destructive structural actions in the selected-node toolbar', () => {
    const onAddChild = vi.fn()
    const onAddSibling = vi.fn()
    const onStartEdit = vi.fn()
    renderNodeCard({
      selected: true,
      parentId: 'root',
      metadata: { depth: 1, layoutRole: 'branch', branchColor: '#2563eb' },
      onAddChild,
      onAddSibling,
      onStartEdit,
    })

    fireEvent.click(screen.getByRole('button', { name: '新增子节点' }))
    fireEvent.click(screen.getByRole('button', { name: '新增同级节点' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑节点' }))

    expect(onAddChild).toHaveBeenCalledWith('peg-1')
    expect(onAddSibling).toHaveBeenCalledWith('peg-1')
    expect(onStartEdit).toHaveBeenCalledWith('peg-1')
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
  })

  it('preserves line breaks in display mode', () => {
    renderNodeCard()
    const button = screen.getByRole('button', { name: /第一行/ })
    expect(button.className).toContain('whitespace-pre-wrap')
  })

  it('renders long Chinese labels as wrapped, non-truncated content', () => {
    const longLabel =
      '路德提出应由国家普及义务教育，实施强迫义务教育。加尔文要求国家开办公立学校，实行免费教育；使所有儿童都有机会受到教育，学习其督教教义和日常生活所必需的知识技能。'
    renderNodeCard({
      label: longLabel,
      metadata: { depth: 1, layoutRole: 'branch', branchColor: '#2563eb' },
    })

    const button = screen.getByRole('button', { name: longLabel })
    expect(button.className).toContain('whitespace-pre-wrap')
    expect(button.className).toContain('break-all')
    expect(button.className).not.toContain('truncate')
  })

  it('reports its measured shell size to the canvas', () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(createRect(152, 96))
    const onMeasure = vi.fn()

    try {
      renderNodeCard({ onMeasure })

      expect(onMeasure).toHaveBeenCalledWith('peg-1', { width: 152, height: 96 })
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('does not report duplicate measurements within the same pixel threshold', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let resizeCallback: ResizeObserverCallback | null = null
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    })
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(createRect(152, 96))
    const onMeasure = vi.fn()

    try {
      renderNodeCard({ onMeasure })

      expect(onMeasure).toHaveBeenCalledTimes(1)
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })
      expect(onMeasure).toHaveBeenCalledTimes(1)

      rectSpy.mockReturnValue(createRect(152, 120))
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })
      expect(onMeasure).toHaveBeenCalledTimes(2)
      expect(onMeasure).toHaveBeenLastCalledWith('peg-1', { width: 152, height: 120 })
    } finally {
      rectSpy.mockRestore()
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      })
    }
  })

  it('commits edits on plain Enter', () => {
    const { onFinishEdit } = renderNodeCard({ label: '原始内容' })

    fireEvent.doubleClick(screen.getByRole('button', { name: '原始内容' }))
    const textarea = screen.getByRole('textbox')

    fireEvent.change(textarea, { target: { value: '更新内容' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onFinishEdit).toHaveBeenCalledWith('peg-1', '更新内容')
  })

  it('keeps the caret position while controlled draft updates propagate', () => {
    const onEditTextChange = vi.fn()
    renderNodeCard({ label: 'abcdef', onEditTextChange })
    fireEvent.doubleClick(screen.getByRole('button', { name: 'abcdef' }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    textarea.setSelectionRange(2, 3)
    fireEvent.change(textarea, {
      target: { value: 'abdef', selectionStart: 2, selectionEnd: 2 },
    })

    expect(textarea.value).toBe('abdef')
    expect(textarea.selectionStart).toBe(2)
    expect(textarea.selectionEnd).toBe(2)
    expect(onEditTextChange).toHaveBeenLastCalledWith('peg-1', 'abdef')
  })

  it('uses local text undo without leaving edit mode', () => {
    renderNodeCard({ label: '原始内容' })
    fireEvent.doubleClick(screen.getByRole('button', { name: '原始内容' }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: '原始内' } })
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true })

    expect(screen.getByRole('textbox')).toBe(textarea)
    expect(textarea.value).toBe('原始内容')
  })

  it('shows a distinct editor without an internal scrollbar', () => {
    renderNodeCard({ label: '编辑视觉' })
    fireEvent.doubleClick(screen.getByRole('button', { name: '编辑视觉' }))
    const textarea = screen.getByRole('textbox')

    expect(textarea.className).toContain('border-blue-500')
    expect(textarea.className).toContain('overflow-hidden')
    expect(textarea.style.scrollbarWidth).toBe('none')
  })

  it('maps readonly double click to the recall cancel handler', () => {
    const onReadonlyDoubleClick = vi.fn()
    renderNodeCard({
      label: '待回忆',
      readonly: true,
      onReadonlyDoubleClick,
    })

    fireEvent.doubleClick(screen.getByRole('button', { name: '待回忆' }))

    expect(onReadonlyDoubleClick).toHaveBeenCalledWith('peg-1')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it.each([
    ['Shift+Enter', { shiftKey: true }],
    ['Ctrl+Enter', { ctrlKey: true }],
  ])('keeps editing on %s so line breaks can be preserved', (_name, modifier) => {
    const { onFinishEdit } = renderNodeCard({ label: '原始内容' })

    fireEvent.doubleClick(screen.getByRole('button', { name: '原始内容' }))
    const textarea = screen.getByRole('textbox')

    fireEvent.change(textarea, { target: { value: '第一行\n第二行' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ...modifier })

    expect(onFinishEdit).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('第一行\n第二行')
  })

  it('keeps Tab inside the textarea while editing instead of creating structure', () => {
    const onEditTextChange = vi.fn()
    const { onFinishEdit } = renderNodeCard({ label: '原始内容', onEditTextChange })

    fireEvent.doubleClick(screen.getByRole('button', { name: '原始内容' }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    textarea.setSelectionRange(2, 2)
    fireEvent.keyDown(textarea, { key: 'Tab' })

    expect(textarea.value).toBe('原始\t内容')
    expect(onEditTextChange).toHaveBeenLastCalledWith('peg-1', '原始\t内容')
    expect(onFinishEdit).not.toHaveBeenCalled()
  })

  it('cancels edits on Escape', () => {
    const { onFinishEdit } = renderNodeCard({ label: '原始内容' })

    fireEvent.doubleClick(screen.getByRole('button', { name: '原始内容' }))
    const textarea = screen.getByRole('textbox')

    fireEvent.change(textarea, { target: { value: '不会保存' } })
    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(onFinishEdit).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: '原始内容' })).toBeTruthy()
  })

  it('uses the unified root card shadow', () => {
    renderNodeCard()

    const { container } = getNodeShell()
    expect(container.className).toContain('shadow-sm')
    expect(container.className).not.toContain('shadow-md')
  })

  it('shows emerald feedback when dropping inside a node', () => {
    renderNodeCard({ dropHighlight: true, dropMode: 'inside' })

    const { container } = getNodeShell()
    expect(container.className).toContain('ring-emerald-400/70')
    expect(container.className).toContain('bg-emerald-50/20')
  })

  it('shows blue feedback when dropping before or after a node', () => {
    renderNodeCard({ dropHighlight: true, dropMode: 'before' })

    const { container } = getNodeShell()
    expect(container.className).toContain('ring-blue-400/60')
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
    expect(container.className).toContain('ring-amber-400/35')
    expect(container.className).toContain('outline-rose-400/55')
    expect(container.className).toContain('outline-sky-400/70')
    expect(container.style.borderColor).toBe('rgb(239, 68, 68)')
  })

  it('reads hidden recall state from metadata', () => {
    renderNodeCard({
      metadata: {
        depth: 1,
        layoutRole: 'branch',
        branchColor: '#89a89e',
        visual: { concealText: true },
      },
    })

    const button = screen.getByRole('button', { name: '待回忆' })
    expect(button.className).toContain('blur-[3px]')
  })

  it('fires a touch long press context action after the delay', async () => {
    vi.useFakeTimers()
    const onTouchLongPress = vi.fn()
    renderNodeCard({
      readonly: true,
      onTouchLongPress,
    })

    const button = screen.getByRole('button', { name: /第一行/ })
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS - 1)
    })
    expect(onTouchLongPress).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(onTouchLongPress).toHaveBeenCalledTimes(1)
    expect(onTouchLongPress.mock.calls[0]?.[0]).toBe('peg-1')
    vi.useRealTimers()
  })

  it('cancels touch long press when the finger lifts early', async () => {
    vi.useFakeTimers()
    const onTouchLongPress = vi.fn()
    renderNodeCard({
      readonly: true,
      onTouchLongPress,
    })

    const button = screen.getByRole('button', { name: /第一行/ })
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })
    fireEvent.pointerUp(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS + 50)
    })
    expect(onTouchLongPress).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('swallows the next click after a touch long press fires', async () => {
    vi.useFakeTimers()
    const onTouchLongPress = vi.fn()
    const wrapperOnClick = vi.fn()
    renderNodeCard(
      {
        readonly: true,
        onTouchLongPress,
      },
      wrapperOnClick,
    )

    const button = screen.getByRole('button', { name: /第一行/ })
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS)
    })

    fireEvent.pointerUp(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })
    fireEvent.click(button)

    expect(onTouchLongPress).toHaveBeenCalledTimes(1)
    expect(wrapperOnClick).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('lets a desktop context menu from the text button bubble to the node wrapper', () => {
    const wrapperOnContextMenu = vi.fn()
    renderNodeCard(
      {
        readonly: true,
        onTouchLongPress: vi.fn(),
      },
      undefined,
      wrapperOnContextMenu,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /第一行/ }))

    expect(wrapperOnContextMenu).toHaveBeenCalledTimes(1)
  })

  it('suppresses only the synthetic context menu emitted after touch long press', async () => {
    vi.useFakeTimers()
    const onTouchLongPress = vi.fn()
    const wrapperOnContextMenu = vi.fn()
    renderNodeCard(
      {
        readonly: true,
        onTouchLongPress,
      },
      undefined,
      wrapperOnContextMenu,
    )

    const button = screen.getByRole('button', { name: /第一行/ })
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS)
    })
    const syntheticTouchContextMenu = createEvent.contextMenu(button)
    Object.defineProperty(syntheticTouchContextMenu, 'sourceCapabilities', {
      value: { firesTouchEvents: true },
    })
    fireEvent(button, syntheticTouchContextMenu)

    expect(onTouchLongPress).toHaveBeenCalledTimes(1)
    expect(wrapperOnContextMenu).not.toHaveBeenCalled()

    const mouseContextMenu = createEvent.contextMenu(button)
    Object.defineProperty(mouseContextMenu, 'pointerType', { value: 'mouse' })
    fireEvent(button, mouseContextMenu)

    expect(wrapperOnContextMenu).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('stops suppressing context menus after the touch synthesis window expires', async () => {
    vi.useFakeTimers()
    const wrapperOnContextMenu = vi.fn()
    renderNodeCard(
      {
        readonly: true,
        onTouchLongPress: vi.fn(),
      },
      undefined,
      wrapperOnContextMenu,
    )

    const button = screen.getByRole('button', { name: /第一行/ })
    fireEvent.pointerDown(button, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 72,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_DELAY_MS + 1_001)
    })
    fireEvent.contextMenu(button)

    expect(wrapperOnContextMenu).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
