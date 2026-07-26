import { describe, expect, it } from 'vitest'
import {
  buildCountBadgeByNodeUid,
  buildDirectBindingMap,
  buildRemainingCountByNodeUid,
  buildSubtreeQuestionMap,
  firstIncompleteQuestionIndex,
  getQuestionIdsForNode,
  ownerPalaceLabel,
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
    expect(
      getQuestionIdsForNode(subtree, 'parent', new Set([1]), { includeCompleted: true }),
    ).toEqual([1, 2])
  })

  it('keeps a gray total badge when every bound question is session-completed', () => {
    const direct = buildDirectBindingMap([
      { question_id: 1, node_uid: 'child-a' },
      { question_id: 2, node_uid: 'child-b' },
    ])
    const subtree = buildSubtreeQuestionMap(doc, direct)
    const badges = buildCountBadgeByNodeUid(subtree, new Set([1, 2]))
    expect(badges['parent']).toEqual({
      text: '2',
      tone: 'neutral',
      title: '2 道关联题本会话已完成（点开可回顾答题）',
    })
    expect(badges['child-a']?.tone).toBe('neutral')
    const partial = buildCountBadgeByNodeUid(subtree, new Set([1]))
    expect(partial['parent']?.tone).toBe('success')
    expect(partial['parent']?.text).toBe('1')
    expect(firstIncompleteQuestionIndex([1, 2, 3], new Set([1]))).toBe(1)
    expect(firstIncompleteQuestionIndex([1, 2], new Set([1, 2]))).toBe(0)
  })

  it('counts foreign-owner edges on a local node in subtree unions', () => {
    const direct = buildDirectBindingMap([
      {
        question_id: 10,
        node_uid: 'child-a',
        palace_id: 2,
        question_owner_palace_id: 99,
        is_cross_palace: true,
      },
      { question_id: 11, node_uid: 'child-b', palace_id: 2, question_owner_palace_id: 2 },
    ])
    const subtree = buildSubtreeQuestionMap(doc, direct)
    expect([...subtree.get('parent')!].sort((a, b) => a - b)).toEqual([10, 11])
    expect(ownerPalaceLabel(
      { question_id: 10, node_uid: 'child-a', question_owner_palace_id: 99, question_owner_palace_title: '宫殿A' },
      2,
    )).toBe('来自·宫殿A')
    expect(ownerPalaceLabel(
      { question_id: 11, node_uid: 'child-b', question_owner_palace_id: 2 },
      2,
    )).toBe('本宫')
  })

  it('counts full subtree from complete palace doc, not only revealed children', () => {
    const fullDoc = {
      root: {
        data: { uid: 'root', text: 'root' },
        children: [
          {
            data: { uid: 'parent', text: 'parent' },
            children: [
              { data: { uid: 'child-a', text: 'A' }, children: [] },
              { data: { uid: 'child-b', text: 'B' }, children: [] },
            ],
          },
        ],
      },
    }
    const revealedOnlyParent = {
      root: {
        data: { uid: 'root', text: 'root' },
        children: [
          {
            data: { uid: 'parent', text: 'parent' },
            children: [],
          },
        ],
      },
    }
    const direct = buildDirectBindingMap([
      { question_id: 1, node_uid: 'child-a' },
      { question_id: 2, node_uid: 'child-b' },
    ])
    const fullSubtree = buildSubtreeQuestionMap(fullDoc, direct)
    const revealedSubtree = buildSubtreeQuestionMap(revealedOnlyParent, direct)
    expect([...fullSubtree.get('parent')!].sort()).toEqual([1, 2])
    // Reveal-filtered tree under-counts until children appear — hosts must not use it.
    expect([...(revealedSubtree.get('parent') || [])]).toEqual([])
  })

})
