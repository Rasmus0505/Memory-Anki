import { describe, expect, it } from 'vitest'
import { buildNodeProgressByNodeUid, type UnitPassState } from './quizNodeBindingAggregation'

const doc = {
  root: {
    data: { uid: 'root', text: '宫殿' },
    children: [
      {
        data: { uid: 'chapter-node', text: '第一节' },
        children: [{ data: { uid: 'leaf', text: '要点' }, children: [] }],
      },
    ],
  },
}

// Palace has 4 questions in total: 2 under the root's chapter node, 2 on the root itself.
const questions = new Map<string, Set<number>>([
  ['root', new Set([1, 2, 3, 4])],
  ['chapter-node', new Set([1, 2])],
  ['leaf', new Set([1])],
])
const passStates: UnitPassState[] = []

describe('buildNodeProgressByNodeUid', () => {
  it('divides the palace root by its chapter total instead of always reading 100%', () => {
    const progress = buildNodeProgressByNodeUid(doc, questions, passStates, 10)

    expect(progress.root).toMatchObject({ count: 4, total: 10, ratio: 0.4 })
  })

  it('keeps non-root nodes on the whole palace denominator', () => {
    const progress = buildNodeProgressByNodeUid(doc, questions, passStates, 10)

    expect(progress['chapter-node']).toMatchObject({ count: 2, total: 4, ratio: 0.5 })
    expect(progress.leaf).toMatchObject({ count: 1, total: 4, ratio: 0.25 })
  })

  it('falls back to the palace total when the chapter total is unknown', () => {
    const progress = buildNodeProgressByNodeUid(doc, questions, passStates, null)

    expect(progress.root).toMatchObject({ count: 4, total: 4, ratio: 1 })
  })

  it('never lets the root denominator drop below the palace count', () => {
    const progress = buildNodeProgressByNodeUid(doc, questions, passStates, 2)

    expect(progress.root).toMatchObject({ count: 4, total: 4, ratio: 1 })
  })
})
