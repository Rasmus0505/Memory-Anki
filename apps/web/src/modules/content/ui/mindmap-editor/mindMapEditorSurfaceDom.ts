import type { MindMapEditorState } from '@/shared/api/contracts'
import { normalizeEditorDocTree } from './documentGraphProjection'

export function isEditableKeyboardTarget(target: HTMLElement | null) {
  if (!target) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function focusMindMapNodeText(container: HTMLElement, nodeId: string) {
  const shell = Array.from(
    container.querySelectorAll<HTMLElement>('[data-mindmap-node-id]'),
  ).find((element) => element.dataset.mindmapNodeId === nodeId)
  shell?.querySelector<HTMLButtonElement>('.mindmap-node-text')?.focus()
}

export function isNonNodeInteractiveTarget(target: HTMLElement | null) {
  if (!target) return false
  return Boolean(
    target.closest('button, a, [role="menuitem"]') &&
      !target.closest('.mindmap-node-text'),
  )
}

export function collectRevealMap(editorState: MindMapEditorState) {
  const result: Record<string, 'hidden' | 'placeholder' | 'revealed'> = {}
  const doc = normalizeEditorDocTree(editorState.editor_doc)
  const walk = (node: { data?: Record<string, unknown>; children?: unknown[] }) => {
    const uid = typeof node.data?.uid === 'string' ? node.data.uid : ''
    const text = typeof node.data?.text === 'string' ? node.data.text : ''
    if (uid) {
      result[uid] = text === '待回忆' ? 'hidden' : 'revealed'
    }
    ;(Array.isArray(node.children) ? node.children : []).forEach((child) => {
      if (child && typeof child === 'object') {
        walk(child as { data?: Record<string, unknown>; children?: unknown[] })
      }
    })
  }
  if (doc.root) walk(doc.root)
  return result
}
