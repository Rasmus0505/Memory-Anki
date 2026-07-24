import type {
  MindMapDoc,
  MindMapDocNode,
  MindMapImportSourceNode,
  MindMapImportSourceTree,
} from '@/shared/api/contracts'
import { buildEditorDocFromSourceTree } from '@/modules/produce/ui/mindmap-import/model/mindmap-import'

export const MANUAL_MINDMAP_JSON_PROMPT = `你是一个严格输出 JSON 的助手。

任务：把用户提供的内容整理成 Memory Anki 可导入的思维导图 JSON（可带 Anki 正反面角色）。

强制要求：
1. 只输出一个合法 JSON 对象，不要 markdown 代码块，不要解释，不要前后缀。
2. 严格保留原文要点，不要总结删减，不要编造。
3. 按标题 / 编号 / 段落 / 列表建立层级；并列要点拆成并列 children。
4. 顶层格式必须严格为：
{
  "title": "根节点标题",
  "children": [
    {
      "text": "节点文字",
      "ankiRole": "front",
      "children": [
        {
          "text": "反面内容",
          "ankiRole": "back",
          "children": []
        }
      ]
    }
  ]
}
5. 每个节点必须有 text 与 children；无子节点也要 children: []。
6. 节点 text 用完整要点句或原文短句，不要只写“1”“一”“如图”这类无信息占位。
7. 可选字段 ankiRole，取值只能是 "front" | "back" | "none"：
   - "front"：这张卡的正面（提问 / 提示 / 单词）
   - "back"：这张卡的反面（答案 / 释义）；应作为某个 front 的直接子节点
   - "none" 或不写：普通结构节点（分类、章节），不当卡面
8. 一张 Anki 卡 = 一个 front 父节点 + 其直接子节点中的 back（可多个）。
9. 根 title 不要写 ankiRole；分类节点不要伪装成问答。
10. 若输入本身已是 JSON 但格式有误，请修正为上述结构后输出；不要用其它字段替代 text/children/ankiRole。

示例（带正反面）：
{
  "title": "骑士学院",
  "children": [
    {
      "text": "骑士学院设立的目的是什么？",
      "ankiRole": "front",
      "children": [
        {
          "text": "德意志各邦国为了培养文武官员、巩固政治，面向上层贵族子弟设立“骑士学院”。",
          "ankiRole": "back",
          "children": []
        }
      ]
    },
    {
      "text": "骑士学院课程有哪些特点？",
      "ankiRole": "front",
      "children": [
        { "text": "现代外语和自然科学占首要地位。", "ankiRole": "back", "children": [] },
        { "text": "法律、军事、工艺、建筑、机械等课程占很大比重。", "ankiRole": "back", "children": [] }
      ]
    }
  ]
}
`

const MAX_NODE_COUNT = 400
const TRANSFER_FORMAT = 'memory-anki-mindmap'

export type ManualImportFormat =
  | 'source-tree-json'
  | 'transfer-file-json'
  | 'editor-doc-json'
  | 'outline-text'

export interface ManualImportParseSuccess {
  ok: true
  format: ManualImportFormat
  sourceTree: MindMapImportSourceTree
  editorDoc: MindMapDoc
  warnings: string[]
}

export interface ManualImportParseFailure {
  ok: false
  error: string
}

export type ManualImportParseResult = ManualImportParseSuccess | ManualImportParseFailure

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stripCodeFence(value: string): string {
  const text = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!text.startsWith('```')) return text
  const lines = text.split('\n')
  if (lines[0]?.startsWith('```')) lines.shift()
  if (lines[lines.length - 1]?.startsWith('```')) lines.pop()
  return lines.join('\n').trim()
}

function extractFirstJsonObject(value: string): string | null {
  const text = String(value || '')
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function nodeTextFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!isRecord(value)) return ''
  const candidates = [value.text, value.title, value.name, value.label]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  if (isRecord(value.data)) {
    const dataText = value.data.text
    if (typeof dataText === 'string' && dataText.trim()) return dataText.trim()
  }
  return ''
}

function childrenFromUnknown(value: unknown): unknown[] {
  if (!isRecord(value)) return []
  if (Array.isArray(value.children)) return value.children
  if (Array.isArray(value.nodes)) return value.nodes
  if (Array.isArray(value.items)) return value.items
  return []
}

function normalizeAnkiRole(value: unknown): 'front' | 'back' | 'none' | undefined {
  if (value === 'front' || value === 'back' || value === 'none') return value
  return undefined
}

function normalizeSourceNode(value: unknown, counter: { count: number }): MindMapImportSourceNode {
  if (!isRecord(value)) {
    throw new Error('节点结构非法：期望对象。')
  }
  const text = nodeTextFromUnknown(value)
  if (!text) {
    throw new Error('存在空节点文本（每个节点需要 text）。')
  }
  counter.count += 1
  if (counter.count > MAX_NODE_COUNT) {
    throw new Error(`节点过多（超过 ${MAX_NODE_COUNT}），请拆分后再导入。`)
  }
  const children = childrenFromUnknown(value).map((child) => normalizeSourceNode(child, counter))
  const ankiRole = normalizeAnkiRole(value.ankiRole)
  return ankiRole ? { text, ankiRole, children } : { text, children }
}

function normalizeSourceTree(value: unknown): MindMapImportSourceTree {
  if (!isRecord(value)) {
    throw new Error('顶层结构不是对象。')
  }
  const title = nodeTextFromUnknown(value) || (typeof value.title === 'string' ? value.title.trim() : '')
  if (!title) {
    throw new Error('缺少根标题 title。')
  }
  const rawChildren = Array.isArray(value.children)
    ? value.children
    : Array.isArray(value.nodes)
      ? value.nodes
      : []
  if (!Array.isArray(value.children) && !Array.isArray(value.nodes) && !isRecord(value.root)) {
    // allow title-only object with children later
  }
  const counter = { count: 0 }
  const children = rawChildren.map((child) => normalizeSourceNode(child, counter))
  return { title, children }
}

function docNodeToSourceNode(node: MindMapDocNode, counter: { count: number }): MindMapImportSourceNode {
  const text = nodeTextFromUnknown(node)
  if (!text) {
    throw new Error('编辑器文档中存在空节点文本。')
  }
  counter.count += 1
  if (counter.count > MAX_NODE_COUNT) {
    throw new Error(`节点过多（超过 ${MAX_NODE_COUNT}），请拆分后再导入。`)
  }
  const children = (Array.isArray(node.children) ? node.children : []).map((child) =>
    docNodeToSourceNode(child as MindMapDocNode, counter),
  )
  const data = isRecord(node.data) ? node.data : null
  const ankiRole = normalizeAnkiRole(data?.ankiRole)
  return ankiRole ? { text, ankiRole, children } : { text, children }
}

export function sourceTreeFromEditorDoc(doc: MindMapDoc): MindMapImportSourceTree {
  const root = doc.root
  if (!root) {
    throw new Error('编辑器文档缺少 root。')
  }
  const title = nodeTextFromUnknown(root) || '未命名宫殿'
  const counter = { count: 0 }
  const children = (Array.isArray(root.children) ? root.children : []).map((child) =>
    docNodeToSourceNode(child as MindMapDocNode, counter),
  )
  return { title, children }
}

function tryParseJsonCandidates(content: string): unknown[] {
  const candidates: string[] = []
  const seen = new Set<string>()
  const push = (value: string | null | undefined) => {
    const next = String(value || '').trim()
    if (!next || seen.has(next)) return
    seen.add(next)
    candidates.push(next)
  }
  push(content)
  push(stripCodeFence(content))
  push(extractFirstJsonObject(content))
  push(extractFirstJsonObject(stripCodeFence(content)))

  const parsed: unknown[] = []
  for (const candidate of candidates) {
    try {
      parsed.push(JSON.parse(candidate))
    } catch {
      // try next candidate
    }
  }
  return parsed
}

function parseOutlineText(content: string): MindMapImportSourceTree {
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\t/g, '  '))
    .filter((line) => line.trim().length > 0)

  if (lines.length === 0) {
    throw new Error('文本为空，无法解析为脑图。')
  }

  type OutlineNode = { text: string; children: OutlineNode[]; level: number }
  const rootTitle = lines[0].replace(/^#+\s*/, '').replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').trim()
  if (!rootTitle) {
    throw new Error('第一行不能作为根标题。')
  }

  let lastHeadingLevel = 0
  const measureLevel = (line: string) => {
    const markdownHeading = line.match(/^(#+)\s+/)
    if (markdownHeading) {
      lastHeadingLevel = markdownHeading[1].length
      return lastHeadingLevel
    }
    const indent = line.match(/^ */)?.[0].length ?? 0
    // List/plain lines nest under the nearest markdown heading (or root).
    return lastHeadingLevel + 1 + Math.floor(indent / 2)
  }

  const root: OutlineNode = { text: rootTitle, children: [], level: 0 }
  const stack: OutlineNode[] = [root]

  for (const line of lines.slice(1)) {
    const level = measureLevel(line)
    const text = line
      .trim()
      .replace(/^#+\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim()
    if (!text) continue
    const node: OutlineNode = { text, children: [], level }
    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  }

  const counter = { count: 0 }
  const toSource = (node: OutlineNode): MindMapImportSourceNode => {
    counter.count += 1
    if (counter.count > MAX_NODE_COUNT) {
      throw new Error(`节点过多（超过 ${MAX_NODE_COUNT}），请拆分后再导入。`)
    }
    return {
      text: node.text,
      children: node.children.map(toSource),
    }
  }

  return {
    title: root.text,
    children: root.children.map(toSource),
  }
}

function parseJsonObject(value: unknown): ManualImportParseSuccess {
  if (!isRecord(value)) {
    throw new Error('JSON 顶层必须是对象。')
  }

  // Memory Anki transfer file
  if (value.format === TRANSFER_FORMAT) {
    if (!isRecord(value.document) || !isRecord(value.document.root)) {
      throw new Error('脑图导出文件缺少 document.root。')
    }
    const editorDoc = value.document as MindMapDoc
    const sourceTree = sourceTreeFromEditorDoc(editorDoc)
    return {
      ok: true,
      format: 'transfer-file-json',
      sourceTree,
      editorDoc: buildEditorDocFromSourceTree(sourceTree),
      warnings: ['已识别为 Memory Anki 脑图导出文件，将按结构导入为宫殿草稿。'],
    }
  }

  // Editor doc style
  if (isRecord(value.root)) {
    const editorDoc = value as MindMapDoc
    const sourceTree = sourceTreeFromEditorDoc(editorDoc)
    return {
      ok: true,
      format: 'editor-doc-json',
      sourceTree,
      editorDoc: buildEditorDocFromSourceTree(sourceTree),
      warnings: [],
    }
  }

  // { document: { root } }
  if (isRecord(value.document) && isRecord(value.document.root)) {
    const editorDoc = value.document as MindMapDoc
    const sourceTree = sourceTreeFromEditorDoc(editorDoc)
    return {
      ok: true,
      format: 'editor-doc-json',
      sourceTree,
      editorDoc: buildEditorDocFromSourceTree(sourceTree),
      warnings: [],
    }
  }

  // Source tree JSON
  const sourceTree = normalizeSourceTree(value)
  return {
    ok: true,
    format: 'source-tree-json',
    sourceTree,
    editorDoc: buildEditorDocFromSourceTree(sourceTree),
    warnings: [],
  }
}

export function parseManualMindMapImport(content: string): ManualImportParseResult {
  const raw = String(content || '').trim()
  if (!raw) {
    return { ok: false, error: '请先粘贴 JSON 或大纲文本，或选择可解析文件。' }
  }

  const jsonCandidates = tryParseJsonCandidates(raw)
  const errors: string[] = []
  for (const candidate of jsonCandidates) {
    try {
      return parseJsonObject(candidate)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'JSON 结构无效。')
    }
  }

  try {
    const sourceTree = parseOutlineText(raw)
    return {
      ok: true,
      format: 'outline-text',
      sourceTree,
      editorDoc: buildEditorDocFromSourceTree(sourceTree),
      warnings: ['已按缩进/Markdown 大纲解析。若层级不对，可先复制下方提示词到外部 AI 整理成 JSON。'],
    }
  } catch (outlineError) {
    const outlineMessage =
      outlineError instanceof Error ? outlineError.message : '大纲文本无法解析。'
    const jsonMessage = errors[0] || '不是有效的脑图 JSON。'
    return {
      ok: false,
      error: `${jsonMessage}；也未能按大纲解析：${outlineMessage}`,
    }
  }
}

export function parseManualMindMapImportFile(fileName: string, content: string): ManualImportParseResult {
  const name = fileName.toLowerCase()
  const allowed =
    name.endsWith('.json') ||
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    name.endsWith('.markdown') ||
    name.endsWith('.mindmap.json')
  if (!allowed) {
    return {
      ok: false,
      error: '暂支持 .json / .txt / .md 文件。JSON 可为 source-tree、编辑器文档或 Memory Anki 导出格式。',
    }
  }
  return parseManualMindMapImport(content)
}
