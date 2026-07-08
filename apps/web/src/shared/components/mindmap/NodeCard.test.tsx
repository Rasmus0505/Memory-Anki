import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NodeCard from '@/shared/components/mindmap/NodeCard'

vi.mock('@xyflow/react', () => ({
  Handle: () => <div data-testid="handle" />,
  Position: {
    Left: 'left',
    Right: 'right',
  },
}))

function renderNodeCard(overrides?: Record<string, unknown>) {
  const onFinishEdit = vi.fn()
  const view = render(
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
    />,
  )
  return { ...view, onFinishEdit }
}

function getNodeShell() {
  const button = screen.getByRole('button')
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
    expect(button.className).toContain('break-words')
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

    fireEvent.click(screen.getByRole('button', { name: '原始内容' }))
    const textarea = screen.getByRole('textbox')

    fireEvent.change(textarea, { target: { value: '更新内容' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onFinishEdit).toHaveBeenCalledWith('peg-1', '更新内容')
  })

  it.each([
    ['Shift+Enter', { shiftKey: true }],
    ['Ctrl+Enter', { ctrlKey: true }],
  ])('keeps editing on %s so line breaks can be preserved', (_name, modifier) => {
    const { onFinishEdit } = renderNodeCard({ label: '原始内容' })

    fireEvent.click(screen.getByRole('button', { name: '原始内容' }))
    const textarea = screen.getByRole('textbox')

    fireEvent.change(textarea, { target: { value: '第一行\n第二行' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ...modifier })

    expect(onFinishEdit).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('第一行\n第二行')
  })

  it('cancels edits on Escape', () => {
    const { onFinishEdit } = renderNodeCard({ label: '原始内容' })

    fireEvent.click(screen.getByRole('button', { name: '原始内容' }))
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
    renderNodeCard({ previewGhost: true, muted: true })

    const { shell } = getNodeShell()
    expect(shell.className).toContain('opacity-35')
    expect(shell.className).toContain('scale-[0.97]')
    expect(shell.className).not.toContain('opacity-60')
  })

  it('keeps non-dragged muted nodes at the lighter dim state', () => {
    renderNodeCard({ muted: true })

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
        revealState: 'placeholder',
        segmentColor: '#ef4444',
        focusMarked: true,
        miniPalaceSelected: true,
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
        revealState: 'hidden',
      },
    })

    const button = screen.getByRole('button', { name: '待回忆' })
    expect(button.className).toContain('blur-[3px]')
  })
})
