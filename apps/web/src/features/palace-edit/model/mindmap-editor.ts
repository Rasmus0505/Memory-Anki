import {
  countEditorDocNodes,
  fingerprintEditorDoc,
} from '@/shared/lib/applyProgrammaticEditorState'
import type {
  MindMapDoc,
  MindMapDocNode,
  MindMapEditorState,
} from '@/shared/api/contracts'

export type RangeTarget = number | 'new' | null
export type MindMapDisplayMode = 'edit' | 'preview' | 'recall'
export type EditorMode = MindMapDisplayMode

export function parseMindMapDoc(value: unknown): MindMapDoc | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? (parsed as MindMapDoc) : null
    } catch {
      return null
    }
  }
  return typeof value === 'object' ? (value as MindMapDoc) : null
}

export function buildMindMapImportValidationFingerprint(
  editorDoc: MindMapEditorState['editor_doc'],
  palaceTitle: string,
) {
  const parsedDoc = parseMindMapDoc(editorDoc)
  if (!parsedDoc?.root || typeof parsedDoc.root !== 'object') {
    return fingerprintEditorDoc(editorDoc)
  }

  try {
    const comparableDoc = structuredClone(parsedDoc) as MindMapDoc

    const visit = (node: MindMapDocNode | null | undefined, isRoot = false) => {
      if (!node || typeof node !== 'object') return
      const currentData = node.data && typeof node.data === 'object' ? node.data : {}
      const nextData = { ...currentData }
      delete nextData.uid
      delete nextData.memoryAnkiId
      delete nextData.memoryAnkiNodeType
      if (isRoot) {
        nextData.text = palaceTitle || String(nextData.text ?? '')
        nextData.memoryAnkiRootKind = 'palace'
      } else {
        delete nextData.memoryAnkiRootKind
      }
      node.data = nextData

      const children = Array.isArray(node.children) ? node.children : []
      node.children = children
      children.forEach((child) => visit(child, false))
    }

    visit(comparableDoc.root, true)
    return fingerprintEditorDoc(comparableDoc)
  } catch {
    return fingerprintEditorDoc(editorDoc)
  }
}

export function buildSubtreeUidMap(doc: MindMapDoc | null) {
  const subtreeMap = new Map<string, string[]>()

  const walk = (node: MindMapDocNode | null | undefined): string[] => {
    if (!node || typeof node !== 'object') return []
    const ownUid =
      node.data && typeof node.data === 'object' && typeof node.data.uid === 'string'
        ? node.data.uid
        : null
    const childUids = (Array.isArray(node.children) ? node.children : []).flatMap((child) => walk(child))
    const subtreeUids = ownUid ? [ownUid, ...childUids] : childUids
    if (ownUid) {
      subtreeMap.set(ownUid, Array.from(new Set(subtreeUids)))
    }
    return subtreeUids
  }

  walk(doc?.root)
  return subtreeMap
}

export function uniqueStrings(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).filter(Boolean)))
}

export function getEarlierDateTime(left: string | null, right: string | null) {
  if (!left) return right
  if (!right) return left
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right
}

export function buildImportExpectedNodeCount(editorDoc: MindMapEditorState['editor_doc']) {
  return countEditorDocNodes(editorDoc)
}
