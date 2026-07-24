import { readMindMapEditorState } from '@/modules/content/public'
import {
  getPalaceEditorApi,
  savePalaceEditorApi,
  savePalaceEditorWithOptionsApi,
} from '@/modules/content/public'
import type {
  FreestyleMindMapBranchCard,
  MindMapEditorState,
  ReviewCompletionSummary,
} from '@/shared/api/contracts'
import { startReviewSessionApi } from '@/widgets/mindmap-review-flow'
import {
  formatNextReviewDetailLabel,
  formatReviewAbsolute,
} from '@/modules/memory/public'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import {
  clipEditorStateToBranchUnit,
  foldedParentUidsForBranch,
} from '@/modules/practice/ui/freestyle/model/clipBranchUnitEditor'
import type { ReviewSessionSubmitResponse } from '@/shared/api/contracts'

/** Compact settle receipt shown as a floating bubble (not a full-screen takeover). */
export type BranchSettleFlash = {
  nextReviewAbsolute: string
  nextReviewDetail: string
  restudy: boolean
}

export type BranchSession = {
  id: string
  reviewScopeNodeUids: string[]
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
export const branchSessionCache = new Map<string, Promise<BranchSession>>()

export function isStaleDueError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  return /no due FSRS nodes|没有可结算的正式复习|palace has no due/i.test(message)
}

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

export function clipBranchUnit(
  fullState: MindMapEditorState,
  card: FreestyleMindMapBranchCard,
) {
  const contextText = plainContextLabel(
    card.context_path,
    card.palace_title,
    card.palace_id,
  )
  return clipEditorStateToBranchUnit(fullState, card.branch_uid, contextText, {
    includeAncestorUids: foldedParentUidsForBranch(
      fullState,
      card.branch_uid,
      card.ratable_node_uids,
    ),
  })
}

export function loadBranchSession(card: FreestyleMindMapBranchCard) {
  const key = card.id
  const cached = branchSessionCache.get(key)
  if (cached) return cached
  const unitDue = (card.due_node_uids || []).filter(Boolean)
  if (!unitDue.length) {
    const empty = Promise.reject(new Error('palace has no due FSRS nodes'))
    branchSessionCache.set(
      key,
      empty.catch((error) => {
        branchSessionCache.delete(key)
        throw error
      }) as Promise<BranchSession>,
    )
    return branchSessionCache.get(key)!
  }
  const promise = startReviewSessionApi(card.palace_id, {
    entry_mode: 'node',
    branch_uid: card.branch_uid,
    scope_node_uids: unitDue,
  }).then((session) => {
    const frozen = (session.frozen_due_node_uids ?? []).filter(Boolean)
    const unitSet = new Set(card.ratable_node_uids || [])
    const scoped = (frozen.length ? frozen : unitDue).filter((uid) => unitSet.has(uid))
    if (!scoped.length) {
      throw new Error('palace has no due FSRS nodes')
    }
    return {
      id: String(session.session_id ?? session.id),
      reviewScopeNodeUids: scoped,
    }
  })
  branchSessionCache.set(
    key,
    promise.catch((error) => {
      branchSessionCache.delete(key)
      throw error
    }),
  )
  return branchSessionCache.get(key)!
}

export function settleFlashFromResult(
  result: ReviewSessionSubmitResponse | ReviewCompletionSummary | null | undefined,
  restudy: boolean,
): BranchSettleFlash {
  const nextReviewAt = result?.next_review_at ?? null
  return {
    nextReviewAbsolute: formatReviewAbsolute(nextReviewAt),
    nextReviewDetail: restudy
      ? '有忘记/困难节点 · 最多隔 3 张再练 · 不会自动翻页'
      : formatNextReviewDetailLabel({
          nextReviewAt,
          nextReviewNodeCount:
            result?.next_review_node_count ?? result?.remaining_due_node_count,
          nextReviewEntryMode: result?.next_review_entry_mode,
          nextReviewEntryLabel: result?.next_review_entry_label,
        }),
    restudy,
  }
}

export function finishBranchCard(
  cardId: string,
  reducedMotion: boolean,
  onBranchComplete: (cardId: string, options?: { restudy?: boolean }) => void,
  setSettleFlash: (value: BranchSettleFlash | null) => void,
  flash: BranchSettleFlash,
  options?: { restudy?: boolean },
) {
  setSettleFlash(flash)
  onBranchComplete(cardId, options)
  const delay = reducedMotion ? 1400 : 2800
  window.setTimeout(() => {
    setSettleFlash(null)
  }, delay)
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
