import { describe, expect, it } from 'vitest'
import { buildNodeRecall, buildPathQuestion, flattenDoc, parseDoc } from './recallDrill'

const doc = {
  root: {
    data: { uid: 'r', text: '线性代数' },
    children: [
      {
        data: { uid: 'a', text: '<b>行列式</b>' },
        children: [{ data: { uid: 'a1', text: '按行展开' } }, { data: { uid: 'a2', text: '范德蒙德' } }],
      },
      { data: { uid: 'b', text: '特征值' }, children: [{ data: { uid: 'b1', text: '相似对角化' } }] },
      { data: { uid: 'c', text: '二次型' }, children: [] },
    ],
  },
}

describe('recall drill', () => {
  it('flattens the tree with plain text, paths and child texts', () => {
    const nodes = flattenDoc(parseDoc(JSON.stringify(doc)))
    const a = nodes.find((node) => node.uid === 'a')
    expect(a).toMatchObject({ text: '行列式', path: ['线性代数'], depth: 1, children: ['按行展开', '范德蒙德'] })
    expect(nodes.find((node) => node.uid === 'b1')?.path).toEqual(['线性代数', '特征值'])
  })

  it('node recall picks a non-root node with children, deterministically per seed', () => {
    const nodes = flattenDoc(parseDoc(doc))
    const first = buildNodeRecall(nodes, 7)
    expect(first?.node.children.length).toBeGreaterThan(0)
    expect(first?.node.depth).toBeGreaterThan(0)
    expect(buildNodeRecall(nodes, 7)?.node.uid).toBe(first?.node.uid)
  })

  it('path question asks for the top-level branch of a leaf and includes the answer', () => {
    const nodes = flattenDoc(parseDoc(doc))
    for (let seed = 1; seed < 20; seed += 1) {
      const question = buildPathQuestion(nodes, seed)
      expect(question).not.toBeNull()
      expect(question!.options).toContain(question!.answer)
      expect(question!.answer).toBe(question!.node.path[1])
      expect(new Set(question!.options).size).toBe(question!.options.length)
    }
  })

  it('returns null when the map is too small to drill', () => {
    const tiny = flattenDoc(parseDoc({ root: { data: { text: '只有根' } } }))
    expect(buildNodeRecall(tiny, 1)).toBeNull()
    expect(buildPathQuestion(tiny, 1)).toBeNull()
  })
})
