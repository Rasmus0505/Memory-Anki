import { describe, expect, it } from 'vitest'
import { buildSubtreeUidMap } from './subtree'

describe('buildSubtreeUidMap', () => {
  it('indexes each identified node with its identified descendants', () => {
    const result = buildSubtreeUidMap({
      root: {
        data: { uid: 'root' },
        children: [
          { data: { uid: 'branch' }, children: [{ data: { uid: 'leaf' } }] },
          { data: { text: 'wrapper' }, children: [{ data: { uid: 'nested' } }] },
        ],
      },
    })

    expect(result.get('root')).toEqual(['root', 'branch', 'leaf', 'nested'])
    expect(result.get('branch')).toEqual(['branch', 'leaf'])
    expect(result.get('leaf')).toEqual(['leaf'])
    expect(result.get('nested')).toEqual(['nested'])
  })

  it('ignores missing documents and nodes without stable uids', () => {
    expect(buildSubtreeUidMap(null)).toEqual(new Map())
    expect(buildSubtreeUidMap({ root: { data: { text: 'root' } } })).toEqual(new Map())
  })
})
