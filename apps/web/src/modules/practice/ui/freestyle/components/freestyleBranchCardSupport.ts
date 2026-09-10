import { readMindMapEditorState } from '@/modules/content/public'
import {
  getPalaceEditorApi,
  savePalaceEditorApi,
  savePalaceEditorWithOptionsApi,
} from '@/modules/content/public'
import type {
  FreestyleMindMapBranchCard,
  MindMapEditorState,
  PalaceEditorSource,
  PalaceUnitReconcileResult,
} from '@/shared/api/contracts'
import { FlipCardMindMapPanel } from '@/widgets/mindmap-review-flow'
import { NodeBoundQuizDialog } from '@/widgets/node-bound-quiz'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import { appConfirm } from '@/shared/components/ui/native-dialog'

export { FlipCardMindMapPanel, NodeBoundQuizDialog }

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

export type PersistPalaceEditorOptions = {
  /** Force unit reconcile (also set for mark/leave reasons). */
  reconcileUnits?: boolean
  /** Backend reconcile triggers: mark_change | return_to_review | editor_leave | editor_idle */
  syncReason?: string
  editorSource?: PalaceEditorSource | string
}

export type PersistPalaceEditorResult = {
  state: MindMapEditorState
  unitReconcile?: PalaceUnitReconcileResult | null
}

function readUnitReconcile(response: unknown): PalaceUnitReconcileResult | null {
  if (!response || typeof response !== 'object') return null
  const value = (response as { unit_reconcile?: PalaceUnitReconcileResult | null }).unit_reconcile
  return value ?? null
}

function readSaveFingerprint(response: unknown): string {
  if (!response || typeof response !== 'object') return ''
  const record = response as {
    editor_fingerprint?: unknown
    snapshot?: { revision?: unknown } | null
  }
  if (typeof record.editor_fingerprint === 'string' && record.editor_fingerprint.trim()) {
    return record.editor_fingerprint.trim()
  }
  const revision = record.snapshot?.revision
  return typeof revision === 'string' ? revision.trim() : ''
}

function expectedFingerprintFromState(state: MindMapEditorState): string | null {
  const value = state.editor_fingerprint
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Keep the local tree; ack/full responses may only refresh the revision token. */
export function editorStateFromLocalSave(
  sent: MindMapEditorState,
  response: unknown,
): MindMapEditorState {
  const fingerprint = readSaveFingerprint(response)
  return {
    ...sent,
    editor_fingerprint: fingerprint || sent.editor_fingerprint,
  }
}

/**
 * Persist freestyle inline palace edits.
 * - No options → plain autosave (`savePalaceEditorApi` ack, no force reconcile),
 *   including mid-pass permanent-mark toggles.
 * - With options → `savePalaceEditorWithOptionsApi` so finished mark pass /
 *   leave / return-to-review can set `sync_reason` / `reconcile_units`.
 * Never rebuilds `editor_doc` from the save response.
 */
export async function persistPalaceEditor(
  palaceId: number,
  state: MindMapEditorState,
  options?: PersistPalaceEditorOptions,
): Promise<PersistPalaceEditorResult> {
  const hasOptions = Boolean(
    options
    && (
      options.reconcileUnits
      || (options.syncReason != null && options.syncReason !== '')
      || (options.editorSource != null && options.editorSource !== '')
    ),
  )
  const expectedFingerprint = expectedFingerprintFromState(state)
  const buildOptionsPayload = (extra?: Record<string, unknown>) => ({
    ...state,
    editor_source: (options?.editorSource as PalaceEditorSource | undefined) ?? 'palace_edit_autosave',
    expected_editor_fingerprint: expectedFingerprint,
    response_mode: 'ack' as const,
    ...(options?.syncReason ? { sync_reason: options.syncReason } : {}),
    ...(options?.reconcileUnits ? { reconcile_units: true } : {}),
    ...extra,
  })
  const adopt = (response: unknown): PersistPalaceEditorResult => ({
    state: editorStateFromLocalSave(state, response),
    unitReconcile: readUnitReconcile(response),
  })

  try {
    const response = hasOptions
      ? await savePalaceEditorWithOptionsApi(palaceId, buildOptionsPayload())
      : await savePalaceEditorApi(
        palaceId,
        {
          ...state,
          expected_editor_fingerprint: expectedFingerprint,
        },
        'ack',
      )
    return adopt(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '')
    if (!message.includes('危险结构变更')) throw error
    const confirmed = await appConfirm(
      '这次保存会让宫殿知识点数量骤减。只有在你确实要大幅删除宫殿结构时才继续。确定继续保存吗？',
      { title: '确认危险保存', tone: 'danger' },
    )
    if (!confirmed) throw error
    const response = await savePalaceEditorWithOptionsApi(palaceId, buildOptionsPayload({
      confirm_dangerous_change: true,
      editor_source: 'palace_edit',
    }))
    return adopt(response)
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
