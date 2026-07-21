import * as React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { vi } from 'vitest'
import NodeCard from '@/shared/ui/mindmap-canvas/NodeCard'

export function setEditorText(editor: HTMLElement, value: string) {
  // Simulate a pre-input snapshot + contenteditable mutation.
  fireEvent(editor, new InputEvent('beforeinput', { bubbles: true, cancelable: true }))
  editor.textContent = value
  fireEvent.input(editor)
}

export function selectEditorText(editor: HTMLElement, start: number, end: number) {
  editor.focus()
  const text = editor.textContent || ''
  if (!editor.firstChild || editor.firstChild.nodeType !== Node.TEXT_NODE) {
    editor.textContent = text
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

export function renderNodeCard(
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
    ) : (
      nodeCard
    ),
  )
  return { ...view, onFinishEdit }
}

export function getNodeShell() {
  const button = document.querySelector('.mindmap-node-text') as HTMLButtonElement | null
  if (!button) throw new Error('NodeCard text button was not rendered')
  const container = button.parentElement
  const shell = container?.parentElement

  if (!container || !shell) {
    throw new Error('NodeCard shell was not rendered')
  }

  return { container, shell }
}

export function createRect(width: number, height: number): DOMRect {
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
