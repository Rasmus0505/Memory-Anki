import { describe, expect, it } from 'vitest'
import { buildBilinkPreviewEditorState, sanitizeBilinkText } from './bilink-text'
import type { MindMapEditorState } from '@/shared/api/contracts'

function buildEditorState(): MindMapEditorState {
  return {
    editor_doc: {
      root: {
        data: {
          text: '<div>Hello <strong>World</strong> and <em>world</em><br>WORLD</div>',
          uid: 'root-1',
          richText: true,
        },
        children: [
          {
            data: {
              text: 'Plain world line\nSecond WORLD line',
              uid: 'child-1',
            },
            children: [],
          },
          {
            data: {
              text: '<div>No match here</div>',
              uid: 'child-2',
              richText: true,
            },
            children: [],
          },
        ],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

describe('bilink text helpers', () => {
  it('sanitizes rich text search results into readable plain text', () => {
    expect(sanitizeBilinkText('<div>第一行&nbsp;&amp;</div><div>第二行<br>第三行</div>')).toBe(
      '第一行 &\n第二行\n第三行',
    )
  })

  it('highlights every match across rich-text and plain-text nodes without mutating the source state', () => {
    const editorState = buildEditorState()

    const previewState = buildBilinkPreviewEditorState(editorState, 'world')

    expect(previewState).not.toBe(editorState)
    expect(editorState.editor_doc).toEqual(buildEditorState().editor_doc)

    const rootText = (
      (previewState?.editor_doc as { root?: { data?: { text?: string } } })?.root?.data?.text ?? ''
    )
    const childText = (
      ((previewState?.editor_doc as { root?: { children?: Array<{ data?: { text?: string } }> } })?.root
        ?.children?.[0]?.data?.text ?? '')
    )
    const unmatchedChildText = (
      ((previewState?.editor_doc as { root?: { children?: Array<{ data?: { text?: string } }> } })?.root
        ?.children?.[1]?.data?.text ?? '')
    )

    expect(rootText).toContain('<strong><span style="color:#dc2626;font-weight:700;">World</span></strong>')
    expect(rootText.match(/color:#dc2626;font-weight:700;/g)).toHaveLength(3)
    expect(rootText).toContain('<br>')
    expect(childText.match(/color:#dc2626;font-weight:700;/g)).toHaveLength(2)
    expect(childText).toContain('Second <span style="color:#dc2626;font-weight:700;">WORLD</span> line')
    expect(unmatchedChildText).toBe('<div>No match here</div>')
  })

  it('returns the original editor state when the query is empty', () => {
    const editorState = buildEditorState()

    expect(buildBilinkPreviewEditorState(editorState, '   ')).toBe(editorState)
  })
})
