import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { BilinkPreviewPopover } from './BilinkPreviewPopover'

const mindMapFrameMock = vi.fn()

vi.mock('@/shared/components/mindmap-host', () => ({
  MindMapFrame: (props: Record<string, unknown>) => {
    mindMapFrameMock(props)
    return <div data-testid="mind-map-frame" />
  },
}))

function buildEditorState(): MindMapEditorState {
  return {
    editor_doc: {
      root: {
        data: {
          text: '<div>Alpha <strong>Target</strong><br>target</div>',
          uid: 'root-1',
          richText: true,
        },
        children: [],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

describe('BilinkPreviewPopover', () => {
  beforeEach(() => {
    mindMapFrameMock.mockClear()
  })

  it('sanitizes sidebar text and passes a highlighted preview doc for search previews', () => {
    const editorState = buildEditorState()

    render(
      <BilinkPreviewPopover
        open
        loading={false}
        error=""
        context={{
          palace_id: 2,
          palace_title: '<div>宫殿&nbsp;标题</div>',
          node_uid: 'node-1',
          node_text: '<div>当前&nbsp;节点</div>',
          node_note: '<p>备注<br>第二行</p>',
          node_path: ['<div>祖先</div>', '<div>当前&nbsp;节点</div>'],
          parent_text: '<div>父&nbsp;节点</div>',
          children: [{ uid: 'child-1', text: '<div>子&nbsp;节点</div>' }],
          siblings: [{ uid: 'sibling-1', text: '<div>同级&nbsp;节点</div>' }],
        }}
        editorState={editorState}
        highlightQuery="target"
        onClose={vi.fn()}
        onJump={vi.fn()}
      />,
    )

    expect(screen.getByText('宫殿 标题')).toBeTruthy()
    expect(screen.getByText('当前 节点')).toBeTruthy()
    expect(screen.getByText('祖先 / 当前 节点')).toBeTruthy()
    expect(screen.getByText(/备注/)).toBeTruthy()
    expect(screen.getByText(/第二行/)).toBeTruthy()
    expect(screen.getByText(/父节点：父 节点/)).toBeTruthy()
    expect(screen.getByText('子 节点')).toBeTruthy()
    expect(screen.getByText('同级 节点')).toBeTruthy()
    expect(screen.queryByText(/<div>|<p>/)).toBeNull()

    const latestProps = mindMapFrameMock.mock.calls.at(-1)?.[0] as {
      editorState: MindMapEditorState
    }
    const rootText =
      ((latestProps.editorState.editor_doc as { root?: { data?: { text?: string } } })?.root?.data?.text ??
        '')

    expect(latestProps.editorState).not.toBe(editorState)
    expect(rootText).toContain('color:#dc2626;font-weight:700;')
    expect(rootText).toContain('<strong><span style="color:#dc2626;font-weight:700;">Target</span></strong>')
  })

  it('reuses the original editor state when preview highlighting is disabled', () => {
    const editorState = buildEditorState()

    render(
      <BilinkPreviewPopover
        open
        loading={false}
        error=""
        context={{
          palace_id: 2,
          palace_title: '宫殿标题',
          node_uid: null,
          node_text: '节点',
          node_note: '',
          node_path: [],
          parent_text: null,
          children: [],
          siblings: [],
        }}
        editorState={editorState}
        highlightQuery={null}
        onClose={vi.fn()}
        onJump={vi.fn()}
      />,
    )

    const latestProps = mindMapFrameMock.mock.calls.at(-1)?.[0] as {
      editorState: MindMapEditorState
    }

    expect(latestProps.editorState).toBe(editorState)
  })
})
