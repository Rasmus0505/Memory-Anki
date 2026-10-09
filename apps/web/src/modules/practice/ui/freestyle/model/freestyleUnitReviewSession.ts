import {
  getUnitReviewSessionApi,
  startFreestyleUnitReviewSessionApi,
  type FreestyleUnitEncounterState,
  type ReviewUnitDto,
  type UnitRating,
  type UnitReviewSessionDto,
} from '@/modules/practice/public'
import type {
  FreestyleReviewUnitCard,
  MindMapEditorState,
} from '@/shared/api/contracts'
import { coerceEditorDoc } from '@/shared/lib/mindmap-split-marks/splitMarks'

const inFlightSessionLoads = new Map<string, Promise<UnitReviewSessionDto>>()
const SESSION_LOAD_TIMEOUT_MS = 30_000
/** Undo stays reachable just after a rate, then collapses so the map keeps the room. */
export const UNDO_VISIBLE_MS = 5_000

export function operationId() {
  return crypto.randomUUID?.() ?? `freestyle-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function sessionCacheKey(cardId: string, encounter: FreestyleUnitEncounterState) {
  // Status must not split the key. pending→open used to miss the in-flight
  // start and POST the same glance twice.
  if (encounter.status === 'closed' && encounter.sessionId) {
    return `closed:${cardId}:${encounter.encounterId}:${encounter.sessionId}`
  }
  return `start:${cardId}:${encounter.encounterId}`
}

function loadSession(
  card: FreestyleReviewUnitCard,
  encounter: FreestyleUnitEncounterState,
  roundId: string,
) {
  const key = sessionCacheKey(card.id, encounter)
  const cached = inFlightSessionLoads.get(key)
  if (cached) return cached
  const promise = encounter.status === 'closed' && encounter.sessionId
    ? getUnitReviewSessionApi(encounter.sessionId)
    : startFreestyleUnitReviewSessionApi(
        { id: card.unit_id!, revision: card.unit_revision! },
        roundId,
        encounter.encounterId,
        ...(
          card.phase === 'fill'
          || encounter.selectedRating != null
          || encounter.passed === true
            ? [{ allowNotDue: true }]
            : []
        ),
      )
  inFlightSessionLoads.set(key, promise)
  const clear = () => {
    if (inFlightSessionLoads.get(key) === promise) inFlightSessionLoads.delete(key)
  }
  void promise.then(clear, clear)
  return promise
}

export function loadSessionWithTimeout(
  card: FreestyleReviewUnitCard,
  encounter: FreestyleUnitEncounterState,
  roundId: string,
) {
  return new Promise<UnitReviewSessionDto>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      // Leave the shared promise in place. A retry of this same glance must
      // attach to the request already on the wire, not open another one.
      reject(new Error('这张还在准备评分，你可以先看。'))
    }, SESSION_LOAD_TIMEOUT_MS)
    void loadSession(card, encounter, roundId).then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

export function buildEditorState(session: UnitReviewSessionDto): MindMapEditorState | null {
  // Session payloads may still ship editor_doc as a JSON string; permanent-mark
  // chip/toggle logic needs a real document object with `.root`.
  const editorDoc = coerceEditorDoc(
    session.palace?.editor_doc as Parameters<typeof coerceEditorDoc>[0],
  )
  if (!editorDoc) return null
  return {
    editor_doc: editorDoc as MindMapEditorState['editor_doc'],
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

export function formatUnitDiagnostic(input: {
  error: unknown
  card: FreestyleReviewUnitCard
  roundId: string
  operationId?: string | null
  stage: string
}) {
  const value = input.error as {
    message?: string
    requestId?: string
    status?: number
    url?: string
  }
  const lines = [
    value?.message || String(input.error || '未知错误'),
    `页面：/freestyle · 宫殿：${input.card.palace_id} · 卡片：${input.card.id}`,
    `单元：${input.card.unit_id || '无'} · 回合：${input.roundId}`,
    `阶段：${input.stage} · 操作 ID：${input.operationId || '未生成'}`,
    value?.requestId ? `请求 ID：${value.requestId}` : null,
    value?.status != null ? `HTTP 状态：${value.status}` : null,
    value?.url ? `接口：${value.url}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}


export function asUnitRating(value: unknown): UnitRating | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null
}

export function encounterState(
  sessionId: string,
  unitRevision: number,
  encounter: NonNullable<ReviewUnitDto['encounter']>,
): FreestyleUnitEncounterState {
  return {
    encounterId: encounter.id,
    roundId: encounter.round_id,
    unitRevision,
    status: encounter.status,
    sessionId,
    selectedRating: encounter.selected_rating,
    passed: encounter.passed,
    retryAfterCards: encounter.retry_after_cards,
    effectiveSeconds: encounter.effective_seconds ?? null,
  }
}

export function adoptRatedEncounter(
  live: NonNullable<ReviewUnitDto['encounter']>,
  rated: NonNullable<ReviewUnitDto['encounter']>,
): NonNullable<ReviewUnitDto['encounter']> {
  if (rated.id === live.id) return rated
  if (live.status !== 'open') return rated
  // A retry glance must keep its own encounter. Reusing the source glance's
  // payload remounts the map at the root and looks like the view snapped back.
  return {
    ...rated,
    id: live.id,
    status: 'open',
    round_id: live.round_id,
    sequence: live.sequence,
  }
}

export function updateSessionUnit(
  session: UnitReviewSessionDto,
  unit: ReviewUnitDto,
): UnitReviewSessionDto {
  const units = session.units.map((item) => item.id === unit.id ? unit : item)
  return {
    ...session,
    units,
    pending_unit_count: units.filter((item) => item.session_status !== 'passed').length,
    completed_unit_count: units.filter((item) => item.session_status === 'passed').length,
  }
}
