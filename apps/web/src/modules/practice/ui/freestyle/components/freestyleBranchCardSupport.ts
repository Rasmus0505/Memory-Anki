import {
  getPalaceEditorApi,
  readMindMapEditorState,
  savePalaceEditorApi,
  savePalaceEditorWithOptionsApi,
} from '@/modules/content/public'
import { logAppError } from '@/shared/logs/model/appLogs'
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
  /** Freestyle sets this only for same-document editor_leave reconciliation. */
  reconcileUnits?: boolean
  /** Supported backend triggers remain available to non-freestyle editor hosts. */
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

function adoptPersistedState(
  sent: MindMapEditorState,
  response: unknown,
): PersistPalaceEditorResult {
  return {
    state: editorStateFromLocalSave(sent, response),
    unitReconcile: readUnitReconcile(response),
  }
}

function isEditorSaveConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const status = (error as Error & { status?: number }).status
  return status === 409 || /脑图保存冲突|服务端已有更新|mindmap_conflict/.test(error.message)
}

function isDangerousStructureError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('危险结构变更')
}

function errorRequestId(error: unknown): string {
  return error instanceof Error
    ? String((error as Error & { requestId?: string }).requestId || '')
    : ''
}

/**
 * Persist freestyle inline palace edits.
 * - Every complete edit action is sent immediately; callers serialize requests.
 * - A stale expected fingerprint caused by this device's previous successful save
 *   is refreshed once and the latest local document wins automatically.
 * - The remote document is never adopted here; only its revision token is used.
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

  const send = async (expectedFingerprint: string | null): Promise<unknown> => {
    const buildOptionsPayload = (extra?: Record<string, unknown>) => ({
      ...state,
      editor_fingerprint: expectedFingerprint || state.editor_fingerprint,
      editor_source: (options?.editorSource as PalaceEditorSource | undefined) ?? 'palace_edit_autosave',
      expected_editor_fingerprint: expectedFingerprint,
      response_mode: 'ack' as const,
      ...(options?.syncReason ? { sync_reason: options.syncReason } : {}),
      ...(options?.reconcileUnits ? { reconcile_units: true } : {}),
      ...extra,
    })
    const requestOnce = async (confirmDangerousChange = false): Promise<unknown> => {
      if (!hasOptions) {
        return savePalaceEditorApi(
          palaceId,
          {
            ...state,
            editor_fingerprint: expectedFingerprint || state.editor_fingerprint,
            expected_editor_fingerprint: expectedFingerprint,
            ...(confirmDangerousChange
              ? {
                  editor_source: 'palace_edit' as const,
                  confirm_dangerous_change: true,
                }
              : {}),
          },
          'ack',
        )
      }
      return savePalaceEditorWithOptionsApi(
        palaceId,
        buildOptionsPayload(
          confirmDangerousChange
            ? { confirm_dangerous_change: true, editor_source: 'palace_edit' }
            : undefined,
        ),
      )
    }

    try {
      return await requestOnce()
    } catch (error) {
      if (!isDangerousStructureError(error)) throw error
      const confirmed = await appConfirm(
        '这次保存会让宫殿知识点数量骤减。只有在你确实要大幅删除宫殿结构时才继续。确定继续保存吗？',
        { title: '确认危险保存', tone: 'danger' },
      )
      if (!confirmed) throw error
      return requestOnce(true)
    }
  }

  const initialFingerprint = expectedFingerprintFromState(state)
  try {
    return adoptPersistedState(state, await send(initialFingerprint))
  } catch (error) {
    if (!isEditorSaveConflict(error)) throw error

    logAppError({
      feature: '随心脑图保存',
      stage: 'stale_fingerprint_rebased',
      error,
      requestSummary: `PUT /palaces/${palaceId}/editor`,
      requestId: errorRequestId(error),
      meta: {
        palaceId,
        resolution: 'refresh_fingerprint_and_retry_local_document',
      },
    })

    let remoteState: MindMapEditorState
    try {
      remoteState = readMindMapEditorState(await getPalaceEditorApi(palaceId))
    } catch {
      throw error
    }
    const remoteFingerprint = expectedFingerprintFromState(remoteState)
    if (!remoteFingerprint) throw error

    return adoptPersistedState(state, await send(remoteFingerprint))
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
