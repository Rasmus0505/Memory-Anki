import type { MindMapDocNode, MindMapEditorState } from '@/shared/api/contracts'
import { normalizeEditorDocTree } from './editorDocAdapter'

export interface MindMapSearchResult {
  nodeUid: string
  text: string
  note: string
  path: string[]
  ancestorUids: string[]
}

export type MindMapStructureIssueKind = 'empty' | 'long-text' | 'wide-siblings' | 'deep-chain' | 'duplicate-title'

export interface MindMapStructureIssue {
  kind: MindMapStructureIssueKind
  nodeUid: string
  message: string
  path: string[]
}

function uidOf(node: MindMapDocNode, fallback: string) {
  return String(node.data?.uid ?? node.data?.memoryAnkiId ?? fallback)
}

function textOf(node: MindMapDocNode) {
  return String(node.data?.text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function noteOf(node: MindMapDocNode) {
  return String(node.data?.note ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function searchMindMapEditorDoc(editorDoc: MindMapEditorState['editor_doc'], query: string): MindMapSearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []
  const doc = normalizeEditorDocTree(editorDoc)
  const results: MindMapSearchResult[] = []
  const walk = (node: MindMapDocNode, path: string[], ancestorUids: string[], fallback: string) => {
    const uid = uidOf(node, fallback)
    const text = textOf(node)
    const note = noteOf(node)
    const nextPath = [...path, text || '未命名知识点']
    if (`${text}\n${note}`.toLocaleLowerCase().includes(normalizedQuery)) {
      results.push({ nodeUid: uid, text, note, path: nextPath, ancestorUids })
    }
    ;(node.children ?? []).forEach((child, index) => walk(child, nextPath, [...ancestorUids, uid], `${fallback}-${index}`))
  }
  walk(doc.root!, [], [], 'root')
  return results
}

export function auditMindMapEditorDoc(editorDoc: MindMapEditorState['editor_doc']): MindMapStructureIssue[] {
  const doc = normalizeEditorDocTree(editorDoc)
  const issues: MindMapStructureIssue[] = []
  const normalizeTitle = (value: string) => value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
  const walk = (node: MindMapDocNode, path: string[], fallback: string, singleChainDepth: number) => {
    const uid = uidOf(node, fallback)
    const text = textOf(node)
    const nextPath = [...path, text || '未命名知识点']
    if (!text) issues.push({ kind: 'empty', nodeUid: uid, message: '节点标题为空', path: nextPath })
    if (text.length > 80) issues.push({ kind: 'long-text', nodeUid: uid, message: `节点标题 ${text.length} 字，建议拆分`, path: nextPath })
    const children = node.children ?? []
    if (children.length > 12) issues.push({ kind: 'wide-siblings', nodeUid: uid, message: `同级包含 ${children.length} 个节点，建议分组`, path: nextPath })
    const nextChainDepth = children.length === 1 ? singleChainDepth + 1 : 0
    if (nextChainDepth > 5) issues.push({ kind: 'deep-chain', nodeUid: uid, message: '连续单链超过 5 层，建议压缩层级', path: nextPath })
    const seen = new Map<string, string>()
    children.forEach((child, index) => {
      const childText = textOf(child)
      const key = normalizeTitle(childText)
      if (key && seen.has(key)) {
        issues.push({ kind: 'duplicate-title', nodeUid: uidOf(child, `${fallback}-${index}`), message: `与同级节点“${seen.get(key)}”标题重复`, path: [...nextPath, childText] })
      } else if (key) {
        seen.set(key, childText)
      }
    })
    children.forEach((child, index) => walk(child, nextPath, `${fallback}-${index}`, nextChainDepth))
  }
  walk(doc.root!, [], 'root', 0)
  return issues
}
