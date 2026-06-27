import { API_BASE } from '@/shared/api/http'
import { enqueueMutation } from '@/shared/persistence/mutationQueue'
import {
  buildTimeRecordRecoveryMutationId,
  removePendingTimeRecordRecovery,
  upsertPendingTimeRecordRecovery,
} from '@/entities/session/model'
import type { TimeSessionRecord } from '@/entities/session/model'

const JSON_CONTENT_TYPE = 'application/json'
const MUTATION_ID_HEADER = 'X-Memory-Anki-Mutation-ID'

export interface TimedSessionUnloadPersistenceResult {
  mutationId: string
  transport: 'beacon' | 'keepalive' | 'queued'
}

function buildTimeRecordRequestBody(record: TimeSessionRecord) {
  return JSON.stringify(record)
}

function buildTimeRecordRequestHeaders(mutationId: string) {
  return {
    'Content-Type': JSON_CONTENT_TYPE,
    [MUTATION_ID_HEADER]: mutationId,
  }
}

async function queueTimeRecordRecovery(
  record: TimeSessionRecord,
  mutationId: string,
  body: string,
) {
  upsertPendingTimeRecordRecovery(record, { mutationId, status: 'pending' })
  await enqueueMutation({
    mutationId,
    resourceKey: `time-record:${record.id}`,
    description: `恢复学习时长：${record.title || record.kind}`,
    url: `${API_BASE}/time-records`,
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
    return navigator.sendBeacon(`${API_BASE}/time-records`, payload)
  } catch {
    return false
  }
}

function tryKeepaliveFetch(recordId: string, body: string, mutationId: string) {
  if (typeof fetch === 'undefined') {
    return false
  }
  try {
    void fetch(`${API_BASE}/time-records`, {
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
  await queueTimeRecordRecovery(record, mutationId, body)

  if (trySendBeacon(body)) {
    return { mutationId, transport: 'beacon' }
  }

  if (tryKeepaliveFetch(record.id, body, mutationId)) {
    return { mutationId, transport: 'keepalive' }
  }

  return { mutationId, transport: 'queued' }
}
