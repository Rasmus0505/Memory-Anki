import { describe, expect, it } from 'vitest'
import { resolveArrowNavigationTarget } from './mindMapEditorSurfaceKeyboard'

const nodes = [
  { id: 'root', parentId: null },
  { id: 'a', parentId: 'root' },
  { id: 'b', parentId: 'root' },
  { id: 'c', parentId: 'root' },
  { id: 'a1', parentId: 'a' },
  { id: 'a2', parentId: 'a' },
]

describe('resolveArrowNavigationTarget', () => {
  it('moves to the parent on ArrowLeft', () => {
    expect(resolveArrowNavigationTarget(nodes, 'a2', 'ArrowLeft')).toBe('a')
  })

  it('returns null on ArrowLeft from the root', () => {
    expect(resolveArrowNavigationTarget(nodes, 'root', 'ArrowLeft')).toBeNull()
  })

  it('moves to the first child on ArrowRight', () => {
    expect(resolveArrowNavigationTarget(nodes, 'a', 'ArrowRight')).toBe('a1')
  })

  it('returns null on ArrowRight when the node has no children', () => {
    expect(resolveArrowNavigationTarget(nodes, 'b', 'ArrowRight')).toBeNull()
  })

  it('moves to the previous and next sibling on ArrowUp and ArrowDown', () => {
    expect(resolveArrowNavigationTarget(nodes, 'b', 'ArrowUp')).toBe('a')
    expect(resolveArrowNavigationTarget(nodes, 'b', 'ArrowDown')).toBe('c')
  })

  it('returns null at the edges of the sibling list', () => {
    expect(resolveArrowNavigationTarget(nodes, 'a', 'ArrowUp')).toBeNull()
    expect(resolveArrowNavigationTarget(nodes, 'c', 'ArrowDown')).toBeNull()
  })

  it('treats undefined and null parentId as the same root level', () => {
    const mixed = [
      { id: 'x', parentId: undefined },
      { id: 'y', parentId: null },
    ]
    expect(resolveArrowNavigationTarget(mixed, 'x', 'ArrowDown')).toBe('y')
  })

  it('returns null for unknown selection or non-arrow keys', () => {
    expect(resolveArrowNavigationTarget(nodes, 'missing', 'ArrowDown')).toBeNull()
    expect(resolveArrowNavigationTarget(nodes, 'a', 'Enter')).toBeNull()
  })
})
