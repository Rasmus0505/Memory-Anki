import { describe, expect, it } from 'vitest'
import type { MindMapDoc, MindMapEditorState } from '@/shared/api/contracts'
import {
  buildReviewTree,
  buildVisibleEditorState,
  flattenNodes,
  parseEditorDoc,
} from './review-flow-tree'

describe('review-flow-tree visible editor state', () => {
  it('applies paper-map review styles without mutating the source document', () => {
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          { data: { text: 'Hidden child', uid: 'child-1' }, children: [] },
          { data: { text: 'Revealed child', uid: 'child-2' }, children: [] },
          { data: { text: 'Red child', uid: 'child-3' }, children: [] },
        ],
      },
    }
    const editorState: MindMapEditorState = {
      editor_doc: sourceDoc,
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    }
    const parsedDoc = parseEditorDoc(editorState.editor_doc)
    const root = buildReviewTree(parsedDoc, 'Root')
    const nodeMap = flattenNodes(root)

    const visibleState = buildVisibleEditorState(
      editorState,
      parsedDoc,
      {
        root: 'revealed',
        'child-1': 'placeholder',
        'child-2': 'revealed',
        'child-3': 'revealed',
      },
      nodeMap,
      'Root',
      new Set(['child-3']),
    )
    const visibleDoc = visibleState.editor_doc as MindMapDoc
    const rootData = visibleDoc.root?.data
    const childData = visibleDoc.root?.children?.map((node) => node.data)

    expect(rootData).toMatchObject({
      fillColor: '#18181b',
      borderColor: '#09090b',
      color: '#fafafa',
    })
    expect(childData?.[0]).toMatchObject({
      text: '待回忆',
      fillColor: '#fffbeb',
      borderColor: '#f59e0b',
      color: '#92400e',
      paddingY: 9,
      lineColor: '#10b981',
    })
    expect(childData?.[1]).toMatchObject({
      text: 'Revealed child',
      fillColor: '#ecfdf5',
      borderColor: '#10b981',
      color: '#065f46',
      paddingY: 9,
    })
    expect(childData?.[2]).toMatchObject({
      text: 'Red child',
      fillColor: '#fff1f2',
      borderColor: '#e11d48',
      color: '#881337',
      paddingY: 9,
    })
    expect(sourceDoc.root?.children?.[0]?.data?.text).toBe('Hidden child')
    expect(sourceDoc.root?.children?.[0]?.data?.fillColor).toBeUndefined()
    expect(sourceDoc.root?.children?.[0]?.data?.paddingY).toBeUndefined()
  })
})
