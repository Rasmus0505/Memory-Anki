import { describe, expect, it } from 'vitest'
import {
  addMindMapChildWithResult,
  addMindMapSiblingWithResult,
  auditMindMapDocument,
  countMindMapSubtree,
  deleteMindMapNodeOnly,
  normalizeMindMapDocument,
  searchMindMapDocument,
} from './document'

const document = {
  root: {
    data: { uid: 'root', text: '生物学' },
    children: [
      { data: { uid: 'cell', text: '细胞', note: '生命基本单位' }, children: [{ data: { uid: 'mito', text: '线粒体' }, children: [] }] },
      { data: { uid: 'empty', text: '' }, children: [] },
      { data: { uid: 'dup1', text: '遗传' }, children: [] },
      { data: { uid: 'dup2', text: ' 遗传 ' }, children: [] },
    ],
  },
}

describe('mind-map document entity', () => {
  it('normalizes legacy documents to schema version 1', () => {
    expect(normalizeMindMapDocument(document).schemaVersion).toBe(1)
  })

  it('searches and audits without UI dependencies', () => {
    expect(searchMindMapDocument(document, '生命')[0]).toMatchObject({ nodeUid: 'cell' })
    expect(auditMindMapDocument(document).map((issue) => issue.kind)).toEqual(expect.arrayContaining(['empty', 'duplicate-title']))
  })

  it('applies structural commands immutably', () => {
    const child = addMindMapChildWithResult(document, 'cell')
    const sibling = addMindMapSiblingWithResult(child.document, 'cell')
    const deleted = deleteMindMapNodeOnly(sibling.document, 'cell')
    expect(child.nodeUid).toBeTruthy()
    expect(sibling.nodeUid).toBeTruthy()
    expect(countMindMapSubtree(deleted, 'cell')).toBe(0)
    expect(document.root.children).toHaveLength(4)
  })
})
