import { describe, expect, it } from 'vitest'
import {
  buildEditorParentMap,
  buildSplitMarkStatusChips,
  collectPermanentMarkUids,
  collectRootUid,
  derivePermanentMarkLevels,
  deriveSplitMarkLevels,
  togglePermanentMarkInDoc,
  type EditorDoc,
} from '@/shared/lib/mindmap-split-marks/splitMarks'

function sampleDoc(): EditorDoc {
  return {
    root: {
      data: { uid: 'root', text: 'Root' },
      children: [
        {
          data: { uid: 'a', text: 'A' },
          children: [
            {
              data: { uid: 'a1', text: 'A1' },
              children: [{ data: { uid: 'a1x', text: 'A1X' }, children: [] }],
            },
          ],
        },
        {
          data: { uid: 'b', text: 'B', permanentSplitMark: true },
          children: [],
        },
      ],
    },
  }
}

describe('splitMarks levels', () => {
  it('derives L1/L2/L3 from marked ancestors and ignores root', () => {
    const doc = sampleDoc()
    const parentMap = buildEditorParentMap(doc)
    const rootUid = collectRootUid(doc)
    const levels = derivePermanentMarkLevels(['root', 'a', 'a1', 'a1x'], parentMap, rootUid)
    expect(levels.get('root')).toBeUndefined()
    expect(levels.get('a')).toBe(1)
    expect(levels.get('a1')).toBe(2)
    expect(levels.get('a1x')).toBe(3)
  })

  it('exports deriveSplitMarkLevels as the same function', () => {
    expect(deriveSplitMarkLevels).toBe(derivePermanentMarkLevels)
  })

  it('builds L-label chips with level tones', () => {
    const doc = sampleDoc()
    const parentMap = buildEditorParentMap(doc)
    const chips = buildSplitMarkStatusChips(['a', 'a1'], parentMap, 'root')
    expect(chips.a?.[0]?.text).toBe('L1')
    expect(chips.a?.[0]?.tone).toBe('warning')
    expect(chips.a1?.[0]?.text).toBe('L2')
    expect(chips.a1?.[0]?.tone).toBe('info')
  })

  it('collects and toggles permanentSplitMark flags', () => {
    const doc = sampleDoc()
    expect(collectPermanentMarkUids(doc)).toEqual(['b'])
    const toggled = togglePermanentMarkInDoc(doc, 'a')
    expect(toggled.marked).toBe(true)
    expect(collectPermanentMarkUids(toggled.doc).sort()).toEqual(['a', 'b'])
    const cleared = togglePermanentMarkInDoc(toggled.doc, 'b')
    expect(cleared.marked).toBe(false)
    expect(collectPermanentMarkUids(cleared.doc)).toEqual(['a'])
  })

  it('accepts editor_doc JSON strings (unit-review session shape)', () => {
    const raw = JSON.stringify(sampleDoc())
    expect(collectPermanentMarkUids(raw)).toEqual(['b'])
    const chips = buildSplitMarkStatusChips(
      collectPermanentMarkUids(raw),
      buildEditorParentMap(raw),
      collectRootUid(raw),
    )
    expect(chips.b?.[0]?.text).toBe('L1')
    const toggled = togglePermanentMarkInDoc(raw, 'a')
    expect(toggled.marked).toBe(true)
    expect(collectPermanentMarkUids(toggled.doc).sort()).toEqual(['a', 'b'])
  })
})
