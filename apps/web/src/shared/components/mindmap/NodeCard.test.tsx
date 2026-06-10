import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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
  render(
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
  return { onFinishEdit }
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

  it('lets Enter and Ctrl+Enter insert newline, and commits on blur', () => {
    const { onFinishEdit } = renderNodeCard({ label: '原始内容' })

    fireEvent.click(screen.getByRole('button', { name: '原始内容' }))
    const textarea = screen.getByRole('textbox')

    fireEvent.change(textarea, { target: { value: '第一行\n第二行' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onFinishEdit).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(onFinishEdit).not.toHaveBeenCalled()

    fireEvent.blur(textarea)
    expect(onFinishEdit).toHaveBeenCalledWith('peg-1', '第一行\n第二行')
  })
})
