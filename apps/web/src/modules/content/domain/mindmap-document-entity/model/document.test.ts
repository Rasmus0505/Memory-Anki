import { describe, expect, it } from 'vitest'
import {
  addMindMapChildWithResult,
  addMindMapSiblingWithResult,
  auditMindMapDocument,
  countMindMapSubtree,
  deleteMindMapNodeOnly,
  deleteMindMapNodes,
  extractMindMapSelectionWithResult,
  getMindMapNodeText,
  getMindMapMarkColor,
  highlightMindMapNodes,
  setMindMapMarkColors,
  isMindMapQuestionCard,
  normalizeMindMapDocument,
  relocateMindMapNode,
  relocateMindMapNodes,
  searchMindMapDocument,
  selectMindMapNode,
  setMindMapQuestionCards,
  type MindMapDocumentV1,
} from './document'

const document: MindMapDocumentV1 = {
  schemaVersion: 1,
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

  it('cuts a live text selection into a new child card', () => {
    const liveText = '细胞膜与细胞质'
    const result = extractMindMapSelectionWithResult(
      document,
      'cell',
      liveText,
      0,
      3,
      { mode: 'inside', targetUid: 'cell' },
    )
    expect(result.extractedText).toBe('细胞膜')
    expect(result.nodeUid).toBeTruthy()
    expect(selectMindMapNode(result.document, 'cell')[0]?.text).toBe('与细胞质')
    expect(getMindMapNodeText(
      result.document.root.children!.find((node) => node.data?.uid === 'cell')!.children!.at(-1)!,
    )).toBe('细胞膜')
    expect(document.root.children![0].data?.text).toBe('细胞')
  })

  it('inserts extracted text as a sibling before the target', () => {
    const result = extractMindMapSelectionWithResult(
      document,
      'cell',
      '前缀_目标内容_后缀',
      3,
      7,
      { mode: 'before', targetUid: 'mito' },
    )
    expect(result.extractedText).toBe('目标内容')
    const cellChildren = result.document.root.children!.find((node) => node.data?.uid === 'cell')!.children!
    expect(cellChildren.map((node) => node.data?.text)).toEqual(['目标内容', '线粒体'])
  })

  it('cancels when the selection is empty or whitespace', () => {
    const result = extractMindMapSelectionWithResult(
      document,
      'cell',
      '细胞  结构',
      2,
      4,
      { mode: 'inside', targetUid: 'root' },
    )
    expect(result.nodeUid).toBeNull()
    expect(result.extractedText).toBeNull()
  })

  it('marks full card text as yellow emphasis for multi-select nodes', () => {
    const result = highlightMindMapNodes(document, ['cell', 'mito', 'empty'])
    expect(result.count).toBe(2)
    const cell = result.document.root.children!.find((node) => node.data?.uid === 'cell')!
    const mito = cell.children!.find((node) => node.data?.uid === 'mito')!
    expect(String(cell.data?.text)).toContain('data-emphasis="highlight"')
    expect(String(cell.data?.text)).toContain('细胞')
    expect(cell.data?.richText).toBe(true)
    expect(String(mito.data?.text)).toContain('线粒体')
    expect(getMindMapNodeText(cell)).toBe('细胞')
    // Original document stays untouched.
    expect(document.root.children![0].data?.text).toBe('细胞')
  })

  it('sets and clears markColor on multi-select nodes including root', () => {
    const painted = setMindMapMarkColors(document, ['cell', 'mito', 'root', 'missing'], '#FECACA')
    expect(painted.count).toBe(3)
    const cell = painted.document.root.children!.find((node) => node.data?.uid === 'cell')!
    const mito = cell.children!.find((node) => node.data?.uid === 'mito')!
    expect(getMindMapMarkColor(cell)).toBe('#fecaca')
    expect(getMindMapMarkColor(mito)).toBe('#fecaca')
    expect(getMindMapMarkColor(painted.document.root)).toBe('#fecaca')

    const same = setMindMapMarkColors(painted.document, ['cell'], '#fecaca')
    expect(same.count).toBe(0)

    const cleared = setMindMapMarkColors(painted.document, ['cell', 'root'], null)
    expect(cleared.count).toBe(2)
    const clearedCell = cleared.document.root.children!.find((node) => node.data?.uid === 'cell')!
    expect(getMindMapMarkColor(clearedCell)).toBeNull()
    expect(getMindMapMarkColor(cleared.document.root)).toBeNull()
    expect(getMindMapMarkColor(cleared.document.root.children![0].children![0])).toBe('#fecaca')
    // Original document stays untouched.
    expect(document.root.children![0].data?.markColor).toBeUndefined()
  })

  it('sets and clears question-card flags on non-root multi-select nodes', () => {
    const enabled = setMindMapQuestionCards(document, ['cell', 'mito', 'root', 'missing'], true)
    expect(enabled.count).toBe(2)
    const cell = enabled.document.root.children!.find((node) => node.data?.uid === 'cell')!
    const mito = cell.children!.find((node) => node.data?.uid === 'mito')!
    expect(isMindMapQuestionCard(cell)).toBe(true)
    expect(isMindMapQuestionCard(mito)).toBe(true)
    expect(enabled.document.root.data?.memoryAnkiQuestionCard).toBeUndefined()

    const again = setMindMapQuestionCards(enabled.document, ['cell', 'mito'], true)
    expect(again.count).toBe(0)

    const cleared = setMindMapQuestionCards(enabled.document, ['cell'], false)
    expect(cleared.count).toBe(1)
    const clearedCell = cleared.document.root.children!.find((node) => node.data?.uid === 'cell')!
    expect(isMindMapQuestionCard(clearedCell)).toBe(false)
    expect(document.root.children![0].data?.memoryAnkiQuestionCard).toBeUndefined()
  })

  it('reparents a node as the last child when relocating inside', () => {
    const next = relocateMindMapNode(document, 'empty', 'cell', 'inside')
    const cell = next.root.children!.find((node) => node.data?.uid === 'cell')!
    expect(cell.children!.map((node) => node.data?.uid)).toEqual(['mito', 'empty'])
    expect(next.root.children!.map((node) => node.data?.uid)).toEqual(['cell', 'dup1', 'dup2'])
  })

  it('moves a node across parents as a sibling when relocating before/after', () => {
    const next = relocateMindMapNode(document, 'empty', 'mito', 'before')
    const cell = next.root.children!.find((node) => node.data?.uid === 'cell')!
    expect(cell.children!.map((node) => node.data?.uid)).toEqual(['empty', 'mito'])
    expect(next.root.children!.map((node) => node.data?.uid)).toEqual(['cell', 'dup1', 'dup2'])
  })

  it('rejects relocating a node into its own descendant', () => {
    const next = relocateMindMapNode(document, 'cell', 'mito', 'inside')
    expect(next.root.children!.map((node) => node.data?.uid)).toEqual(['cell', 'empty', 'dup1', 'dup2'])
    const cell = next.root.children!.find((node) => node.data?.uid === 'cell')!
    expect(cell.children!.map((node) => node.data?.uid)).toEqual(['mito'])
  })

  it('moves only top-level selected nodes when batch relocating', () => {
    const next = relocateMindMapNodes(document, ['cell', 'mito', 'dup1'], 'empty', 'inside')
    const empty = next.root.children!.find((node) => node.data?.uid === 'empty')!
    // cell already contains mito; only cell and dup1 move as top-level sources.
    expect(empty.children!.map((node) => node.data?.uid)).toEqual(['cell', 'dup1'])
    expect(empty.children![0].children!.map((node) => node.data?.uid)).toEqual(['mito'])
    expect(next.root.children!.map((node) => node.data?.uid)).toEqual(['empty', 'dup2'])
  })

  it('deletes multiple non-root nodes deepest-first', () => {
    const next = deleteMindMapNodes(document, ['mito', 'cell', 'dup2'])
    expect(next.root.children!.map((node) => node.data?.uid)).toEqual(['empty', 'dup1'])
  })
})
