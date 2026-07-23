import { describe, expect, it } from 'vitest'
import {
  collectAnkiCards,
  cycleAnkiRole,
  nextExplicitAnkiRole,
  resolveEffectiveAnkiRole,
  type AnkiTreeNode,
} from './ankiRoles'

function tree(nodes: AnkiTreeNode[]): Record<string, AnkiTreeNode> {
  return Object.fromEntries(nodes.map((node) => [node.uid, node]))
}

describe('ankiRoles', () => {
  it('cycles none → front → back → none', () => {
    expect(cycleAnkiRole('none')).toBe('front')
    expect(cycleAnkiRole('front')).toBe('back')
    expect(cycleAnkiRole('back')).toBe('none')
  })

  it('infers direct children of front as backs', () => {
    const nodes = tree([
      { uid: 'root', parentUid: null, children: ['a'] },
      { uid: 'a', parentUid: 'root', children: ['b', 'c'], explicitRole: 'front' },
      { uid: 'b', parentUid: 'a', children: [] },
      { uid: 'c', parentUid: 'a', children: [] },
    ])
    expect(resolveEffectiveAnkiRole('a', nodes)).toBe('front')
    expect(resolveEffectiveAnkiRole('b', nodes)).toBe('back')
    expect(resolveEffectiveAnkiRole('c', nodes)).toBe('back')
    expect(collectAnkiCards(nodes)).toEqual([
      { frontUid: 'a', backUids: ['b', 'c'] },
    ])
  })

  it('allows explicit none to opt out of default back inference', () => {
    const nodes = tree([
      { uid: 'root', parentUid: null, children: ['a'] },
      { uid: 'a', parentUid: 'root', children: ['b'], explicitRole: 'front' },
      { uid: 'b', parentUid: 'a', children: [], explicitRole: 'none' },
    ])
    expect(resolveEffectiveAnkiRole('b', nodes)).toBe('none')
    expect(collectAnkiCards(nodes)).toEqual([{ frontUid: 'a', backUids: [] }])
  })

  it('nextExplicitAnkiRole starts from stored role', () => {
    expect(nextExplicitAnkiRole({})).toBe('front')
    expect(nextExplicitAnkiRole({ ankiRole: 'front' })).toBe('back')
    expect(nextExplicitAnkiRole({ ankiRole: 'back' })).toBe('none')
  })
})
