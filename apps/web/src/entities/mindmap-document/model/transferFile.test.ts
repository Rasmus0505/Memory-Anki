import { describe, expect, it } from 'vitest'
import {
  buildMindMapTransferFileName,
  countMindMapDocumentNodes,
  parseMindMapTransferFile,
  serializeMindMapTransferFile,
} from './transferFile'

describe('mind-map transfer files', () => {
  it('serializes and parses a normalized document without persistence state', () => {
    const content = serializeMindMapTransferFile({
      document: {
        root: {
          data: { text: '导出脑图' },
          children: [{ data: { text: '知识点' }, children: [] }],
        },
      },
      sourceTitle: ' 测试宫殿 ',
      exportedAt: '2026-07-14T07:30:00.000Z',
    })

    const parsed = parseMindMapTransferFile(content)

    expect(parsed).toMatchObject({
      format: 'memory-anki-mindmap',
      version: 1,
      exportedAt: '2026-07-14T07:30:00.000Z',
      source: { title: '测试宫殿' },
      document: {
        schemaVersion: 1,
        layout: 'mindMap',
        theme: { template: 'default', config: {} },
      },
    })
    expect(parsed.document.root.data?.uid).toBeTruthy()
    expect(parsed.document.root.children?.[0]?.data?.uid).toBeTruthy()
    expect(content).not.toContain('revision')
    expect(content).not.toContain('localPreferences')
    expect(countMindMapDocumentNodes(parsed.document)).toBe(2)
  })

  it.each([
    ['not-json', '文件不是有效的 JSON。'],
    [JSON.stringify({ format: 'other', version: 1 }), '这不是 Memory Anki 脑图导出文件。'],
    [
      JSON.stringify({
        format: 'memory-anki-mindmap',
        version: 2,
        exportedAt: '2026-07-14T07:30:00.000Z',
        source: { title: '测试' },
        document: { root: {} },
      }),
      '暂不支持脑图文件版本：2。',
    ],
    [
      JSON.stringify({
        format: 'memory-anki-mindmap',
        version: 1,
        exportedAt: '2026-07-14T07:30:00.000Z',
        source: { title: '测试' },
        document: {},
      }),
      '脑图文件缺少有效的根节点。',
    ],
  ])('rejects invalid content', (content, message) => {
    expect(() => parseMindMapTransferFile(content)).toThrow(message)
  })

  it('builds a Windows-safe timestamped file name', () => {
    expect(buildMindMapTransferFileName(' 测试:宫殿? ', new Date(2026, 6, 14, 15, 30, 8))).toBe(
      '测试-宫殿-mindmap-20260714-153008.json',
    )
  })
})