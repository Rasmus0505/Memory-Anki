import { describe, expect, it } from 'vitest'
import {
  applyQuizQuestionMarkToBindings,
  buildBoundQuestionFacts,
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

  it('splits objective and subjective totals and does not shrink them when questions are completed', () => {
    const bindings = [
      { question_id: 1, node_uid: 'child-a', question_type: 'multiple_choice', marked: true },
      { question_id: 2, node_uid: 'child-b', question_type: 'short_answer', marked: false },
      { question_id: 3, node_uid: 'child-a', question_type: 'true_false', marked: false },
    ]
    const direct = buildDirectBindingMap(bindings)
    const subtree = buildSubtreeQuestionMap(doc, direct)
    const facts = buildBoundQuestionFacts(bindings)
    const badges = buildCountBadgeByNodeUid(subtree, facts)

    expect(badges.parent).toEqual([
      {
        text: '1',
        tone: 'info',
        title: '主观 1 道（含子树）',
        kind: 'subjective',
      },
      {
        text: '2',
        tone: 'rose',
        title: '客观 2 道，含标记题（含子树）',
        kind: 'objective',
      },
    ])
    expect(badges['child-a']).toEqual([
      {
        text: '2',
        tone: 'rose',
        title: '客观 2 道，含标记题（含子树）',
        kind: 'objective',
      },
    ])
    expect(badges['child-b']).toEqual([
      {
        text: '1',
        tone: 'info',
        title: '主观 1 道（含子树）',
        kind: 'subjective',
      },
    ])
    expect(badges.parent.map((badge) => badge.text).join('+')).toBe('1+2')
    expect(firstIncompleteQuestionIndex([1, 2, 3], new Set([1]))).toBe(1)
    expect(firstIncompleteQuestionIndex([1, 2], new Set([1, 2]))).toBe(0)
  })

  it('turns only the subjective badge rose when a short-answer question is marked', () => {
    const bindings = [
      { question_id: 1, node_uid: 'child-a', question_type: 'multiple_choice', marked: false },
      { question_id: 2, node_uid: 'child-b', question_type: 'short_answer', marked: false },
    ]
    const marked = applyQuizQuestionMarkToBindings(bindings, 2, true)
    expect(marked).not.toBe(bindings)
    expect(applyQuizQuestionMarkToBindings(marked, 2, true)).toBe(marked)
    const subtree = buildSubtreeQuestionMap(doc, buildDirectBindingMap(marked))
    const badges = buildCountBadgeByNodeUid(subtree, buildBoundQuestionFacts(marked))
    expect(badges.parent?.find((badge) => badge.kind === 'objective')?.tone).toBe('success')
    expect(badges.parent?.find((badge) => badge.kind === 'subjective')).toMatchObject({
      text: '1',
      tone: 'rose',
      kind: 'subjective',
    })
    expect(
      getQuestionIdsForNode(subtree, 'parent', new Set(), {
        includeCompleted: true,
        kind: 'objective',
        facts: buildBoundQuestionFacts(marked),
      }),
    ).toEqual([1])
    expect(
      getQuestionIdsForNode(subtree, 'parent', new Set(), {
        includeCompleted: true,
        kind: 'subjective',
        facts: buildBoundQuestionFacts(marked),
      }),
    ).toEqual([2])
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
