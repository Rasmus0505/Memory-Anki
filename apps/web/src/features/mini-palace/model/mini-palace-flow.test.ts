import { describe, expect, it } from 'vitest'
import type { ReviewMindMapNode } from '@/entities/review/model/review-flow-tree'
import {
  buildMiniPalaceRevealState,
  isMiniPalaceRevealComplete,
  pourMiniPalaceRevealState,
  sanitizeMiniPalaceCheckpointIds,
} from './mini-palace-flow'
import { flattenNodes } from '@/entities/review/model/review-flow-tree'

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
  it('stops each branch at the nearest checkpoint when building the initial reveal map', () => {
    const root = node('1', [node('2', [node('3', [node('4', [node('5')])])])])

    const initial = buildMiniPalaceRevealState(root, ['2', '5'])
    expect(initial).toEqual({
      '1': 'revealed',
      '2': 'placeholder',
      '3': 'hidden',
      '4': 'hidden',
      '5': 'hidden',
    })
  })

  it('builds checkpoint blockers per branch instead of blocking later siblings globally', () => {
    const root = node('root', [
      node('a', [node('a1', [node('a2')])]),
      node('b', [node('b1')]),
      node('c'),
    ])

    const initial = buildMiniPalaceRevealState(root, ['a1'])
    expect(initial).toEqual({
      root: 'revealed',
      a: 'revealed',
      a1: 'placeholder',
      a2: 'hidden',
      b: 'revealed',
      b1: 'revealed',
      c: 'revealed',
    })
  })

  it('pours in parallel across sibling branches until each branch hits its checkpoint', () => {
    const root = node('root', [
      node('a', [node('a1', [node('a2')])]),
      node('b', [node('b1', [node('b2')])]),
      node('c', [node('c1')]),
    ])
    const nodeMap = flattenNodes(root)
    const revealMap = {
      root: 'revealed',
      a: 'revealed',
      a1: 'revealed',
      a2: 'hidden',
      b: 'revealed',
      b1: 'hidden',
      b2: 'hidden',
      c: 'revealed',
      c1: 'hidden',
    } as const

    const next = pourMiniPalaceRevealState('root', root, nodeMap, ['a2', 'b2'], revealMap)
    expect(next).toEqual({
      root: 'revealed',
      a: 'revealed',
      a1: 'revealed',
      a2: 'placeholder',
      b: 'revealed',
      b1: 'revealed',
      b2: 'placeholder',
      c: 'revealed',
      c1: 'revealed',
    })
  })

  it('sanitizes invalid and duplicate checkpoint ids', () => {
    const root = node('root', [node('a'), node('b')])
    expect(sanitizeMiniPalaceCheckpointIds(root, ['a', 'missing', 'a', 'b'])).toEqual(['a', 'b'])
  })

  it('marks completion only when every checkpoint is revealed', () => {
    const root = node('root', [node('a'), node('b')])
    expect(
      isMiniPalaceRevealComplete(root, ['a', 'b'], {
        root: 'revealed',
        a: 'revealed',
        b: 'placeholder',
      }),
    ).toBe(false)
    expect(
      isMiniPalaceRevealComplete(root, ['a', 'b'], {
        root: 'revealed',
        a: 'revealed',
        b: 'revealed',
      }),
    ).toBe(true)
  })
})
