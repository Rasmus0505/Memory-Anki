import { API_BASE } from '@/shared/api/http'
import { getApiToken } from '@/shared/api/apiToken'
import { enqueueMutation } from '@/shared/persistence/mutationQueue'
import {
  buildTimeRecordRecoveryMutationId,
  removePendingTimeRecordRecovery,
  upsertPendingTimeRecordRecovery,
} from '@/entities/session/model'
import type { TimeSessionRecord } from '@/entities/session/model'

const JSON_CONTENT_TYPE = 'application/json'
const MUTATION_ID_HEADER = 'X-Memory-Anki-Mutation-ID'
const STUDY_SESSION_RECOVERY_URL = `${API_BASE}/study-sessions/from-time-record`

export interface TimedSessionUnloadPersistenceResult {
  mutationId: string
  transport: 'beacon' | 'keepalive' | 'queued'
}

function buildTimeRecordRequestBody(record: TimeSessionRecord) {
  return JSON.stringify(record)
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
) {
  upsertPendingTimeRecordRecovery(record, { mutationId, status: 'pending' })
  return enqueueMutation({
    mutationId,
    resourceKey: `time-record:${record.id}`,
    description: `恢复学习时长：${record.title || record.kind}`,
    url: STUDY_SESSION_RECOVERY_URL,
    method: 'POST',
    headers: buildTimeRecordRequestHeaders(mutationId),
    bodyKind: 'json',
    body,
    replayMode: 'auto',
  })
}

function trySendBeacon(body: string) {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return false
  }
  try {
    const payload = new Blob([body], { type: JSON_CONTENT_TYPE })
    return navigator.sendBeacon(STUDY_SESSION_RECOVERY_URL, payload)
  } catch {
    return false
  }
}

function tryKeepaliveFetch(recordId: string, body: string, mutationId: string) {
  if (typeof fetch === 'undefined') {
    return false
  }
  try {
    void fetch(STUDY_SESSION_RECOVERY_URL, {
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
  const body = buildTimeRecordRequestBody(record)
  const queuePromise = queueTimeRecordRecovery(record, mutationId, body)
  const apiToken = getApiToken()

  if (!apiToken && trySendBeacon(body)) {
    await queuePromise
    return { mutationId, transport: 'beacon' }
  }

  if (tryKeepaliveFetch(record.id, body, mutationId)) {
    await queuePromise
    return { mutationId, transport: 'keepalive' }
  }

  await queuePromise
  return { mutationId, transport: 'queued' }
}
