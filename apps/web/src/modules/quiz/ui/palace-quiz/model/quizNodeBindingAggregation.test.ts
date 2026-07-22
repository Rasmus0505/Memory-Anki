import { describe, expect, it } from 'vitest'
import {
  buildDirectBindingMap,
  buildRemainingCountByNodeUid,
  buildSubtreeQuestionMap,
  getQuestionIdsForNode,
} from './quizNodeBindingAggregation'

const doc = {
  root: {
    data: { uid: 'root', text: '根' },
    children: [
      {
        data: { uid: 'parent', text: '父' },
        children: [
          { data: { uid: 'child-a', text: '子A' }, children: [] },
          { data: { uid: 'child-b', text: '子B' }, children: [] },
        ],
      },
    ],
  },
}

describe('quizNodeBindingAggregation', () => {
  it('aggregates parent counts from descendants and drops completed ids', () => {
    const direct = buildDirectBindingMap([
      { question_id: 1, node_uid: 'child-a' },
      { question_id: 2, node_uid: 'child-b' },
      { question_id: 1, node_uid: 'parent' },
    ])
    const subtree = buildSubtreeQuestionMap(doc, direct)
    expect([...subtree.get('parent')!].sort()).toEqual([1, 2])
    expect([...subtree.get('child-a')!]).toEqual([1])

    const remaining = buildRemainingCountByNodeUid(subtree, new Set([1]))
    expect(remaining['parent']).toBe(1)
    expect(remaining['child-a']).toBeUndefined()
    expect(remaining['child-b']).toBe(1)

    expect(getQuestionIdsForNode(subtree, 'parent', new Set([1]))).toEqual([2])
  })
})
