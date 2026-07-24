import type {
  MindMapEditorState,
  MindMapDoc,
  MindMapDocNode,
  MindMapImportSourceNode,
  MindMapImportSourceTree,
} from '@/shared/api/contracts'
import { formatKnowledgeImportError } from '@/modules/produce/domain/knowledge-import-entity/model/importError'
import {
  applyEmphasisMarksToHtml,
  sanitizeMindMapRichHtml,
} from '@/shared/lib/mindmapRichText'

export interface ImportHistoryItem {
  id: string
  jobId?: string
  jobStatus?: 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'interrupted'
  jobStage?: 'prepared' | 'structure' | 'ocr' | 'merge' | 'text' | 'completed'
  title: string
  nodeCount: number
  sourceTree: MindMapImportSourceTree
  editorDoc: MindMapDoc | string | null
  imagePreviewUrl: string
  importMode?: 'single' | 'batch'
  imageCount?: number
  createdAt: string
}

export interface ImportUndoSnapshot {
  editorDoc: MindMapDoc | string | null
  sourceTitle: string
  appliedMode: 'replace' | 'append'
  targetUid: string | null
}

export interface SaveImportHistoryResult {
  history: ImportHistoryItem[]
  item: ImportHistoryItem
  persisted: boolean
}

export interface ApplyImportedDocResult {
  applied: boolean
  nextDoc: MindMapDoc | null
  error: string
}

export interface ApplyImportedEditorStateResult {
  applied: boolean
  nextEditorState: MindMapEditorState | null
  undoSnapshot: ImportUndoSnapshot | null
  error: string
}

const HISTORY_STORAGE_PREFIX = 'mindmap_import_history_'

function historyKey(entityKey: string): string {
  return `${HISTORY_STORAGE_PREFIX}${entityKey}`
}

export function loadImportHistory(entityKey: string): ImportHistoryItem[] {
  try {
    const raw = localStorage.getItem(historyKey(entityKey))
    if (!raw) return []
    return JSON.parse(raw) as ImportHistoryItem[]
  } catch {
    return []
  }
}

export function saveImportHistory(
  entityKey: string,
  item: Omit<ImportHistoryItem, 'id' | 'createdAt'>,
): SaveImportHistoryResult {
  const history = loadImportHistory(entityKey)
  const newItem: ImportHistoryItem = {
    ...item,
    id: Date.now().toString(36),
    createdAt: new Date().toISOString(),
  }
  const updated = [newItem, ...history].slice(0, 20)
  let persisted = true
  try {
    localStorage.setItem(historyKey(entityKey), JSON.stringify(updated))
  } catch {
    persisted = false
  }
  return { history: updated, item: newItem, persisted }
}

export function deleteImportHistory(entityKey: string, id: string): ImportHistoryItem[] {
  const history = loadImportHistory(entityKey).filter((item) => item.id !== id)
  localStorage.setItem(historyKey(entityKey), JSON.stringify(history))
  return history
}

export function cloneDoc<T>(value: T): T {
  return structuredClone(value)
}

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

function createNodeUid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function buildDocNodeFromSourceNode(node: MindMapImportSourceNode): MindMapDocNode {
  const plain = node.text || ''
  const fromMarks = applyEmphasisMarksToHtml(plain, node.emphasis_marks)
  const richHtml = sanitizeMindMapRichHtml(node.rich_text_html) || fromMarks
  const data: MindMapDocNode['data'] = {
    uid: createNodeUid(),
    text: richHtml || plain,
  }
  if (richHtml) {
    data.richText = true
    data.text = richHtml
  }
  const ankiRole = node.ankiRole
  if (ankiRole === 'front' || ankiRole === 'back' || ankiRole === 'none') {
    data.ankiRole = ankiRole
  }
  return {
    data,
    children: (node.children || []).map(buildDocNodeFromSourceNode),
  }
}

export function buildEditorDocFromSourceTree(sourceTree: MindMapImportSourceTree): MindMapDoc {
  return {
    root: {
      data: {
        text: sourceTree.title || '未命名宫殿',
        uid: 'palace-root',
        memoryAnkiRootKind: 'palace',
      },
      children: (sourceTree.children || []).map(buildDocNodeFromSourceNode),
    },
    theme: {
      template: 'avocado',
      config: {},
    },
    layout: 'logicalStructure',
    config: {},
    view: null,
  }
}

function buildAppendNodeFromImportedRoot(root: MindMapDocNode): MindMapDocNode {
  return rebuildImportedSubtree(root)
}

function rebuildImportedSubtree(node: MindMapDocNode): MindMapDocNode {
  const appendNode = cloneDoc(node)
  const currentData = appendNode.data && typeof appendNode.data === 'object' ? appendNode.data : {}
  appendNode.data = { ...currentData, uid: createNodeUid() }
  delete appendNode.data.memoryAnkiRootKind
  delete appendNode.data.memoryAnkiId
  delete appendNode.data.memoryAnkiNodeType
  const currentChildren = Array.isArray(appendNode.children) ? appendNode.children : []
  appendNode.children = currentChildren.map(rebuildImportedSubtree)
  return appendNode
}

export function applyImportedDoc(
  currentDoc: MindMapDoc | null,
  importedDoc: MindMapDoc | null,
  mode: 'replace' | 'append',
  targetUid?: string | null,
): ApplyImportedDocResult {
  if (!importedDoc) {
    return {
      applied: false,
      nextDoc: currentDoc,
      error: '还没有可用的导入草稿。',
    }
  }
  if (mode === 'replace') {
    return {
      applied: true,
      nextDoc: cloneDoc(importedDoc),
      error: '',
    }
  }
  if (!targetUid) {
    return {
      applied: false,
      nextDoc: currentDoc,
      error: '请先在脑图中选中一个追加目标知识点。',
    }
  }
  const baseDoc = cloneDoc(currentDoc)
  const incomingDoc = cloneDoc(importedDoc)
  if (!baseDoc?.root || !incomingDoc?.root) {
    return {
      applied: false,
      nextDoc: baseDoc ?? incomingDoc,
      error: '当前脑图结构不可用，无法追加导入结果。',
    }
  }
  const appendNodes = [buildAppendNodeFromImportedRoot(incomingDoc.root)]
  const didAppend = appendToTarget(baseDoc.root, targetUid, appendNodes)
  return didAppend
    ? {
        applied: true,
        nextDoc: baseDoc,
        error: '',
      }
    : {
        applied: false,
        nextDoc: currentDoc,
        error: '未找到追加目标知识点，请重新选中知识点后再试。',
      }
}

function appendToTarget(
  node: MindMapDocNode,
  targetUid: string,
  appendNodes: MindMapDocNode[],
): boolean {
  const nodeUid =
    node.data && typeof node.data === 'object' && typeof node.data.uid === 'string'
      ? node.data.uid
      : null
  if (nodeUid === targetUid) {
    const currentChildren = Array.isArray(node.children) ? node.children : []
    node.children = [...currentChildren, ...appendNodes]
    return true
  }
  const children = Array.isArray(node.children) ? node.children : []
  for (const child of children) {
    if (appendToTarget(child, targetUid, appendNodes)) {
      return true
    }
  }
  return false
}

export function countSourceTreeNodes(nodes: MindMapImportSourceNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countSourceTreeNodes(node.children || []), 0)
}

export function applyImportedEditorState(options: {
  editorState: MindMapEditorState | null
  importedDoc: MindMapDoc | string | null
  mode: 'replace' | 'append'
  targetUid?: string | null
  sourceTitle?: string
}): ApplyImportedEditorStateResult {
  const { editorState, importedDoc, mode, targetUid, sourceTitle = '' } = options
  if (!editorState) {
    return {
      applied: false,
      nextEditorState: null,
      undoSnapshot: null,
      error: '当前脑图还没加载完成。',
    }
  }

  const currentDoc = parseMindMapDoc(editorState.editor_doc)
  const nextImportedDoc = parseMindMapDoc(importedDoc)
  const applied = applyImportedDoc(currentDoc, nextImportedDoc, mode, targetUid)
  if (!applied.applied || !applied.nextDoc) {
    return {
      applied: false,
      nextEditorState: null,
      undoSnapshot: null,
      error: applied.error,
    }
  }

  return {
    applied: true,
    nextEditorState: {
      ...editorState,
      editor_doc: cloneDoc(applied.nextDoc),
    },
    undoSnapshot: {
      editorDoc: cloneDoc(editorState.editor_doc),
      sourceTitle,
      appliedMode: mode,
      targetUid: targetUid ?? null,
    },
    error: '',
  }
}

export function restoreImportedEditorState(
  editorState: MindMapEditorState | null,
  undoSnapshot: ImportUndoSnapshot | null,
): MindMapEditorState | null {
  if (!editorState || !undoSnapshot) return null
  return {
    ...editorState,
    editor_doc: cloneDoc(undoSnapshot.editorDoc),
  }
}

export function formatMindMapImportError(message: string | null | undefined): string {
  return formatKnowledgeImportError(message)
}
