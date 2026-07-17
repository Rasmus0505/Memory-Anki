import * as React from 'react'
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NodeCard from '@/shared/ui/mindmap-canvas/NodeCard'

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

function renderNodeCard(overrides?: Record<string, unknown>) {
  return render(
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
        ...overrides,
      }}
    />,
  )
}

function selectEditorText(editor: HTMLElement, start: number, end: number) {
  editor.focus()
  if (!editor.firstChild || editor.firstChild.nodeType !== Node.TEXT_NODE) {
    editor.textContent = editor.textContent || ''
  }
  const textNode = editor.firstChild as Text
  const range = document.createRange()
  range.setStart(textNode, Math.min(start, textNode.length))
  range.setEnd(textNode, Math.min(end, textNode.length))
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  fireEvent.mouseUp(editor)
}

describe('NodeCard extract drag', () => {
  it('shows an extract drag handle when a text range is selected while editing', () => {
    const onExtractSelection = vi.fn()
    renderNodeCard({
      selected: true,
      editing: true,
      editText: '细胞膜与细胞质',
      label: '细胞膜与细胞质',
      onExtractSelection,
    })

    const editor = screen.getByRole('textbox')
    act(() => {
      // Seed plain text into contentEditable for selection APIs.
      editor.textContent = '细胞膜与细胞质'
      selectEditorText(editor, 0, 3)
    })

    expect(screen.getByRole('button', { name: '拖出选中文字为新卡片' })).toBeTruthy()
  })

  it('keeps the editor focused when pressing the extract handle and completes a drag drop', () => {
    const onExtractSelection = vi.fn()
    const onExtractDropPreview = vi.fn()
    const onFinishEdit = vi.fn()
    const target = document.createElement('div')
    target.setAttribute('data-mindmap-node-id', 'target')
    target.style.position = 'fixed'
    target.style.left = '200px'
    target.style.top = '200px'
    target.style.width = '120px'
    target.style.height = '40px'
    target.textContent = '目标'
    target.getBoundingClientRect = () =>
      ({
        x: 200,
        y: 200,
        left: 200,
        top: 200,
        right: 320,
        bottom: 240,
        width: 120,
        height: 40,
        toJSON: () => ({}),
      }) as DOMRect
    document.body.appendChild(target)

    const elementsFromPoint = vi.fn((x: number, y: number) =>
      x >= 200 && y >= 200 ? [target] : [],
    )
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      writable: true,
      value: elementsFromPoint,
    })

    render(
      <div>
        <NodeCard
          id="source"
          draggable
          selected
          dragging={false}
          selectable
          deletable
          zIndex={1}
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          type="mindmapNode"
          data={{
            id: 'source',
            type: 'peg',
            label: '细胞膜与细胞质',
            originalId: 1,
            parentId: 'root',
            metadata: { depth: 1, layoutRole: 'branch', branchColor: '#2563eb' },
            selected: true,
            editing: true,
            editText: '细胞膜与细胞质',
            onFinishEdit,
            onExtractSelection,
            onExtractDropPreview,
          }}
        />
      </div>,
    )

    const editor = screen.getByRole('textbox')
    act(() => {
      editor.textContent = '细胞膜与细胞质'
      selectEditorText(editor, 0, 3)
    })

    const handle = screen.getByRole('button', { name: '拖出选中文字为新卡片' })
    const mouseDown = createEvent.mouseDown(handle)
    fireEvent(handle, mouseDown)
    expect(mouseDown.defaultPrevented).toBe(true)
    expect(onFinishEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toBeTruthy()

    const dispatchDocPointer = (type: 'pointermove' | 'pointerup', clientX: number, clientY: number) => {
      const native = new Event(type, { bubbles: true, cancelable: true }) as Event & {
        pointerId?: number
        clientX?: number
        clientY?: number
      }
      Object.defineProperties(native, {
        pointerId: { value: 1 },
        clientX: { value: clientX },
        clientY: { value: clientY },
      })
      act(() => {
        document.dispatchEvent(native)
      })
    }

    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 10, buttons: 1 })
    })
    expect(document.querySelector('[data-extract-ghost="true"]')).toBeTruthy()

    dispatchDocPointer('pointermove', 40, 40)
    dispatchDocPointer('pointermove', 220, 220)

    expect(onExtractDropPreview).toHaveBeenCalled()

    dispatchDocPointer('pointerup', 220, 220)

    expect(onExtractSelection).toHaveBeenCalledWith({
      sourceId: 'source',
      liveText: '细胞膜与细胞质',
      start: 0,
      end: 3,
      placement: { mode: expect.stringMatching(/before|inside|after/), targetUid: 'target' },
    })
    expect(onFinishEdit).not.toHaveBeenCalled()
    delete (document as any).elementsFromPoint
    target.remove()
  })

  it('renders insert placeholders for extract drop modes', () => {
    renderNodeCard({
      selected: false,
      dropHighlight: true,
      dropMode: 'before',
      label: '目标节点',
    })
    expect(document.querySelector('[data-extract-placeholder="before"]')).toBeTruthy()

    const { unmount } = renderNodeCard({
      selected: false,
      dropHighlight: true,
      dropMode: 'inside',
      label: '目标节点内',
    })
    expect(document.querySelector('[data-extract-placeholder="inside"]')).toBeTruthy()
    unmount()
  })
})
