import type {
  rateReviewUnitApi,
  undoReviewUnitRatingApi,
  UnitRating,
} from '@/modules/practice/public'
import type {
  FreestyleRoundRatingRequest,
  FreestyleRoundStatePayload,
} from '@/shared/api/contracts'

/**
 * Round-scoped rating outbox. Framework-free: no React, no API imports.
 *
 * One entry per `round + card`. A tap becomes `saving`, and only a server
 * acknowledgement makes it `saved`. A failure or a missing answer makes it
 * `failed` (未保存). A save is owned by this store, not by the card that asked
 * for it, so leaving the card, the page or the module does not cancel it.
 *
 * Each card has one serial lane: one request in flight, at most one newer
 * intent waiting (the latest tap wins). A retry of a failed save reuses the
 * same operation id so the server can de-duplicate it.
 */

/**
 * No answer within this budget: show 未保存 and free the lane. The request keeps
 * running up to the transport cap (`FREESTYLE_RATING_TRANSPORT_TIMEOUT_MS`), and a
 * late success still upgrades the item to saved without another tap.
 */
export const RATING_SAVE_TIMEOUT_MS = 12_000

export type RatedUnitResult = Awaited<ReturnType<typeof rateReviewUnitApi>>
export type UndoneUnitResult = Awaited<ReturnType<typeof undoReviewUnitRatingApi>>

export type RatingSaveStatus = 'saving' | 'saved' | 'failed'
export type RatingSaveFailure =
  | 'timeout'
  | 'network'
  | 'conflict'
  | 'identity'
  | 'stale'
  | 'no_result'
  | 'prepare'

export interface RatingTarget {
  encounterId: string
  unitId: string
  sessionId: string
  unitRevision: number
}

export interface RatingRequest {
  roundId: string
  cardId: string
  /** Retry occurrence id, or '' for a source card. */
  occurrenceId: string
  rating: UnitRating
  /** Round plan version the caller saw. The store also tracks newer acknowledged versions. */
  planVersion: number
  /** Known open glance. When absent, `prepare` opens one first. */
  target?: RatingTarget | null
  prepare?: (() => Promise<RatingTarget>) | null
  /** Close the glance after the acknowledgement (background rating of a card not on screen). */
  closeAfterAck?: boolean
}

export interface RatingJob extends RatingRequest {
  key: string
  operationId: string
  sequence: number
}

export interface RatingSaveEntry {
  key: string
  roundId: string
  cardId: string
  /** The intent being saved / last saved. Null after an acknowledged clear. */
  rating: UnitRating | null
  operationId: string
  /** Request that owns this entry. An older request with the same operation id may still succeed it, never fail it. */
  sequence: number
  status: RatingSaveStatus
  /** `undo` while a clear is on the wire. */
  pendingKind: 'rate' | 'undo' | null
  failure: RatingSaveFailure | null
  detail: string | null
  /** Identity the last request used (or will use on retry). */
  target: RatingTarget | null
  /** Last server-acknowledged rating for this card in this store. */
  ackedRating: UnitRating | null
  /** Operation id the server holds for that rating; the handle for undo. */
  ackedOperationId: string | null
}

export type RatingSaveEvent =
  | {
      type: 'acked'
      roundId: string
      cardId: string
      job: RatingJob
      target: RatingTarget
      item: RatedUnitResult | null
      round: FreestyleRoundStatePayload | null
      /** Duplicate operation: the server answered with `item: null` but a round. */
      replayed: boolean
      /** False when a newer tap for the same card already superseded this one. */
      current: boolean
    }
  | { type: 'round'; roundId: string; cardId: string; round: FreestyleRoundStatePayload }
  | {
      type: 'failed'
      roundId: string
      cardId: string
      job: RatingJob
      failure: RatingSaveFailure
      error: unknown
      current: boolean
    }
  | {
      type: 'undone'
      roundId: string
      cardId: string
      result: UndoneUnitResult
      undoneRating: UnitRating | null
    }
  | { type: 'undoFailed'; roundId: string; cardId: string; error: unknown; operationId: string }

export interface RatingPostResponse {
  item: unknown
  round: FreestyleRoundStatePayload | null | undefined
}

/** A 未保存 rating as stored on the server: the grade and the request that failed. */
export interface RatingIntentRecord {
  operation_id: string
  rating: UnitRating
  failure: string
  payload: Record<string, unknown>
}

/** An intent handed back by the server (or by this browser's local mirror) for one card. */
export interface HydratedRatingIntent {
  card_id: string
  operation_id: string
  rating: number
  failure: string
  payload: Record<string, unknown>
  /** False for a failure this browser has not yet managed to upload. */
  confirmed?: boolean
}

export interface RatingSaveDeps {
  post: (roundId: string, payload: FreestyleRoundRatingRequest) => Promise<RatingPostResponse>
  undo: (operationId: string, roundId: string) => Promise<UndoneUnitResult>
  /** Keep a 未保存 rating so another device or a reload can see and retry it. */
  persistIntent?: (roundId: string, cardId: string, intent: RatingIntentRecord) => Promise<unknown>
  /** The rating landed: remove its 未保存 record, but only for this operation id. */
  clearIntent?: (roundId: string, cardId: string, operationId: string) => Promise<unknown>
  close?: (target: RatingTarget, job: RatingJob) => Promise<unknown>
  isStaleError?: (error: unknown) => boolean
  newOperationId: () => string
  setTimer: (callback: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  timeoutMs?: number
}

export type RatingResponseVerdict =
  | { kind: 'saved'; item: RatedUnitResult; round: FreestyleRoundStatePayload | null }
  | { kind: 'replayed'; round: FreestyleRoundStatePayload }
  | { kind: 'conflict'; round: FreestyleRoundStatePayload; version: number }
  | { kind: 'failed'; failure: 'identity' | 'no_result' }

/** Local pass rule: 记得 / 轻松 pass, 忘记 / 困难 do not. */
export function ratingPassed(rating: UnitRating): boolean {
  return rating >= 3
}

export function ratingSaveKey(roundId: string, cardId: string) {
  return `${roundId}::${cardId}`
}

export function roundPlanVersionOf(round: Partial<FreestyleRoundStatePayload> | null | undefined) {
  const version = Number(round?.plan_version ?? round?.version)
  return Number.isInteger(version) && version > 0 ? version : 0
}

/**
 * - `conflict: true`: the server rolled the write back and returned its latest plan.
 * - `item: null` with a round: a replayed operation that was already applied. Success.
 * - An item for another unit is never adopted.
 */
export function classifyRatingResponse(
  response: RatingPostResponse | null | undefined,
  target: RatingTarget,
): RatingResponseVerdict {
  const round = response?.round ?? null
  if (round?.conflict) return { kind: 'conflict', round, version: roundPlanVersionOf(round) }
  const item = response?.item as RatedUnitResult | null | undefined
  if (item) {
    if (String(item.unit?.id || '') !== target.unitId) return { kind: 'failed', failure: 'identity' }
    return { kind: 'saved', item, round }
  }
  if (round) return { kind: 'replayed', round }
  return { kind: 'failed', failure: 'no_result' }
}

function asRating(value: unknown): UnitRating | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && /timeout/i.test(error.name)
}

type LaneTask =
  | { kind: 'rate'; job: RatingJob }
  | { kind: 'undo'; roundId: string; cardId: string; operationId: string; clearAll: boolean }

interface Lane {
  inflight: LaneTask | null
  queued: LaneTask | null
  /** Undo the in-flight rate once it is acknowledged. */
  undoAfter: { clearAll: boolean } | null
  idle: Array<() => void>
}

function targetFromPayload(payload: Record<string, unknown>): RatingTarget | null {
  const encounterId = typeof payload.encounter_id === 'string' ? payload.encounter_id : ''
  const sessionId = typeof payload.study_session_id === 'string' ? payload.study_session_id : ''
  const unitId = typeof payload.unit_id === 'string' ? payload.unit_id : ''
  const unitRevision = Number(payload.unit_revision)
  if (!encounterId || !sessionId || !unitId || !Number.isInteger(unitRevision)) return null
  return { encounterId, unitId, sessionId, unitRevision }
}

function asFailure(value: unknown): RatingSaveFailure {
  const known: RatingSaveFailure[] = ['timeout', 'network', 'conflict', 'identity', 'stale', 'no_result', 'prepare']
  return known.includes(value as RatingSaveFailure) ? (value as RatingSaveFailure) : 'network'
}

export class RatingSaveStore {
  private entries = new Map<string, RatingSaveEntry>()
  private lanes = new Map<string, Lane>()
  private requests = new Map<string, RatingRequest>()
  private planVersions = new Map<string, number>()
  private listeners = new Set<() => void>()
  private eventListeners = new Set<(event: RatingSaveEvent) => void>()
  private sequence = 0
  private roundCache = new Map<string, { version: number; entries: Record<string, RatingSaveEntry> }>()
  private changeVersion = 0
  /** Keys whose 未保存 record the server is known to hold. */
  private serverIntents = new Set<string>()

  private readonly deps: RatingSaveDeps

  constructor(deps: RatingSaveDeps) {
    this.deps = deps
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  listen = (listener: (event: RatingSaveEvent) => void) => {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  getEntry = (roundId: string, cardId: string): RatingSaveEntry | null =>
    this.entries.get(ratingSaveKey(roundId, cardId)) ?? null

  /** Stable per change: safe as a `useSyncExternalStore` snapshot. */
  getRoundEntries = (roundId: string): Record<string, RatingSaveEntry> => {
    const cached = this.roundCache.get(roundId)
    if (cached && cached.version === this.changeVersion) return cached.entries
    const entries: Record<string, RatingSaveEntry> = {}
    for (const entry of this.entries.values()) {
      if (entry.roundId === roundId) entries[entry.cardId] = entry
    }
    const previous = cached?.entries
    const same = previous
      && Object.keys(previous).length === Object.keys(entries).length
      && Object.entries(entries).every(([id, entry]) => previous[id] === entry)
    const value = same && previous ? previous : entries
    this.roundCache.set(roundId, { version: this.changeVersion, entries: value })
    return value
  }

  failedCount = (roundId: string) => {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.roundId === roundId && entry.status === 'failed') count += 1
    }
    return count
  }

  isBusy(roundId: string, cardId: string) {
    const lane = this.lanes.get(ratingSaveKey(roundId, cardId))
    return Boolean(lane?.inflight || lane?.queued)
  }

  /** Resolves once this card has nothing in flight or queued. */
  whenIdle(roundId: string, cardId: string): Promise<void> {
    if (!this.isBusy(roundId, cardId)) return Promise.resolve()
    const lane = this.lane(ratingSaveKey(roundId, cardId))
    return new Promise((resolve) => lane.idle.push(resolve))
  }

  notePlanVersion(roundId: string, version: number) {
    if (!roundId || !(version > 0)) return
    if (version > (this.planVersions.get(roundId) ?? 0)) this.planVersions.set(roundId, version)
  }

  /**
   * Save one card's rating. Same rating as a failed entry: retry with the same
   * operation id. Same rating already saving: nothing new to send.
   */
  submit(request: RatingRequest): RatingSaveEntry {
    const key = ratingSaveKey(request.roundId, request.cardId)
    const previous = this.entries.get(key)
    const lane = this.lane(key)
    if (
      previous?.status === 'saving'
      && previous.pendingKind === 'rate'
      && previous.rating === request.rating
    ) {
      return previous
    }
    const retry = previous?.status === 'failed' && previous.rating === request.rating
    const job: RatingJob = {
      ...request,
      key,
      operationId: retry && previous ? previous.operationId : this.deps.newOperationId(),
      sequence: ++this.sequence,
      target: request.target ?? (retry ? previous?.target : null) ?? null,
    }
    this.requests.set(key, request)
    lane.undoAfter = null
    const entry = this.setEntry({
      key,
      roundId: request.roundId,
      cardId: request.cardId,
      rating: request.rating,
      operationId: job.operationId,
      sequence: job.sequence,
      status: 'saving',
      pendingKind: 'rate',
      failure: null,
      detail: null,
      target: job.target ?? null,
      ackedRating: previous?.ackedRating ?? null,
      ackedOperationId: previous?.ackedOperationId ?? null,
    })
    if (lane.inflight) {
      lane.queued = { kind: 'rate', job }
    } else {
      this.run(key, { kind: 'rate', job })
    }
    return entry
  }

  /** Retry every 未保存 item of this round, each with its own original operation id. */
  retryFailed(roundId: string) {
    let count = 0
    for (const entry of [...this.entries.values()]) {
      if (entry.roundId !== roundId || entry.status !== 'failed' || entry.rating == null) continue
      const request = this.requests.get(entry.key)
      if (!request) continue
      this.submit({ ...request, rating: entry.rating })
      count += 1
    }
    return count
  }

  /**
   * Clear this card's acknowledged rating. With a rate still on the wire the
   * clear runs once that rate is acknowledged (it needs the server operation id).
   */
  requestUndo(input: { roundId: string; cardId: string; operationId?: string | null; clearAll: boolean }) {
    const key = ratingSaveKey(input.roundId, input.cardId)
    const lane = this.lane(key)
    const previous = this.entries.get(key)
    if (lane.inflight?.kind === 'rate') {
      lane.queued = null
      lane.undoAfter = { clearAll: input.clearAll }
      this.patchEntry(key, input, { status: 'saving', pendingKind: 'undo', failure: null, detail: null })
      return true
    }
    const operationId = input.operationId || previous?.ackedOperationId
    if (!operationId) return false
    const task: LaneTask = {
      kind: 'undo',
      roundId: input.roundId,
      cardId: input.cardId,
      operationId,
      clearAll: input.clearAll,
    }
    this.patchEntry(key, input, { status: 'saving', pendingKind: 'undo', failure: null, detail: null })
    if (lane.inflight) lane.queued = task
    else this.run(key, task)
    return true
  }

  private lane(key: string): Lane {
    let lane = this.lanes.get(key)
    if (!lane) {
      lane = { inflight: null, queued: null, undoAfter: null, idle: [] }
      this.lanes.set(key, lane)
    }
    return lane
  }

  private setEntry(entry: RatingSaveEntry) {
    this.entries.set(entry.key, entry)
    this.changed()
    return entry
  }

  private patchEntry(
    key: string,
    identity: { roundId: string; cardId: string },
    patch: Partial<RatingSaveEntry>,
  ) {
    const current = this.entries.get(key)
    return this.setEntry({
      key,
      roundId: identity.roundId,
      cardId: identity.cardId,
      rating: current?.rating ?? null,
      operationId: current?.operationId ?? '',
      sequence: current?.sequence ?? 0,
      status: current?.status ?? 'saved',
      pendingKind: current?.pendingKind ?? null,
      failure: current?.failure ?? null,
      detail: current?.detail ?? null,
      target: current?.target ?? null,
      ackedRating: current?.ackedRating ?? null,
      ackedOperationId: current?.ackedOperationId ?? null,
      ...patch,
    })
  }

  private changed() {
    this.changeVersion += 1
    for (const listener of [...this.listeners]) listener()
  }

  private emit(event: RatingSaveEvent) {
    for (const listener of [...this.eventListeners]) {
      try {
        listener(event)
      } catch {
        // One broken subscriber must not stop the ledger from hearing the ack.
      }
    }
  }

  private run(key: string, task: LaneTask) {
    const lane = this.lane(key)
    lane.inflight = task
    if (task.kind === 'rate') void this.runRate(key, task)
    else void this.runUndo(key, task)
  }

  /** Free the lane for this task (no-op if a timeout already freed it) and start the next one. */
  private release(key: string, task: LaneTask) {
    const lane = this.lane(key)
    if (lane.inflight !== task) return
    lane.inflight = null
    const next = lane.queued
    lane.queued = null
    if (next) {
      this.run(key, next)
      return
    }
    const waiters = lane.idle
    lane.idle = []
    waiters.forEach((resolve) => resolve())
  }

  private expectedVersion(job: RatingJob) {
    return Math.max(job.planVersion || 0, this.planVersions.get(job.roundId) ?? 0)
  }

  private payload(job: RatingJob, target: RatingTarget, expectedVersion: number): FreestyleRoundRatingRequest {
    return {
      operation_id: job.operationId,
      expected_version: expectedVersion,
      intent_sequence: job.sequence,
      card_id: job.cardId,
      occurrence_id: job.occurrenceId,
      encounter_id: target.encounterId,
      rating: job.rating,
      study_session_id: target.sessionId,
      unit_id: target.unitId,
      unit_revision: target.unitRevision,
    }
  }

  private async runRate(key: string, task: Extract<LaneTask, { kind: 'rate' }>) {
    const { job } = task
    const timer = this.deps.setTimer(
      () => this.timeout(key, task),
      this.deps.timeoutMs ?? RATING_SAVE_TIMEOUT_MS,
    )
    try {
      let target = job.target ?? null
      if (!target) {
        try {
          target = job.prepare ? await job.prepare() : null
        } catch (error) {
          this.fail(key, job, 'prepare', error)
          return
        }
        if (!target) {
          this.fail(key, job, 'prepare', new Error('rating target unavailable'))
          return
        }
        job.target = target
        const entry = this.entries.get(key)
        if (entry?.operationId === job.operationId) this.patchEntry(key, job, { target })
      }
      let response = await this.deps.post(job.roundId, this.payload(job, target, this.expectedVersion(job)))
      let verdict = classifyRatingResponse(response, target)
      if (verdict.kind === 'conflict') {
        // The write was rolled back. Adopt the latest plan, then send the same
        // operation once more against that version.
        this.notePlanVersion(job.roundId, verdict.version)
        this.emit({ type: 'round', roundId: job.roundId, cardId: job.cardId, round: verdict.round })
        response = await this.deps.post(job.roundId, this.payload(job, target, verdict.version || this.expectedVersion(job)))
        verdict = classifyRatingResponse(response, target)
      }
      if (verdict.kind === 'conflict') {
        this.notePlanVersion(job.roundId, verdict.version)
        this.emit({ type: 'round', roundId: job.roundId, cardId: job.cardId, round: verdict.round })
        this.fail(key, job, 'conflict', new Error('rating conflict after one re-send'))
      } else if (verdict.kind === 'failed') {
        this.fail(key, job, verdict.failure, new Error(`rating ${verdict.failure}`))
      } else {
        this.acknowledge(key, job, target, verdict)
      }
    } catch (error) {
      const stale = this.deps.isStaleError?.(error) ?? false
      this.fail(key, job, stale ? 'stale' : isTimeoutError(error) ? 'timeout' : 'network', error)
    } finally {
      this.deps.clearTimer(timer)
      this.followUp(key, task)
    }
  }

  private timeout(key: string, task: Extract<LaneTask, { kind: 'rate' }>) {
    const lane = this.lane(key)
    if (lane.inflight !== task) return
    // A clear waiting on this rate needs its acknowledgement. It stays 保存中
    // until the transport cap answers either way.
    if (lane.undoAfter) return
    const entry = this.entries.get(key)
    if (entry?.sequence === task.job.sequence && entry.status === 'saving') {
      this.fail(key, task.job, 'timeout', new Error(`rating not answered within ${this.deps.timeoutMs ?? RATING_SAVE_TIMEOUT_MS}ms`))
    }
    this.release(key, task)
  }

  private followUp(key: string, task: Extract<LaneTask, { kind: 'rate' }>) {
    const lane = this.lane(key)
    if (lane.inflight === task && lane.undoAfter) {
      const undoAfter = lane.undoAfter
      lane.undoAfter = null
      const entry = this.entries.get(key)
      const operationId = entry?.ackedOperationId
      if (operationId && entry?.ackedRating != null) {
        lane.inflight = null
        this.run(key, {
          kind: 'undo',
          roundId: task.job.roundId,
          cardId: task.job.cardId,
          operationId,
          clearAll: undoAfter.clearAll,
        })
        return
      }
      this.restoreAfterUndo(key, task.job)
    }
    this.release(key, task)
  }

  private restoreAfterUndo(key: string, job: RatingJob) {
    const entry = this.entries.get(key)
    if (entry?.pendingKind !== 'undo') return
    this.patchEntry(key, job, {
      status: 'saved',
      pendingKind: null,
      rating: entry.ackedRating,
    })
  }

  private acknowledge(
    key: string,
    job: RatingJob,
    target: RatingTarget,
    verdict: Extract<RatingResponseVerdict, { kind: 'saved' | 'replayed' }>,
  ) {
    const round = verdict.round
    if (round) this.notePlanVersion(job.roundId, roundPlanVersionOf(round))
    const item = verdict.kind === 'saved' ? verdict.item : null
    const ackedRating = asRating(item?.rating) ?? job.rating
    const ackedOperationId = item?.operation_id || job.operationId
    const entry = this.entries.get(key)
    // A retry with the same operation id can answer after the original already did.
    const duplicate = entry?.status === 'saved' && entry.ackedOperationId === ackedOperationId
    const current = entry?.operationId === job.operationId && !duplicate
    if (current && entry) {
      this.setEntry({
        ...entry,
        // A clear requested while this was on the wire keeps showing 保存中.
        status: entry.pendingKind === 'undo' ? 'saving' : 'saved',
        pendingKind: entry.pendingKind === 'undo' ? 'undo' : null,
        rating: ackedRating,
        failure: null,
        detail: null,
        target,
        ackedRating,
        ackedOperationId,
      })
    } else if (entry) {
      // Superseded by a newer tap: still the saved baseline until that one lands.
      this.setEntry({ ...entry, ackedRating, ackedOperationId })
    }
    this.clearIntent(key, job)
    this.emit({
      type: 'acked',
      roundId: job.roundId,
      cardId: job.cardId,
      job,
      target,
      item,
      round,
      replayed: verdict.kind === 'replayed',
      current,
    })
    const lane = this.lane(key)
    if (current && job.closeAfterAck && !lane.queued && !lane.undoAfter && this.deps.close) {
      void this.deps.close(target, job).catch(() => undefined)
    }
  }

  /**
   * Put this card's 未保存 grade on the shared record. Fire and forget: a failed upload
   * leaves the local mirror holding it, and the next sync uploads it again.
   */
  private persistIntent(key: string, job: RatingJob, failure: RatingSaveFailure, target: RatingTarget | null) {
    const persist = this.deps.persistIntent
    if (!persist || !job.roundId) return
    const payload: Record<string, unknown> = {
      operation_id: job.operationId,
      rating: job.rating,
      card_id: job.cardId,
      occurrence_id: job.occurrenceId,
      expected_version: this.expectedVersion(job),
      intent_sequence: job.sequence,
    }
    if (target) {
      payload.encounter_id = target.encounterId
      payload.study_session_id = target.sessionId
      payload.unit_id = target.unitId
      payload.unit_revision = target.unitRevision
    }
    const record: RatingIntentRecord = {
      operation_id: job.operationId,
      rating: job.rating,
      failure,
      payload,
    }
    void Promise.resolve()
      .then(() => persist(job.roundId, job.cardId, record))
      .then(() => {
        this.serverIntents.add(key)
      }, () => undefined)
  }

  /** Clear by operation id: a newer 未保存 record for the same card is never touched. */
  private clearIntent(key: string, job: RatingJob) {
    const clear = this.deps.clearIntent
    if (!clear || !job.roundId) return
    this.serverIntents.delete(key)
    void Promise.resolve()
      .then(() => clear(job.roundId, job.cardId, job.operationId))
      .catch(() => undefined)
  }

  /** Mark an intent this browser uploaded after the fact as confirmed on the server. */
  confirmIntent(roundId: string, cardId: string) {
    this.serverIntents.add(ratingSaveKey(roundId, cardId))
  }

  /**
   * Show the round's 未保存 grades from the server (or the local mirror) and make them
   * retryable with their original operation id. A live save keeps priority. A failed
   * entry this browser knew the server held, but which is no longer listed, was saved
   * or cleared on another device, so it is dropped.
   */
  hydrateIntents(
    roundId: string,
    items: HydratedRatingIntent[],
    prepareFor: (cardId: string) => (() => Promise<RatingTarget>) | null,
  ) {
    const listed = new Set<string>()
    for (const item of items) {
      const rating = asRating(item.rating)
      if (!rating || !item.card_id) continue
      const key = ratingSaveKey(roundId, item.card_id)
      const current = this.entries.get(key)
      if (current?.status === 'saving') continue
      listed.add(key)
      const payload = item.payload ?? {}
      const target = targetFromPayload(payload)
      this.requests.set(key, {
        roundId,
        cardId: item.card_id,
        occurrenceId: typeof payload.occurrence_id === 'string' ? payload.occurrence_id : '',
        rating,
        planVersion: Number(payload.expected_version) || 0,
        target,
        prepare: target ? null : prepareFor(item.card_id),
        closeAfterAck: false,
      })
      if (item.confirmed !== false) this.serverIntents.add(key)
      this.setEntry({
        key,
        roundId,
        cardId: item.card_id,
        rating,
        operationId: item.operation_id,
        sequence: current?.sequence ?? 0,
        status: 'failed',
        pendingKind: null,
        failure: asFailure(item.failure),
        detail: null,
        target: target ?? current?.target ?? null,
        ackedRating: current?.ackedRating ?? null,
        ackedOperationId: current?.ackedOperationId ?? null,
      })
    }
    for (const key of [...this.serverIntents]) {
      if (!key.startsWith(`${roundId}::`) || listed.has(key)) continue
      this.serverIntents.delete(key)
      if (this.entries.get(key)?.status === 'failed') {
        this.entries.delete(key)
        this.requests.delete(key)
      }
    }
    this.changed()
  }

  private fail(key: string, job: RatingJob, failure: RatingSaveFailure, error: unknown) {
    const entry = this.entries.get(key)
    const current = entry?.operationId === job.operationId
    // Already saved (a retry landed first), already reported (the timeout fired),
    // or a retry of the same operation now owns the entry: the late error adds nothing.
    if (current && (entry?.status !== 'saving' || entry.sequence !== job.sequence)) return
    if (current && entry) {
      const target = job.target ?? entry.target
      this.setEntry({
        ...entry,
        status: 'failed',
        pendingKind: null,
        rating: job.rating,
        failure,
        detail: error instanceof Error ? error.message : String(error ?? ''),
        target,
      })
      this.persistIntent(key, job, failure, target)
    }
    this.emit({ type: 'failed', roundId: job.roundId, cardId: job.cardId, job, failure, error, current })
  }

  private async runUndo(key: string, task: Extract<LaneTask, { kind: 'undo' }>) {
    const previous = this.entries.get(key)
    const undoneRating = previous?.ackedRating ?? null
    try {
      let operationId: string | null = task.operationId
      let last: UndoneUnitResult | null = null
      const seen = new Set<string>()
      while (operationId && !seen.has(operationId)) {
        seen.add(operationId)
        const result: UndoneUnitResult = await this.deps.undo(operationId, task.roundId)
        last = result
        operationId = result.encounter.effective_operation_id
        if (!task.clearAll || result.encounter.selected_rating == null) break
      }
      if (!last) throw new Error('nothing to undo')
      const rating = asRating(last.encounter.selected_rating)
      this.patchEntry(key, task, {
        status: 'saved',
        pendingKind: null,
        rating,
        failure: null,
        detail: null,
        ackedRating: rating,
        ackedOperationId: last.encounter.effective_operation_id ?? null,
      })
      this.emit({ type: 'undone', roundId: task.roundId, cardId: task.cardId, result: last, undoneRating })
    } catch (error) {
      this.patchEntry(key, task, {
        status: 'saved',
        pendingKind: null,
        rating: previous?.ackedRating ?? null,
      })
      this.emit({
        type: 'undoFailed',
        roundId: task.roundId,
        cardId: task.cardId,
        error,
        operationId: task.operationId,
      })
    } finally {
      this.release(key, task)
    }
  }
}
