import type {
  MindMapEditorState,
  MindMapDoc,
  MindMapDocNode,
  MindMapImportSourceNode,
  MindMapImportSourceTree,
} from '@/shared/api/contracts'

export interface ImportHistoryItem {
  id: string
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
  localStorage.setItem(historyKey(entityKey), JSON.stringify(updated))
  return { history: updated, item: newItem }
}

export function deleteImportHistory(entityKey: string, id: string): ImportHistoryItem[] {
  const history = loadImportHistory(entityKey).filter((item) => item.id !== id)
  localStorage.setItem(historyKey(entityKey), JSON.stringify(history))
  return history
}

export function cloneDoc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
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
  if (mode === 'replace' || !targetUid) {
    return {
      applied: true,
      nextDoc: cloneDoc(importedDoc),
      error: '',
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
  const appendNodes = Array.isArray(incomingDoc.root.children) ? incomingDoc.root.children : []
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
        error: '未找到追加目标节点，请重新选中节点后再试。',
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
  const normalized = (message || '').trim()
  if (!normalized) {
    return '识别失败，请稍后重试。'
  }
  if (normalized.includes('未配置 DASHSCOPE_API_KEY')) {
    return `${normalized}\n请先在后端进程环境中设置 DASHSCOPE_API_KEY。`
  }
  if (normalized.includes('WinError 10061') || normalized.includes('连接被拒绝')) {
    return `${normalized}\n请检查 DASHSCOPE_BASE_URL 是否被覆盖成错误地址；本地代理或网关是否拦截；目标主机和端口是否可达；DASHSCOPE_API_KEY 是否已配置。`
  }
  if (normalized.includes('百炼接口网络异常')) {
    return `${normalized}\n请检查网络连通性，以及 DASHSCOPE_BASE_URL 和 DASHSCOPE_API_KEY 是否配置正确。`
  }
  return normalized
}
