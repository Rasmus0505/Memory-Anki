import { describe, expect, it } from 'vitest'
import type { MindMapDoc, MindMapEditorState } from '@/shared/api/contracts'
import {
  advanceRevealStateForNodeClick,
  applyQuestionCardAutoReveal,
  buildInitialRevealState,
  buildReviewTree,
  buildVisibleEditorState,
  flattenNodes,
  hideRevealStateBranch,
  parseEditorDoc,
} from './review-flow-tree'

describe('review-flow-tree visible editor state', () => {
  it('preserves yellow emphasis markup on revealed cards in review/practice projections', () => {
    const highlighted =
      '<div><span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">重点概念</span></div>'
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          {
            data: {
              text: highlighted,
              uid: 'child-highlight',
              richText: true,
            },
            children: [],
          },
          { data: { text: 'Plain child', uid: 'child-plain' }, children: [] },
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
        'child-highlight': 'revealed',
        'child-plain': 'placeholder',
      },
      nodeMap,
      'Root',
      new Set(),
    )
    const visibleDoc = visibleState.editor_doc as MindMapDoc
    const highlightedNode = visibleDoc.root?.children?.find(
      (node) => node.data?.uid === 'child-highlight',
    )
    const placeholderNode = visibleDoc.root?.children?.find(
      (node) => node.data?.uid === 'child-plain',
    )

    expect(String(highlightedNode?.data?.text)).toContain('data-emphasis="highlight"')
    expect(String(highlightedNode?.data?.text)).toContain('重点概念')
    expect(highlightedNode?.data?.richText).toBe(true)
    expect(placeholderNode?.data?.text).toBe('待回忆')
    // Source document must stay untouched.
    expect(String(sourceDoc.root?.children?.[0]?.data?.text)).toContain('data-emphasis="highlight"')
  })

  it('restores richText flag from markup alone when source flag is missing', () => {
    const highlighted =
      '<div><span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">只有标记</span></div>'
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [{ data: { text: highlighted, uid: 'only-markup' }, children: [] }],
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
      { root: 'revealed', 'only-markup': 'revealed' },
      nodeMap,
      'Root',
      new Set(),
    )
    const node = (visibleState.editor_doc as MindMapDoc).root?.children?.[0]
    expect(String(node?.data?.text)).toContain('data-emphasis="highlight"')
    expect(node?.data?.richText).toBe(true)
  })

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
      lineColor: '#2563eb',
      lineWidth: 4,
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

  it('progresses review lines from expanding to direct-level visible to subtree revealed', () => {
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          {
            data: { text: 'A', uid: 'a' },
            children: [{ data: { text: 'A1', uid: 'a1' }, children: [] }],
          },
          { data: { text: 'B', uid: 'b' }, children: [] },
        ],
      },
    }
    const editorState: MindMapEditorState = {
      editor_doc: sourceDoc,
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    }
    const root = buildReviewTree(sourceDoc, 'Root')
    const nodeMap = flattenNodes(root)

    const buildChildData = (revealMap: Record<string, 'hidden' | 'placeholder' | 'revealed'>) => {
      const visibleState = buildVisibleEditorState(
        editorState,
        sourceDoc,
        revealMap,
        nodeMap,
        'Root',
        new Set(),
      )
      const visibleDoc = visibleState.editor_doc as MindMapDoc
      return visibleDoc.root?.children?.map((node) => node.data) ?? []
    }

    expect(buildChildData({ root: 'revealed', a: 'placeholder', a1: 'hidden', b: 'hidden' })[0])
      .toMatchObject({ lineColor: '#d97706', lineWidth: 2 })

    const directLevelVisible = buildChildData({
      root: 'revealed',
      a: 'placeholder',
      a1: 'hidden',
      b: 'placeholder',
    })
    expect(directLevelVisible[0]).toMatchObject({ lineColor: '#2563eb', lineWidth: 4 })
    expect(directLevelVisible[1]).toMatchObject({ lineColor: '#2563eb', lineWidth: 4 })

    const subtreeRevealed = buildChildData({
      root: 'revealed',
      a: 'revealed',
      a1: 'revealed',
      b: 'revealed',
    })
    expect(subtreeRevealed[0]).toMatchObject({ lineColor: '#059669', lineWidth: 6 })
    expect(subtreeRevealed[1]).toMatchObject({ lineColor: '#059669', lineWidth: 6 })
  })

  it('keeps standard click semantics when segment-checkpoint mode is enabled', () => {
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          {
            data: { text: 'A', uid: 'a' },
            children: [{ data: { text: 'A1', uid: 'a1' }, children: [] }],
          },
          { data: { text: 'B', uid: 'b' }, children: [] },
        ],
      },
    }
    const root = buildReviewTree(sourceDoc, 'Root')
    const nodeMap = flattenNodes(root)

    const initial = buildInitialRevealState(root, null, {
      mode: 'segment-checkpoint',
      checkpointIds: ['a1', 'b'],
    })
    expect(initial).toEqual({
      root: 'revealed',
      a: 'revealed',
      a1: 'placeholder',
      b: 'placeholder',
    })

    const afterRootClick = advanceRevealStateForNodeClick('root', nodeMap, initial)
    expect(afterRootClick).toEqual(initial)

    const afterCheckpointReveal = advanceRevealStateForNodeClick('a1', nodeMap, initial)
    expect(afterCheckpointReveal.a1).toBe('revealed')
  })

  it('auto-reveals question-card children when a parent becomes revealed', () => {
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          { data: { text: 'A', uid: 'a' }, children: [] },
          {
            data: { text: 'B', uid: 'b', memoryAnkiQuestionCard: true },
            children: [{ data: { text: 'B1', uid: 'b1' }, children: [] }],
          },
          { data: { text: 'C', uid: 'c', memoryAnkiQuestionCard: true }, children: [] },
        ],
      },
    }
    const root = buildReviewTree(sourceDoc, 'Root')
    const nodeMap = flattenNodes(root)

    expect(nodeMap.get('b')?.isQuestionCard).toBe(true)
    expect(nodeMap.get('c')?.isQuestionCard).toBe(true)

    const initial = buildInitialRevealState(root)
    expect(initial).toEqual({
      root: 'revealed',
      a: 'hidden',
      b: 'revealed',
      b1: 'hidden',
      c: 'revealed',
    })

    const afterRootClick = advanceRevealStateForNodeClick('root', nodeMap, initial)
    expect(afterRootClick.a).toBe('placeholder')
    expect(afterRootClick.b).toBe('revealed')
    expect(afterRootClick.c).toBe('revealed')
    expect(afterRootClick.b1).toBe('hidden')

    const afterBClick = advanceRevealStateForNodeClick('b', nodeMap, afterRootClick)
    expect(afterBClick.b1).toBe('placeholder')

    const afterHide = hideRevealStateBranch('root', nodeMap, afterBClick)
    expect(afterHide.b).toBe('hidden')
    expect(afterHide.c).toBe('hidden')
    expect(afterHide.a).toBe('hidden')
    expect(afterHide.root).toBe('revealed')

    // Parent still revealed: next advance re-runs cascade so question cards return.
    const afterRecover = advanceRevealStateForNodeClick('root', nodeMap, afterHide)
    expect(afterRecover.a).toBe('placeholder')
    expect(afterRecover.b).toBe('revealed')
    expect(afterRecover.c).toBe('revealed')
  })

  it('cascades nested question cards through applyQuestionCardAutoReveal', () => {
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          {
            data: { text: 'Q1', uid: 'q1', memoryAnkiQuestionCard: true },
            children: [
              {
                data: { text: 'Q2', uid: 'q2', memoryAnkiQuestionCard: true },
                children: [{ data: { text: 'Leaf', uid: 'leaf' }, children: [] }],
              },
            ],
          },
        ],
      },
    }
    const root = buildReviewTree(sourceDoc, 'Root')
    const nodeMap = flattenNodes(root)
    const next = applyQuestionCardAutoReveal(nodeMap, {
      root: 'revealed',
      q1: 'hidden',
      q2: 'hidden',
      leaf: 'hidden',
    })
    expect(next).toEqual({
      root: 'revealed',
      q1: 'revealed',
      q2: 'revealed',
      leaf: 'hidden',
    })
  })
})
