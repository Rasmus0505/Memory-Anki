import { readMindMapEditorState } from '@/modules/content/public'
import {
  getPalaceEditorApi,
  savePalaceEditorApi,
  savePalaceEditorWithOptionsApi,
} from '@/modules/content/public'
import type {
  FreestyleMindMapBranchCard,
  MindMapEditorState,
} from '@/shared/api/contracts'
import { FlipCardMindMapPanel } from '@/widgets/mindmap-review-flow'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import type { ReviewFlowSnapshot } from '@/modules/memory/public'

export { FlipCardMindMapPanel }

/**
 * Freestyle swipe remounts cards outside the mount window. Cache flip/reveal
 * so going back to a previous unit restores the full revealed map instead of
 * root-only initial state.
 */
export const branchRevealSnapshotCache = new Map<string, ReviewFlowSnapshot>()

export function readBranchRevealSnapshot(cardId: string): ReviewFlowSnapshot | null {
  const snapshot = branchRevealSnapshotCache.get(cardId)
  if (!snapshot) return null
  return {
    revealMap: { ...snapshot.revealMap },
    redNodeIds: [...snapshot.redNodeIds],
    completed: snapshot.completed,
  }
}

export function writeBranchRevealSnapshot(cardId: string, snapshot: ReviewFlowSnapshot) {
  branchRevealSnapshotCache.set(cardId, {
    revealMap: { ...snapshot.revealMap },
    redNodeIds: [...snapshot.redNodeIds],
    completed: snapshot.completed,
  })
}

export function plainContextLabel(
  contextPath: FreestyleMindMapBranchCard['context_path'] | undefined,
  palaceTitle: string | undefined,
  palaceId: number,
) {
  const path = (contextPath || [])
    .map((item) => stripMindMapHtml(item.text) || item.uid)
    .filter(Boolean)
  return path.length ? path.join(' / ') : palaceTitle || `宫殿 ${palaceId}`
}

export const palaceEditorCache = new Map<number, Promise<MindMapEditorState>>()

export function loadPalaceEditor(palaceId: number) {
  const cached = palaceEditorCache.get(palaceId)
  if (cached) return cached
  const promise = getPalaceEditorApi(palaceId)
    .then((response) => readMindMapEditorState(response))
    .catch((error) => {
      palaceEditorCache.delete(palaceId)
      throw error
    })
  palaceEditorCache.set(palaceId, promise)
  return promise
}

export async function persistPalaceEditor(
  palaceId: number,
  state: MindMapEditorState,
): Promise<MindMapEditorState> {
  try {
    const response = await savePalaceEditorApi(palaceId, state)
    return readMindMapEditorState(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '')
    if (!message.includes('危险结构变更')) throw error
    const confirmed = await appConfirm(
      '这次保存会让宫殿知识点数量骤减。只有在你确实要大幅删除宫殿结构时才继续。确定继续保存吗？',
      { title: '确认危险保存', tone: 'danger' },
    )
    if (!confirmed) throw error
    const response = await savePalaceEditorWithOptionsApi(palaceId, {
      ...state,
      confirm_dangerous_change: true,
      editor_source: 'palace_edit',
    })
    return readMindMapEditorState(response)
  }
}

export function editorStateFingerprint(state: MindMapEditorState | null | undefined): string {
  if (!state) return ''
  try {
    return JSON.stringify(state) ?? ''
  } catch {
    return ''
  }
}
