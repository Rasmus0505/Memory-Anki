import { describe, expect, it } from 'vitest'
import type { MindMapDoc, MindMapEditorState } from '@/shared/api/contracts'
import {
  advanceBulkRevealState,
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

  it('auto-reveals non-due cards for formal due-scope focusNodeIds (node review)', () => {
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          {
            data: { text: 'Branch', uid: 'branch' },
            children: [
              { data: { text: 'Fresh', uid: 'fresh' }, children: [] },
              {
                data: { text: 'Due parent', uid: 'due-parent' },
                children: [
                  { data: { text: 'Nested fresh', uid: 'nested-fresh' }, children: [] },
                  { data: { text: 'Nested due', uid: 'nested-due' }, children: [] },
                ],
              },
            ],
          },
        ],
      },
    }
    const root = buildReviewTree(sourceDoc, 'Root')
    const nodeMap = flattenNodes(root)
    const options = { focusNodeIds: ['due-parent', 'nested-due'] }

    const initial = buildInitialRevealState(root, null, options)
    expect(initial).toEqual({
      root: 'revealed',
      branch: 'revealed',
      fresh: 'revealed',
      'due-parent': 'placeholder',
      'nested-fresh': 'hidden',
      'nested-due': 'hidden',
    })

    // Flipping a due card only reveals that card — children stay hidden (same as normal review).
    const afterDueParent = advanceRevealStateForNodeClick(
      'due-parent',
      nodeMap,
      initial,
      options,
      root,
    )
    expect(afterDueParent).toEqual({
      root: 'revealed',
      branch: 'revealed',
      fresh: 'revealed',
      'due-parent': 'revealed',
      'nested-fresh': 'hidden',
      'nested-due': 'hidden',
    })

    // Next click on the revealed parent opens the first child as a placeholder.
    const afterExpandChild = advanceRevealStateForNodeClick(
      'due-parent',
      nodeMap,
      afterDueParent,
      options,
      root,
    )
    expect(afterExpandChild).toEqual({
      root: 'revealed',
      branch: 'revealed',
      fresh: 'revealed',
      'due-parent': 'revealed',
      'nested-fresh': 'placeholder',
      'nested-due': 'hidden',
    })

    // Flip the first child content, then open the next sibling placeholder.
    const afterFlipNestedFresh = advanceRevealStateForNodeClick(
      'nested-fresh',
      nodeMap,
      afterExpandChild,
      options,
      root,
    )
    expect(afterFlipNestedFresh['nested-fresh']).toBe('revealed')
    const afterExpandNestedDue = advanceRevealStateForNodeClick(
      'due-parent',
      nodeMap,
      afterFlipNestedFresh,
      options,
      root,
    )
    expect(afterExpandNestedDue['nested-due']).toBe('placeholder')

    // Legacy "all hidden except root" progress heals into due-scope on rebuild.
    const healed = buildInitialRevealState(
      root,
      {
        root: 'revealed',
        branch: 'hidden',
        fresh: 'hidden',
        'due-parent': 'hidden',
        'nested-fresh': 'hidden',
        'nested-due': 'hidden',
      },
      options,
    )
    expect(healed['due-parent']).toBe('placeholder')
    expect(healed.fresh).toBe('revealed')
    expect(healed.branch).toBe('revealed')
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

  it('bulk flips all descendants in two phases without resetting revealed cards', () => {
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          {
            data: { text: 'A', uid: 'a' },
            children: [
              { data: { text: 'A1', uid: 'a1' }, children: [] },
              { data: { text: 'A2', uid: 'a2' }, children: [] },
            ],
          },
          { data: { text: 'B', uid: 'b' }, children: [] },
        ],
      },
    }
    const root = buildReviewTree(sourceDoc, 'Root')
    const nodeMap = flattenNodes(root)
    const initial = {
      root: 'revealed' as const,
      a: 'revealed' as const,
      a1: 'hidden' as const,
      a2: 'hidden' as const,
      b: 'revealed' as const,
    }

    const phase1 = advanceBulkRevealState('a', nodeMap, initial, 'subtree')
    expect(phase1).toEqual({
      root: 'revealed',
      a: 'revealed',
      a1: 'placeholder',
      a2: 'placeholder',
      b: 'revealed',
    })

    const phase2 = advanceBulkRevealState('a', nodeMap, phase1, 'subtree')
    expect(phase2).toEqual({
      root: 'revealed',
      a: 'revealed',
      a1: 'revealed',
      a2: 'revealed',
      b: 'revealed',
    })

    // Already fully revealed: third press is a no-op.
    expect(advanceBulkRevealState('a', nodeMap, phase2, 'subtree')).toEqual(phase2)
  })

  it('bulk direct-children scope only opens one level and keeps deeper nodes hidden', () => {
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          {
            data: { text: 'A', uid: 'a' },
            children: [
              {
                data: { text: 'A1', uid: 'a1' },
                children: [{ data: { text: 'A1a', uid: 'a1a' }, children: [] }],
              },
            ],
          },
        ],
      },
    }
    const root = buildReviewTree(sourceDoc, 'Root')
    const nodeMap = flattenNodes(root)
    const initial = {
      root: 'revealed' as const,
      a: 'revealed' as const,
      a1: 'hidden' as const,
      a1a: 'hidden' as const,
    }

    const phase1 = advanceBulkRevealState('a', nodeMap, initial, 'direct-children')
    expect(phase1).toEqual({
      root: 'revealed',
      a: 'revealed',
      a1: 'placeholder',
      a1a: 'hidden',
    })

    const phase2 = advanceBulkRevealState('a', nodeMap, phase1, 'direct-children')
    expect(phase2).toEqual({
      root: 'revealed',
      a: 'revealed',
      a1: 'revealed',
      a1a: 'hidden',
    })
  })

  it('bulk subtree opens deep hidden descendants in one placeholder pass', () => {
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          {
            data: { text: 'A', uid: 'a' },
            children: [
              {
                data: { text: 'A1', uid: 'a1' },
                children: [{ data: { text: 'A1a', uid: 'a1a' }, children: [] }],
              },
            ],
          },
        ],
      },
    }
    const root = buildReviewTree(sourceDoc, 'Root')
    const nodeMap = flattenNodes(root)
    const initial = {
      root: 'revealed' as const,
      a: 'revealed' as const,
      a1: 'hidden' as const,
      a1a: 'hidden' as const,
    }

    const phase1 = advanceBulkRevealState('a', nodeMap, initial, 'subtree')
    expect(phase1).toEqual({
      root: 'revealed',
      a: 'revealed',
      a1: 'placeholder',
      a1a: 'placeholder',
    })
  })
})
