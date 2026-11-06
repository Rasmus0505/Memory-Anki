import { describe, expect, it } from 'vitest'
import { findSuccessorCardByContent } from './freestyleCardSuccessor'

function branch(
  id: string,
  {
    palaceId = 1,
    anchorUid = id,
    nodeUids = [],
  }: { palaceId?: number; anchorUid?: string; nodeUids?: string[] } = {},
) {
  return {
    id,
    type: 'mindmap_branch',
    palace_id: palaceId,
    anchor_uid: anchorUid,
    node_uids: nodeUids,
  }
}

describe('findSuccessorCardByContent', () => {
  it('follows an unmarked child into the residual unit that now owns its node', () => {
    const residual = branch('review_unit:residual:r1', {
      anchorUid: 'palace-root',
      nodeUids: ['b1', 'b1a', 'b2'],
    })
    const sibling = branch('review_unit:b2:r1', { nodeUids: ['b2'] })

    expect(
      findSuccessorCardByContent([sibling, residual], {
        palaceId: 1,
        anchorUid: 'b1',
        nodeUids: ['b1', 'b1a'],
      }),
    ).toBe(residual)
  })

  it('follows a root mark flip by the shared anchor', () => {
    const residual = branch('review_unit:residual:r1', {
      anchorUid: 'palace-root',
      nodeUids: ['a', 'b'],
    })
    const child = branch('review_unit:a:r1', { nodeUids: ['a'] })

    expect(
      findSuccessorCardByContent([child, residual], {
        palaceId: 1,
        anchorUid: 'palace-root',
        nodeUids: ['a', 'b'],
      }),
    ).toBe(residual)
  })

  it('does not treat a split into two units as a continuation', () => {
    const left = branch('review_unit:left:r1', { nodeUids: ['x'] })
    const right = branch('review_unit:right:r1', { nodeUids: ['y'] })

    expect(
      findSuccessorCardByContent([left, right], {
        palaceId: 1,
        anchorUid: 'deleted-anchor',
        nodeUids: ['x', 'y'],
      }),
    ).toBeNull()
  })

  it('ignores retry copies of the merged unit', () => {
    const source = branch('review_unit:residual:r1', {
      anchorUid: 'palace-root',
      nodeUids: ['b1', 'b2'],
    })
    const retry = {
      ...branch('retry:review_unit:residual:r1:1', {
        anchorUid: 'palace-root',
        nodeUids: ['b1', 'b2'],
      }),
      occurrence_kind: 'retry',
    }

    expect(
      findSuccessorCardByContent([retry, source], {
        palaceId: 1,
        anchorUid: 'b1',
        nodeUids: ['b1'],
      }),
    ).toBe(source)
  })

  it('never crosses into another palace', () => {
    const otherPalace = branch('review_unit:other:r1', {
      palaceId: 2,
      anchorUid: 'palace-root',
      nodeUids: ['b1'],
    })

    expect(
      findSuccessorCardByContent([otherPalace], {
        palaceId: 1,
        anchorUid: 'b1',
        nodeUids: ['b1'],
      }),
    ).toBeNull()
  })

  it('falls back to dominant node overlap when the anchor node was deleted', () => {
    const residual = branch('review_unit:residual:r1', {
      anchorUid: 'palace-root',
      nodeUids: ['x', 'y', 'z'],
    })
    const other = branch('review_unit:other:r1', { nodeUids: ['q'] })

    expect(
      findSuccessorCardByContent([other, residual], {
        palaceId: 1,
        anchorUid: 'deleted-anchor',
        nodeUids: ['x', 'y'],
      }),
    ).toBe(residual)
  })
})
