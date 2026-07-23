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
        data-selected-node={props.selectedNodeId ?? ''}
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
        <button type="button" onClick={() => props.onAddChild('child')}>新增 child 子级</button>
        {props.editingNodeId ? (
          <button type="button" onClick={() => props.onEdit(props.editingNodeId, '首次命名')}>提交首次命名</button>
        ) : null}
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
  it('uses Enter for editing and keeps focus on the selected card after Tab creates a child', async () => {
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
      expect(screen.getByTestId('editing-canvas').getAttribute('data-editing-node')).toBe('')
      expect(screen.getByTestId('editing-canvas').getAttribute('data-selected-node')).toBe('child')
    })
  })

  it('merges child creation and first naming into one global undo transaction', async () => {
    render(<ControlledFrame />)
    fireEvent.click(screen.getByRole('button', { name: '新增 child 子级' }))

    await waitFor(() => {
      expect(screen.getByTestId('editing-canvas').getAttribute('data-node-count')).toBe('4')
      expect(screen.getByTestId('editing-canvas').getAttribute('data-editing-node')).not.toBe('')
    })
    fireEvent.click(screen.getByRole('button', { name: '提交首次命名' }))
    fireEvent.keyDown(screen.getByTestId('editing-canvas'), { key: 'z', ctrlKey: true })

    await waitFor(() => {
      expect(screen.getByTestId('editing-canvas').getAttribute('data-node-count')).toBe('3')
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

    fireEvent.keyDown(screen.getByTestId('editing-canvas'), { key: 'y', ctrlKey: true })
    await waitFor(() => {
      expect(screen.getByTestId('editing-canvas').getAttribute('data-node-count')).toBe('1')
      expect(screen.getByTestId('editing-canvas').getAttribute('data-can-redo')).toBe('no')
      expect(screen.getByTestId('editing-canvas').getAttribute('data-can-undo')).toBe('yes')
    })
  })
})
