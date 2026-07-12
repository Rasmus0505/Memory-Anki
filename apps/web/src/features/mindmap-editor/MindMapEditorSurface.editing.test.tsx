import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { MindMapEditorSurface } from './MindMapEditorSurface'

vi.mock('@/shared/ui/mindmap-canvas', async () => {
  const actual = await vi.importActual<typeof import('@/shared/ui/mindmap-canvas')>(
    '@/shared/ui/mindmap-canvas',
  )
  return {
    ...actual,
    MindMapCanvas: (props: Record<string, any>) => (
      <div
        data-testid="editing-canvas"
        onKeyDownCapture={props.onKeyDownCapture}
        data-node-count={props.graphData.nodes.length}
        data-editing-node={props.editingNodeId ?? ''}
        data-can-undo={props.canUndo ? 'yes' : 'no'}
        data-can-redo={props.canRedo ? 'yes' : 'no'}
      >
        {props.graphData.nodes.map((node: { id: string }) => (
          <button
            type="button"
            key={node.id}
            className="mindmap-node-text"
            onClick={() => props.onNodeSelect(node.id)}
          >
            选择 {node.id}
          </button>
        ))}
      </div>
    ),
  }
})

const initialEditorState: MindMapEditorState = {
  editor_doc: {
    root: {
      data: { text: 'Root', uid: 'root' },
      children: [
        {
          data: { text: 'Child', uid: 'child' },
          children: [
            { data: { text: 'Grandchild', uid: 'grandchild' }, children: [] },
          ],
        },
      ],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

function ControlledFrame() {
  const [editorState, setEditorState] = useState(initialEditorState)
  return <MindMapEditorSurface editorState={editorState} onEditorStateChange={setEditorState} />
}

describe('MindMapEditorSurface editing workflow', () => {
  it('uses Enter for editing and Tab for immediate child creation editing', async () => {
    render(<ControlledFrame />)
    const childButton = screen.getByRole('button', { name: '选择 child' })
    fireEvent.click(childButton)

    fireEvent.keyDown(childButton, { key: 'Enter' })
    expect(screen.getByTestId('editing-canvas').getAttribute('data-editing-node')).toBe('child')

    fireEvent.click(screen.getByRole('button', { name: '选择 root' }))
    fireEvent.click(screen.getByRole('button', { name: '选择 child' }))
    fireEvent.keyDown(screen.getByRole('button', { name: '选择 child' }), { key: 'Tab' })

    await waitFor(() => {
      expect(screen.getByTestId('editing-canvas').getAttribute('data-node-count')).toBe('4')
      expect(screen.getByTestId('editing-canvas').getAttribute('data-editing-node')).not.toBe('')
    })
  })

  it('deletes a selected branch immediately and restores it with Ctrl+Z', async () => {
    render(<ControlledFrame />)
    const childButton = screen.getByRole('button', { name: '选择 child' })
    fireEvent.click(childButton)
    fireEvent.keyDown(childButton, { key: 'Delete' })

    await waitFor(() => {
      expect(screen.getByTestId('editing-canvas').getAttribute('data-node-count')).toBe('1')
      expect(screen.getByTestId('editing-canvas').getAttribute('data-can-undo')).toBe('yes')
    })

    fireEvent.keyDown(screen.getByTestId('editing-canvas'), { key: 'z', ctrlKey: true })
    await waitFor(() => {
      expect(screen.getByTestId('editing-canvas').getAttribute('data-node-count')).toBe('3')
      expect(screen.getByTestId('editing-canvas').getAttribute('data-can-redo')).toBe('yes')
    })
  })
})
