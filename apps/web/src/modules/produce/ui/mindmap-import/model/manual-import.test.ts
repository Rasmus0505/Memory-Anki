import { describe, expect, it } from 'vitest'
import {
  parseManualMindMapImport,
  parseManualMindMapImportFile,
  sourceTreeFromEditorDoc,
} from '@/modules/produce/ui/mindmap-import/model/manual-import'

describe('manual mindmap import parser', () => {
  it('parses source-tree JSON', () => {
    const result = parseManualMindMapImport(
      JSON.stringify({
        title: '骑士学院',
        children: [
          { text: '目的', children: [{ text: '培养官员', children: [] }] },
          { text: '课程', children: [] },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('source-tree-json')
    expect(result.sourceTree.title).toBe('骑士学院')
    expect(result.sourceTree.children).toHaveLength(2)
    expect(result.editorDoc.root?.data?.text).toBe('骑士学院')
    expect(result.editorDoc.root?.children).toHaveLength(2)
  })

  it('parses source-tree JSON with ankiRole and writes it into editor doc', () => {
    const result = parseManualMindMapImport(
      JSON.stringify({
        title: '骑士学院',
        children: [
          {
            text: '骑士学院设立的目的是什么？',
            ankiRole: 'front',
            children: [
              {
                text: '培养文武官员、巩固政治。',
                ankiRole: 'back',
                children: [],
              },
            ],
          },
          {
            text: '分类节点（不标角色）',
            children: [],
          },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sourceTree.children[0]).toMatchObject({
      text: '骑士学院设立的目的是什么？',
      ankiRole: 'front',
    })
    expect(result.sourceTree.children[0]?.children[0]).toMatchObject({
      text: '培养文武官员、巩固政治。',
      ankiRole: 'back',
    })
    expect(result.sourceTree.children[1]?.ankiRole).toBeUndefined()
    expect(result.editorDoc.root?.children?.[0]?.data).toMatchObject({
      text: '骑士学院设立的目的是什么？',
      ankiRole: 'front',
    })
    expect(result.editorDoc.root?.children?.[0]?.children?.[0]?.data).toMatchObject({
      text: '培养文武官员、巩固政治。',
      ankiRole: 'back',
    })
    expect(result.editorDoc.root?.children?.[1]?.data?.ankiRole).toBeUndefined()
  })

  it('ignores invalid ankiRole values', () => {
    const result = parseManualMindMapImport(
      JSON.stringify({
        title: '根',
        children: [{ text: '节点', ankiRole: 'side', children: [] }],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sourceTree.children[0]?.ankiRole).toBeUndefined()
    expect(result.editorDoc.root?.children?.[0]?.data?.ankiRole).toBeUndefined()
  })

  it('parses fenced JSON and transfer file format', () => {
    const transfer = {
      format: 'memory-anki-mindmap',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      source: { title: '导出宫殿' },
      document: {
        root: {
          data: { text: '导出宫殿' },
          children: [{ data: { text: 'A' }, children: [] }],
        },
      },
    }
    const result = parseManualMindMapImport(`\`\`\`json\n${JSON.stringify(transfer)}\n\`\`\``)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('transfer-file-json')
    expect(result.sourceTree.title).toBe('导出宫殿')
    expect(result.sourceTree.children[0]?.text).toBe('A')
  })

  it('parses editor-doc JSON', () => {
    const result = parseManualMindMapImport(
      JSON.stringify({
        root: {
          data: { text: '根' },
          children: [{ data: { text: '子节点' }, children: [] }],
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('editor-doc-json')
    expect(result.sourceTree.children[0]?.text).toBe('子节点')
  })

  it('parses markdown/indented outline text', () => {
    const result = parseManualMindMapImport(`# 近代教育
## 德国
- 骑士学院
  - 目的
  - 课程
## 法国
- 中央集权`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe('outline-text')
    expect(result.sourceTree.title).toBe('近代教育')
    expect(result.sourceTree.children.map((item) => item.text)).toEqual(['德国', '法国'])
  })

  it('rejects empty content', () => {
    const result = parseManualMindMapImport('   ')
    expect(result.ok).toBe(false)
    if (result.ok !== false) return
    expect(result.error).toContain('请先粘贴')
  })

  it('rejects unsupported file extensions', () => {
    const result = parseManualMindMapImportFile('note.pdf', '{"title":"A","children":[]}')
    expect(result.ok).toBe(false)
  })

  it('accepts json file content', () => {
    const result = parseManualMindMapImportFile(
      'draft.json',
      '{"title":"A","children":[{"text":"B","children":[]}]}',
    )
    expect(result.ok).toBe(true)
  })

  it('builds source tree from editor doc', () => {
    const tree = sourceTreeFromEditorDoc({
      root: {
        data: { text: 'Root' },
        children: [{ data: { text: 'Child' }, children: [] }],
      },
    })
    expect(tree).toEqual({
      title: 'Root',
      children: [{ text: 'Child', children: [] }],
    })
  })

  it('preserves ankiRole when converting editor doc to source tree', () => {
    const tree = sourceTreeFromEditorDoc({
      root: {
        data: { text: 'Root' },
        children: [
          {
            data: { text: '正面', ankiRole: 'front' },
            children: [{ data: { text: '反面', ankiRole: 'back' }, children: [] }],
          },
        ],
      },
    })
    expect(tree).toEqual({
      title: 'Root',
      children: [
        {
          text: '正面',
          ankiRole: 'front',
          children: [{ text: '反面', ankiRole: 'back', children: [] }],
        },
      ],
    })
  })
})
