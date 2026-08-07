import { describe, expect, it } from 'vitest'
import type { MindMapDoc } from '@/shared/api/contracts'
import {
  advanceRevealStateForNodeClick,
  buildInitialRevealState,
  buildReviewTree,
  flattenNodes,
} from './review-flow-tree'

function buildTwoChildTree() {
  const sourceDoc: MindMapDoc = {
    root: {
      data: { text: 'Root', uid: 'root' },
      children: [
        { data: { text: 'A', uid: 'a' }, children: [] },
        { data: { text: 'B', uid: 'b' }, children: [] },
      ],
    },
  }
  const root = buildReviewTree(sourceDoc, 'Root')
  return { root, nodeMap: flattenNodes(root) }
}

describe('review-flow-tree reveal configuration', () => {
  it('restricts focused freestyle reveals to the current path and unit nodes', () => {
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          { data: { text: 'Path', uid: 'path' }, children: [
            { data: { text: 'Current', uid: 'current' }, children: [] },
          ] },
          { data: { text: 'Other', uid: 'other' }, children: [
            { data: { text: 'Other child', uid: 'other-child' }, children: [] },
          ] },
        ],
      },
    }
    const root = buildReviewTree(sourceDoc, 'Root')
    const nodeMap = flattenNodes(root)
    const options = {
      revealGranularity: 'level' as const,
      revealStage: 'direct' as const,
      allowedNodeIds: ['path', 'current'],
    }
    const initial = buildInitialRevealState(root, {
      root: 'revealed',
      path: 'hidden',
      current: 'hidden',
      other: 'revealed',
      'other-child': 'revealed',
    }, options)

    const afterRoot = advanceRevealStateForNodeClick('root', nodeMap, initial, options, root)
    expect(afterRoot).toMatchObject({ path: 'revealed', current: 'hidden', other: 'hidden', 'other-child': 'hidden' })
    expect(advanceRevealStateForNodeClick('other', nodeMap, afterRoot, options, root)).toBe(afterRoot)

    const afterPath = advanceRevealStateForNodeClick('path', nodeMap, afterRoot, options, root)
    expect(afterPath).toMatchObject({ path: 'revealed', current: 'revealed', other: 'hidden' })
  })

  it('supports single-card two-phase progression in document order', () => {
    const { root, nodeMap } = buildTwoChildTree()
    const options = { revealGranularity: 'single' as const, revealStage: 'two-step' as const }
    const initial = buildInitialRevealState(root)
    const first = advanceRevealStateForNodeClick('root', nodeMap, initial, options, root)
    const second = advanceRevealStateForNodeClick('root', nodeMap, first, options, root)
    const third = advanceRevealStateForNodeClick('root', nodeMap, second, options, root)
    const fourth = advanceRevealStateForNodeClick('root', nodeMap, third, options, root)

    expect(first).toMatchObject({ a: 'placeholder', b: 'hidden' })
    expect(second).toMatchObject({ a: 'revealed', b: 'hidden' })
    expect(third).toMatchObject({ a: 'revealed', b: 'placeholder' })
    expect(fourth).toMatchObject({ a: 'revealed', b: 'revealed' })
  })

  it('supports direct-content reveal without creating placeholders', () => {
    const { root, nodeMap } = buildTwoChildTree()
    const options = { revealGranularity: 'level' as const, revealStage: 'direct' as const }
    const revealed = advanceRevealStateForNodeClick(
      'root',
      nodeMap,
      buildInitialRevealState(root),
      options,
      root,
    )

    expect(revealed).toMatchObject({ root: 'revealed', a: 'revealed', b: 'revealed' })
    expect(Object.values(revealed)).not.toContain('placeholder')
  })

  it('keeps BFS levels while single-card mode crosses branches one card at a time', () => {
    const sourceDoc: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          { data: { text: 'A', uid: 'a' }, children: [{ data: { text: 'A1', uid: 'a1' }, children: [] }] },
          { data: { text: 'B', uid: 'b' }, children: [{ data: { text: 'B1', uid: 'b1' }, children: [] }] },
        ],
      },
    }
    const root = buildReviewTree(sourceDoc, 'Root')
    const nodeMap = flattenNodes(root)
    const options = { revealGranularity: 'single' as const, revealStage: 'direct' as const }
    let revealMap = buildInitialRevealState(root)
    const clickRoot = () => {
      revealMap = advanceRevealStateForNodeClick('root', nodeMap, revealMap, options, root)
    }

    clickRoot()
    expect(revealMap).toMatchObject({ a: 'revealed', b: 'hidden', a1: 'hidden', b1: 'hidden' })
    clickRoot()
    expect(revealMap).toMatchObject({ a: 'revealed', b: 'revealed', a1: 'hidden', b1: 'hidden' })
    clickRoot()
    expect(revealMap).toMatchObject({ a1: 'revealed', b1: 'hidden' })
  })

  it('supports direct-content checkpoint reveal while preserving direct placeholder clicks', () => {
    const { root, nodeMap } = buildTwoChildTree()
    const options = {
      mode: 'segment-checkpoint' as const,
      checkpointIds: ['a', 'b'],
      revealGranularity: 'level' as const,
      revealStage: 'direct' as const,
    }
    const initial = buildInitialRevealState(root, null, options)
    const fromParent = advanceRevealStateForNodeClick('root', nodeMap, initial, options, root)
    const directClick = advanceRevealStateForNodeClick(
      'a',
      nodeMap,
      { root: 'revealed', a: 'placeholder', b: 'revealed' },
      options,
      root,
    )

    expect(fromParent).toMatchObject({ a: 'revealed', b: 'revealed' })
    expect(directClick).toMatchObject({ a: 'revealed', b: 'revealed' })
  })
})
