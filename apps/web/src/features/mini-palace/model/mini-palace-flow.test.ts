import { describe, expect, it } from 'vitest'
import type { ReviewMindMapNode } from '@/features/review/model/review-flow-tree'
import {
  advanceMiniPalaceRevealStateForNodeClick,
  buildMiniPalaceRevealState,
  isMiniPalaceRevealComplete,
  sanitizeMiniPalaceCheckpointIds,
} from './mini-palace-flow'

function node(
  id: string,
  children: ReviewMindMapNode[] = [],
  parentId: string | null = null,
): ReviewMindMapNode {
  const item: ReviewMindMapNode = {
    id,
    text: id,
    note: '',
    parentId,
    children,
  }
  item.children = children.map((child) => ({ ...child, parentId: id }))
  return item
}

describe('mini palace reveal flow', () => {
  it('stops at checkpoints and auto-reveals intermediate nodes after a checkpoint is flipped', () => {
    const root = node('1', [node('2', [node('3', [node('4', [node('5')])])])])

    const initial = buildMiniPalaceRevealState(root, ['2', '5'])
    expect(initial).toEqual({
      '1': 'revealed',
      '2': 'placeholder',
      '3': 'hidden',
      '4': 'hidden',
      '5': 'hidden',
    })

    const afterTwo = advanceMiniPalaceRevealStateForNodeClick('2', root, ['2', '5'], initial)
    expect(afterTwo).toEqual({
      '1': 'revealed',
      '2': 'revealed',
      '3': 'revealed',
      '4': 'revealed',
      '5': 'placeholder',
    })

    const afterFive = advanceMiniPalaceRevealStateForNodeClick('5', root, ['2', '5'], afterTwo)
    expect(afterFive['5']).toBe('revealed')
    expect(isMiniPalaceRevealComplete(root, ['2', '5'], afterFive)).toBe(true)
  })

  it('uses pre-order traversal for branched trees', () => {
    const root = node('root', [
      node('a', [node('a1')]),
      node('b'),
    ])

    const initial = buildMiniPalaceRevealState(root, ['a1', 'b'])
    expect(initial).toEqual({
      root: 'revealed',
      a: 'revealed',
      a1: 'placeholder',
      b: 'hidden',
    })

    const afterA1 = advanceMiniPalaceRevealStateForNodeClick('a1', root, ['a1', 'b'], initial)
    expect(afterA1).toEqual({
      root: 'revealed',
      a: 'revealed',
      a1: 'revealed',
      b: 'placeholder',
    })
  })

  it('handles parent and child checkpoints one at a time', () => {
    const root = node('root', [node('a', [node('a1'), node('a2')])])
    const initial = buildMiniPalaceRevealState(root, ['a', 'a1'])
    expect(initial.a).toBe('placeholder')
    expect(initial.a1).toBe('hidden')

    const afterParent = advanceMiniPalaceRevealStateForNodeClick('a', root, ['a', 'a1'], initial)
    expect(afterParent.a).toBe('revealed')
    expect(afterParent.a1).toBe('placeholder')
    expect(afterParent.a2).toBe('hidden')
  })

  it('sanitizes invalid and duplicate checkpoint ids', () => {
    const root = node('root', [node('a'), node('b')])
    expect(sanitizeMiniPalaceCheckpointIds(root, ['a', 'missing', 'a', 'b'])).toEqual(['a', 'b'])
  })
})
