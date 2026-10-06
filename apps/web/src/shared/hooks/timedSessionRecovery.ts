import { API_BASE } from '@/shared/api/http'
import { getApiToken } from '@/shared/api/apiToken'
import { enqueueMutation } from '@/shared/persistence/mutationQueue'
import {
  buildTimeRecordRecoveryMutationId,
  removePendingTimeRecordRecovery,
  serializeStudySessionRecordPayload,
  upsertPendingTimeRecordRecovery,
} from '@/modules/session/public'
import type { TimeSessionRecord } from '@/modules/session/public'
import { attributionToMetadata } from '@/modules/session/public'

const JSON_CONTENT_TYPE = 'application/json'
const MUTATION_ID_HEADER = 'X-Memory-Anki-Mutation-ID'
const STUDY_SESSION_RECOVERY_URL = `${API_BASE}/study-sessions/from-time-record`
const TIME_LEDGER_URL = `${API_BASE}/study-sessions/time-ledger`

export interface TimedSessionUnloadPersistenceResult {
  mutationId: string
  transport: 'beacon' | 'keepalive' | 'queued'
}

function buildTimeRecordRequestBody(record: TimeSessionRecord) {
  return JSON.stringify(serializeStudySessionRecordPayload(record))
}

function buildLedgerRequestBody(record: TimeSessionRecord) {
  const intervals = (record.activityIntervals ?? []).filter((item) =>
    Date.parse(item.endedAt) > Date.parse(item.startedAt),
  ).map((item) => ({
    interval_id: `${record.id}:${item.startedAt}:${item.endedAt}`,
    session_id: record.id,
    started_at: item.startedAt,
    ended_at: item.endedAt,
    kind: record.activityTag ?? record.kind,
    title: record.title,
    client_source: record.clientSource ?? 'unknown',
    // The unload path must carry the same attribution as the normal one; a
    // closed tab used to be exactly where subject/chapter was dropped.
    metadata: {
      ...attributionToMetadata(record.attribution),
      session_key: record.sessionKey,
    },
  }))
  return JSON.stringify({ intervals })
}

function buildTimeRecordRequestHeaders(mutationId: string, apiToken = getApiToken()) {
  return {
    'Content-Type': JSON_CONTENT_TYPE,
    [MUTATION_ID_HEADER]: mutationId,
    ...(apiToken ? { 'X-Memory-Anki-Token': apiToken } : {}),
  }
}

function queueTimeRecordRecovery(
  record: TimeSessionRecord,
  mutationId: string,
  body: string,
  url = STUDY_SESSION_RECOVERY_URL,
) {
  upsertPendingTimeRecordRecovery(record, { mutationId, status: 'pending' })
  return enqueueMutation({
    mutationId,
    resourceKey: `time-record:${record.id}`,
    // pagehide and beforeunload can both fire, and a failed keepalive can be
    // queued again before the first item replays. Keep one body per record.
    coalesceKey: `time-record:${record.id}`,
    description: `恢复学习时长：${record.title || record.kind}`,
    url,
    method: 'POST',
    headers: buildTimeRecordRequestHeaders(mutationId),
    bodyKind: 'json',
    body,
    replayMode: 'auto',
  })
}

function trySendBeacon(body: string, url = STUDY_SESSION_RECOVERY_URL) {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return false
  }
  try {
    const payload = new Blob([body], { type: JSON_CONTENT_TYPE })
    return navigator.sendBeacon(url, payload)
  } catch {
    return false
  }
}

function tryKeepaliveFetch(recordId: string, body: string, mutationId: string, url = STUDY_SESSION_RECOVERY_URL) {
  if (typeof fetch === 'undefined') {
    return false
  }
  try {
    void fetch(url, {
      method: 'POST',
      body,
      keepalive: true,
      headers: buildTimeRecordRequestHeaders(mutationId),
    })
      .then((response) => {
        if (response.ok) {
          removePendingTimeRecordRecovery(recordId)
        }
      })
      .catch(() => {
        // Leave the queued recovery in place for the next replay attempt.
      })
    return true
  } catch {
    return false
  }
}

export async function fireAndQueueTimeRecordOnUnload(
  record: TimeSessionRecord,
): Promise<TimedSessionUnloadPersistenceResult> {
  const mutationId = buildTimeRecordRecoveryMutationId(record.id)
  const body = record.activityIntervals !== undefined
    ? buildLedgerRequestBody(record)
    : buildTimeRecordRequestBody(record)
  const recoveryUrl = record.activityIntervals !== undefined ? TIME_LEDGER_URL : STUDY_SESSION_RECOVERY_URL
  const queuePromise = queueTimeRecordRecovery(record, mutationId, body, recoveryUrl).catch((error: unknown) => {
    // Runs on pagehide with no caller able to await it, so this must not surface
    // as an unhandled rejection. Nothing is lost by swallowing it here: the
    // localStorage recovery marker written by queueTimeRecordRecovery is the
    // durable record, and usePendingTimeRecordRecoveryAutoSync replays it
    // independently of the IndexedDB queue.
    console.error('[timed-session] failed to queue unload recovery', error)
    return null
  })
  const apiToken = getApiToken()

  if (!apiToken && trySendBeacon(body, recoveryUrl)) {
    await queuePromise
    return { mutationId, transport: 'beacon' }
  }

  if (tryKeepaliveFetch(record.id, body, mutationId, recoveryUrl)) {
    await queuePromise
    return { mutationId, transport: 'keepalive' }
  }

  await queuePromise
  return { mutationId, transport: 'queued' }
}
