import {
  normalizeMindMapDocument,
  type MindMapDocumentInput,
  type MindMapDocumentV1,
  type MindMapNode,
} from './document'

export const MIND_MAP_TRANSFER_FORMAT = 'memory-anki-mindmap' as const
export const MIND_MAP_TRANSFER_VERSION = 1 as const

export interface MindMapTransferFileV1 {
  format: typeof MIND_MAP_TRANSFER_FORMAT
  version: typeof MIND_MAP_TRANSFER_VERSION
  exportedAt: string
  source: {
    title: string
  }
  document: MindMapDocumentV1
}

interface CreateMindMapTransferFileOptions {
  document: MindMapDocumentInput
  sourceTitle: string
  exportedAt?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeFileNamePart(value: string) {
  const sanitized = Array.from(value.trim(), (character) =>
    character.charCodeAt(0) < 32 ? '-' : character,
  )
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/-+/g, '-')
    .replace(/[-. ]+$/g, '')
  return sanitized || '未命名宫殿'
}

function formatFileNameTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

export function createMindMapTransferFile({
  document,
  sourceTitle,
  exportedAt = new Date().toISOString(),
}: CreateMindMapTransferFileOptions): MindMapTransferFileV1 {
  return {
    format: MIND_MAP_TRANSFER_FORMAT,
    version: MIND_MAP_TRANSFER_VERSION,
    exportedAt,
    source: { title: sourceTitle.trim() },
    document: normalizeMindMapDocument(document),
  }
}

export function serializeMindMapTransferFile(options: CreateMindMapTransferFileOptions) {
  return JSON.stringify(createMindMapTransferFile(options), null, 2)
}

export function parseMindMapTransferFile(content: string): MindMapTransferFileV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('文件不是有效的 JSON。')
  }

  if (!isRecord(parsed) || parsed.format !== MIND_MAP_TRANSFER_FORMAT) {
    throw new Error('这不是 Memory Anki 脑图导出文件。')
  }
  if (parsed.version !== MIND_MAP_TRANSFER_VERSION) {
    throw new Error(`暂不支持脑图文件版本：${String(parsed.version ?? '未知')}。`)
  }
  if (typeof parsed.exportedAt !== 'string' || !parsed.exportedAt.trim()) {
    throw new Error('脑图文件缺少导出时间。')
  }
  if (!isRecord(parsed.source) || typeof parsed.source.title !== 'string') {
    throw new Error('脑图文件缺少来源标题。')
  }
  if (!isRecord(parsed.document) || !isRecord(parsed.document.root)) {
    throw new Error('脑图文件缺少有效的根节点。')
  }

  return {
    format: MIND_MAP_TRANSFER_FORMAT,
    version: MIND_MAP_TRANSFER_VERSION,
    exportedAt: parsed.exportedAt,
    source: { title: parsed.source.title.trim() },
    document: normalizeMindMapDocument(parsed.document),
  }
}

export function countMindMapDocumentNodes(document: MindMapDocumentInput) {
  const countNode = (node: MindMapNode): number =>
    1 + (node.children ?? []).reduce((total, child) => total + countNode(child), 0)
  return countNode(normalizeMindMapDocument(document).root)
}

export function buildMindMapTransferFileName(title: string, date = new Date()) {
  return `${sanitizeFileNamePart(title)}-mindmap-${formatFileNameTimestamp(date)}.json`
}