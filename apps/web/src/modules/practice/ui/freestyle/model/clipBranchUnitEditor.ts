import { getMindMapNodeUid, normalizeMindMapDocument, type MindMapNode } from '@/modules/content/public'
import type { MindMapEditorState } from '@/shared/api/contracts'

/**
 * Path of mind-map nodes from document root down to ``targetUid`` (inclusive).
 * Returns null when the target is missing.
 */
function pathNodesTo(root: MindMapNode | undefined, targetUid: string): MindMapNode[] | null {
  if (!root) return null
  const own = getMindMapNodeUid(root, '')
  if (own === targetUid) return [root]
  for (const child of root.children ?? []) {
    const sub = pathNodesTo(child, targetUid)
    if (sub) return [root, ...sub]
  }
  return null
}

/** Path of node uids from document root down to ``targetUid`` (inclusive). */
function pathUidsTo(root: MindMapNode | undefined, targetUid: string): string[] | null {
  const nodes = pathNodesTo(root, targetUid)
  if (!nodes) return null
  return nodes.map((node, index) => getMindMapNodeUid(node, index === 0 ? 'root' : `n${index}`))
}

/**
 * Ancestors of ``branchUid`` that are also ratable (folded into this unit).
 * Ordered rootward → leafward, excluding the palace root and the branch itself.
 *
 * Kept for callers that need the ratable fold set; clip itself always builds the
 * full single-child spine so flip order matches the original mind map.
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
  /**
   * @deprecated Full path spine is always built. Kept so older call sites type-check.
   * Rootward → leafward ancestors that used to be optionally folded.
   */
  includeAncestorUids?: string[]
}

/**
 * Clip a full-palace editor state to one freestyle branch unit for flip review.
 *
 * Progressive-flip invariant (logical root of this module):
 * - The clipped document is a **single-child spine** from the real palace root
 *   down to ``branchUid``, then the complete unit subtree under the branch.
 * - Sibling branches are stripped so the unit stays focused.
 * - Each spine node keeps its **original** title. Never mash ancestor titles into
 *   one synthetic root string like ``A / B / C`` — that made the first card show
 *   the whole path at once and broke step-by-step flip.
 * - Reveal still starts as root-only; the learner clicks to open the next level.
 *
 * Rating / due scope stays on ``ratable_node_uids`` / unit due freeze (call site).
 * Context path in the card header remains display-only orientation.
 */
export function clipEditorStateToBranchUnit(
  editorState: MindMapEditorState,
  branchUid: string,
  _contextLabel?: string,
  _options?: ClipBranchUnitOptions,
): MindMapEditorState {
  const target = String(branchUid || '').trim()
  if (!target) return editorState

  const document = normalizeMindMapDocument(editorState.editor_doc)
  const path = pathNodesTo(document.root, target)
  if (!path || path.length === 0) return editorState

  // Last path node is the unit root — keep its full descendant subtree.
  // Every earlier node becomes a single-child wrapper (no siblings).
  let unitTree: MindMapNode = structuredClone(path[path.length - 1])
  for (let index = path.length - 2; index >= 0; index -= 1) {
    const ancestor = path[index]
    const data = structuredClone(ancestor.data ?? {})
    unitTree = {
      data,
      children: [unitTree],
    }
  }

  return {
    ...editorState,
    editor_doc: {
      ...document,
      root: unitTree,
    },
    editor_fingerprint: `${editorState.editor_fingerprint || 'doc'}:unit:${target}`,
  }
}
