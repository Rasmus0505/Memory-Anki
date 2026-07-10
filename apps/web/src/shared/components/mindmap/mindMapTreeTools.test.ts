import { describe, expect, it } from 'vitest'
import { auditMindMapEditorDoc, searchMindMapEditorDoc } from './mindMapTreeTools'

const doc = {
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

describe('mindMapTreeTools', () => {
  it('searches title and note with ancestor paths', () => {
    expect(searchMindMapEditorDoc(doc, '生命')[0]).toMatchObject({ nodeUid: 'cell', path: ['生物学', '细胞'] })
    expect(searchMindMapEditorDoc(doc, '线粒体')[0].ancestorUids).toEqual(['root', 'cell'])
  })

  it('reports deterministic structure issues', () => {
    const kinds = auditMindMapEditorDoc(doc).map((issue) => issue.kind)
    expect(kinds).toContain('empty')
    expect(kinds).toContain('duplicate-title')
  })
})
