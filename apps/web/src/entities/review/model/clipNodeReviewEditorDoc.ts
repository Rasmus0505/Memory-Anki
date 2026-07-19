import { normalizeMindMapDocument, type MindMapNode } from '@/entities/mindmap-document'

function nodeUid(node: MindMapNode | null | undefined): string {
  const data = node?.data
  if (!data || typeof data !== 'object') return ''
  return String(data.uid ?? data.memoryAnkiId ?? '').trim()
}

/**
 * Clip a palace mind map to root + one top-level branch for node-mode formal review.
 * Returns the original document when the branch cannot be resolved.
 */
export function clipEditorDocToTopLevelBranch(
  editorDoc: unknown,
  branchUid: string | null | undefined,
): string | Record<string, unknown> | null {
  const target = String(branchUid ?? '').trim()
  if (!target || editorDoc == null || editorDoc === '') {
    if (editorDoc == null) return null
    if (typeof editorDoc === 'string') return editorDoc
    if (typeof editorDoc === 'object') return editorDoc as Record<string, unknown>
    return null
  }

  const document = normalizeMindMapDocument(
    typeof editorDoc === 'string' || typeof editorDoc === 'object'
      ? (editorDoc as string | Record<string, unknown>)
      : null,
  )
  const root = document.root
  const children = Array.isArray(root.children) ? root.children : []
  const kept = children.filter((child) => nodeUid(child) === target)
  if (kept.length === 0) {
    if (typeof editorDoc === 'string') return editorDoc
    return editorDoc as Record<string, unknown>
  }

  return {
    ...document,
    root: {
      ...root,
      children: kept.map((child) => structuredClone(child)),
    },
  }
}
