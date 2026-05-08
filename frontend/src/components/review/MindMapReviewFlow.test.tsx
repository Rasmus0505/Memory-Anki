import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MindMapReviewFlow } from '@/components/review/MindMapReviewFlow'

const capturedEditorStates: Array<Record<string, unknown>> = []
let latestMindMapFrameProps: Record<string, unknown> | null = null

vi.mock('@/components/mindmap-host', () => ({
  MindMapFrame: (props: Record<string, unknown>) => {
    latestMindMapFrameProps = props
    const editorState = props.editorState as Record<string, unknown>
    capturedEditorStates.push(editorState)
    return null
  },
}))

vi.mock('@/components/session/SessionTimerBar', () => ({
  SessionTimerBar: () => null,
}))

const baseEditorState = {
  editor_doc: {
    root: {
      data: { text: 'Root', uid: 'root' },
      children: [
        { data: { text: 'A', uid: 'a' }, children: [] },
      ],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

describe('MindMapReviewFlow', () => {
  it('clears leftover content fields for placeholder nodes', async () => {
    capturedEditorStates.length = 0
    latestMindMapFrameProps = null
    render(
      <MindMapReviewFlow
        title="Test"
        palaceId={1}
        sessionKind="practice"
        editorState={{
          ...baseEditorState,
          editor_doc: {
            root: {
              data: { text: 'Root', uid: 'root' },
              children: [
                {
                  data: {
                    text: 'Original',
                    note: 'Old note',
                    uid: 'a',
                    textWidth: 220,
                    noteWidth: 180,
                    hyperlink: 'https://example.com',
                  },
                  children: [],
                },
              ],
            },
          },
        }}
        initialSnapshot={{
          revealMap: { root: 'revealed', a: 'placeholder' },
          redNodeIds: [],
          completed: false,
        }}
        onComplete={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(capturedEditorStates.length).toBeGreaterThan(0)
    })

    const lastState = capturedEditorStates.at(-1) as {
      editor_doc: {
        root: {
          children: Array<{ data: Record<string, unknown> }>
        }
      }
    }
    const placeholderData = lastState.editor_doc.root.children[0].data

    expect(placeholderData.text).toBe('待回忆')
    expect(placeholderData.customTextWidth).toBe(132)
    expect(placeholderData.hideNote).toBe(true)
    expect(placeholderData.note).toBeUndefined()
    expect(placeholderData.richText).toBeUndefined()
    expect(placeholderData.textWidth).toBeUndefined()
    expect(placeholderData.noteWidth).toBeUndefined()
    expect(placeholderData.hyperlink).toBeUndefined()
  })

  it('does not auto-complete review just because edit changed the tree', async () => {
    capturedEditorStates.length = 0
    latestMindMapFrameProps = null
    const onComplete = vi.fn()
    const { rerender } = render(
      <MindMapReviewFlow
        title="Test"
        palaceId={1}
        sessionKind="review"
        editorState={baseEditorState}
        initialSnapshot={{
          revealMap: { root: 'revealed', a: 'revealed' },
          redNodeIds: [],
          completed: false,
        }}
        onComplete={onComplete}
      />,
    )

    await act(async () => {
      rerender(
        <MindMapReviewFlow
          title="Test"
          palaceId={1}
          sessionKind="review"
          editorState={{
            ...baseEditorState,
            editor_doc: {
              root: {
                data: { text: 'Root', uid: 'root' },
                children: [
                  { data: { text: 'A', uid: 'a' }, children: [] },
                  { data: { text: 'B', uid: 'b' }, children: [] },
                ],
              },
            },
          }}
          initialSnapshot={{
            revealMap: { root: 'revealed', a: 'revealed' },
            redNodeIds: [],
            completed: false,
          }}
          onComplete={onComplete}
        />,
      )
    })

    await waitFor(() => {
      expect(onComplete).not.toHaveBeenCalled()
    })
  })

  it('keeps revealed nodes showing their original text and removes edit mode button', async () => {
    capturedEditorStates.length = 0
    latestMindMapFrameProps = null

    render(
      <MindMapReviewFlow
        title="Test"
        palaceId={1}
        sessionKind="practice"
        editorState={{
          ...baseEditorState,
          editor_doc: {
            root: {
              data: { text: 'Root', uid: 'root' },
              children: [
                { data: { text: 'A', uid: 'a' }, children: [] },
                { data: { text: 'B', uid: 'b' }, children: [] },
              ],
            },
          },
        }}
        initialSnapshot={{
          revealMap: { root: 'revealed', a: 'revealed', b: 'hidden' },
          redNodeIds: [],
          completed: false,
        }}
        onComplete={vi.fn()}
      />,
    )

    await act(async () => {
      const onNodeClick = latestMindMapFrameProps?.onNodeClick as ((nodes: Array<{ uid: string }>) => void) | undefined
      onNodeClick?.([{ uid: 'a' }])
    })

    await waitFor(() => {
      const lastState = capturedEditorStates.at(-1) as {
        editor_doc: {
          root: {
            children: Array<{ data: Record<string, unknown> }>
          }
        }
      }
      expect(lastState.editor_doc.root.children).toHaveLength(1)
      expect(lastState.editor_doc.root.children[0].data.text).toBe('A')
    })

    expect(screen.queryByRole('button', { name: '编辑模式' })).toBeNull()
  })

  it('lets a revealed parent keep releasing more hidden children even if one child is still placeholder', async () => {
    capturedEditorStates.length = 0
    latestMindMapFrameProps = null

    render(
      <MindMapReviewFlow
        title="Test"
        palaceId={1}
        sessionKind="practice"
        editorState={{
          ...baseEditorState,
          editor_doc: {
            root: {
              data: { text: 'Root', uid: 'root' },
              children: [
                {
                  data: { text: 'Parent', uid: 'a' },
                  children: [
                    { data: { text: 'Child 1', uid: 'a1' }, children: [] },
                    { data: { text: 'Child 2', uid: 'a2' }, children: [] },
                  ],
                },
              ],
            },
          },
        }}
        initialSnapshot={{
          revealMap: { root: 'revealed', a: 'revealed', a1: 'placeholder', a2: 'hidden' },
          redNodeIds: [],
          completed: false,
        }}
        onComplete={vi.fn()}
      />,
    )

    await act(async () => {
      const onNodeClick = latestMindMapFrameProps?.onNodeClick as ((nodes: Array<{ uid: string }>) => void) | undefined
      onNodeClick?.([{ uid: 'a' }])
    })

    await waitFor(() => {
      const lastState = capturedEditorStates.at(-1) as {
        editor_doc: {
          root: {
            children: Array<{
              children: Array<{ data: Record<string, unknown> }>
            }>
          }
        }
      }
      const visibleChildren = lastState.editor_doc.root.children[0].children
      expect(visibleChildren).toHaveLength(2)
      expect(visibleChildren[0].data.text).toBe('待回忆')
      expect(visibleChildren[1].data.text).toBe('待回忆')
    })
  })

  it('does not auto-complete review until every non-root node is fully revealed', async () => {
    capturedEditorStates.length = 0
    latestMindMapFrameProps = null
    const onComplete = vi.fn()

    render(
      <MindMapReviewFlow
        title="Test"
        palaceId={1}
        sessionKind="review"
        editorState={{
          ...baseEditorState,
          editor_doc: {
            root: {
              data: { text: 'Root', uid: 'root' },
              children: [
                { data: { text: 'A', uid: 'a' }, children: [] },
                { data: { text: 'B', uid: 'b' }, children: [] },
              ],
            },
          },
        }}
        initialSnapshot={{
          revealMap: { root: 'revealed', a: 'revealed', b: 'hidden' },
          redNodeIds: [],
          completed: false,
        }}
        onComplete={onComplete}
      />,
    )

    await act(async () => {
      const onNodeClick = latestMindMapFrameProps?.onNodeClick as ((nodes: Array<{ uid: string }>) => void) | undefined
      onNodeClick?.([{ uid: 'root' }])
    })

    await waitFor(() => {
      const lastState = capturedEditorStates.at(-1) as {
        editor_doc: {
          root: {
            children: Array<{ data: Record<string, unknown> }>
          }
        }
      }
      expect(lastState.editor_doc.root.children).toHaveLength(2)
      expect(lastState.editor_doc.root.children[1].data.text).toBe('待回忆')
    })

    expect(onComplete).not.toHaveBeenCalled()

    await act(async () => {
      const onNodeClick = latestMindMapFrameProps?.onNodeClick as ((nodes: Array<{ uid: string }>) => void) | undefined
      onNodeClick?.([{ uid: 'b' }])
    })

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          completionMode: 'auto_complete',
        }),
      )
    })
  })
})
