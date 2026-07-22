import { getMindMapNodeUid, normalizeMindMapDocument, type MindMapNode } from '@/entities/mindmap-document'
import type { MindMapEditorState } from '@/shared/api/contracts'

function findNodeByUid(root: MindMapNode | undefined, uid: string): MindMapNode | null {
  if (!root) return null
  const own = getMindMapNodeUid(root, '')
  if (own === uid) return root
  for (const child of root.children ?? []) {
    const found = findNodeByUid(child, uid)
    if (found) return found
  }
  return null
}

/** Path of node uids from document root down to ``targetUid`` (inclusive). */
function pathUidsTo(root: MindMapNode | undefined, targetUid: string): string[] | null {
  if (!root) return null
  const own = getMindMapNodeUid(root, '')
  if (own === targetUid) return [own]
  for (const child of root.children ?? []) {
    const sub = pathUidsTo(child, targetUid)
    if (sub) return [own, ...sub]
  }
  return null
}

/**
 * Ancestors of ``branchUid`` that are also ratable (folded into this unit).
 * Ordered rootward → leafward, excluding the palace root and the branch itself.
 */
export function foldedParentUidsForBranch(
  editorState: MindMapEditorState,
  branchUid: string,
  ratableNodeUids: string[] | undefined,
): string[] {
  const target = String(branchUid || '').trim()
  if (!target) return []
  const ratable = new Set((ratableNodeUids || []).map(String).filter(Boolean))
  if (!ratable.size) return []

  const document = normalizeMindMapDocument(editorState.editor_doc)
  const path = pathUidsTo(document.root, target)
  if (!path || path.length < 2) return []

  // path[0] is usually palace root — never fold root into unit spine for display.
  const rootUid = path[0]
  return path.slice(1, -1).filter((uid) => uid !== rootUid && ratable.has(uid))
}

export type ClipBranchUnitOptions = {
  /** Rootward → leafward ancestors folded into this unit (single-child spine). */
  includeAncestorUids?: string[]
}

/**
 * Clip a full-palace editor state to one freestyle branch unit.
 *
 * Synthetic root holds context label only (not ratable / not counted).
 * The unit is a complete subtree under ``branchUid``. Optional folded parents
 * appear as a single-child spine above the unit root (no sibling branches).
 */
export function clipEditorStateToBranchUnit(
  editorState: MindMapEditorState,
  branchUid: string,
  contextLabel: string,
  options?: ClipBranchUnitOptions,
): MindMapEditorState {
  const target = String(branchUid || '').trim()
  if (!target) return editorState

  const document = normalizeMindMapDocument(editorState.editor_doc)
  const branchNode = findNodeByUid(document.root, target)
  if (!branchNode) return editorState

  let unitTree: MindMapNode = structuredClone(branchNode)
  const spine = (options?.includeAncestorUids || [])
    .map((uid) => String(uid || '').trim())
    .filter(Boolean)
  // Wrap nearest parent last so order is rootward → … → branch.
  for (let index = spine.length - 1; index >= 0; index -= 1) {
    const uid = spine[index]
    const source = findNodeByUid(document.root, uid)
    if (!source) continue
    unitTree = {
      data: structuredClone(source.data ?? { uid, text: uid }),
      children: [unitTree],
    }
  }

  const label = String(contextLabel || '').trim() || '本支复习'
  const syntheticRoot: MindMapNode = {
    data: {
      text: label,
      uid: `__freestyle_unit_root__:${target}`,
      memoryAnkiRootKind: 'freestyle_unit',
    },
    children: [unitTree],
  }

  return {
    ...editorState,
    editor_doc: {
      ...document,
      root: syntheticRoot,
    },
    editor_fingerprint: `${editorState.editor_fingerprint || 'doc'}:unit:${target}`,
  }
}
