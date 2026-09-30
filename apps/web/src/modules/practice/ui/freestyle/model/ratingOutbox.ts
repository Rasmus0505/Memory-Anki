import type { UnitRating } from '@/modules/practice/public'

/**
 * One card's rating mailbox. The learner's latest intent paints immediately;
 * posts stay serial so a slow reply cannot overwrite a newer grade or close
 * the encounter it still references.
 */
export interface RateTicket {
  generation: number
  rating: UnitRating
  operationId: string
  cardId: string
  occurrenceId: string
  encounterId: string
  unitId: string
  sessionId: string
  unitRevision: number
}

export interface RateMailbox {
  latest: number
  inflight: RateTicket | null
  queued: RateTicket | null
  /** Inflight generation the learner already asked to undo. */
  undoAfter: number | null
}

export function emptyMailbox(): RateMailbox {
  return { latest: 0, inflight: null, queued: null, undoAfter: null }
}

/** Local pass rule: 记得 / 轻松 pass, 忘记 / 困难 do not. */
export function ratingPassed(rating: UnitRating): boolean {
  return rating >= 3
}

export function acceptRating(box: RateMailbox, ticket: Omit<RateTicket, 'generation'>): {
  box: RateMailbox
  ticket: RateTicket
  sendNow: boolean
} {
  const next: RateTicket = { ...ticket, generation: box.latest + 1 }
  if (box.inflight) {
    return {
      box: { ...box, latest: next.generation, queued: next, undoAfter: null },
      ticket: next,
      sendNow: false,
    }
  }
  return {
    box: { ...box, latest: next.generation, inflight: next, queued: null, undoAfter: null },
    ticket: next,
    sendNow: true,
  }
}

export function requestUndo(box: RateMailbox): RateMailbox {
  if (!box.inflight) return box
  return {
    ...box,
    latest: box.latest + 1,
    queued: null,
    undoAfter: box.inflight.generation,
  }
}

export function noteInflightDone(box: RateMailbox, generation: number): {
  box: RateMailbox
  send: RateTicket | null
  undo: boolean
} {
  if (box.inflight?.generation !== generation) {
    return { box, send: null, undo: false }
  }
  if (box.undoAfter === generation) {
    return {
      box: { ...box, inflight: null, queued: null, undoAfter: null },
      send: null,
      undo: true,
    }
  }
  const queued = box.queued
  if (queued && queued.generation === box.latest) {
    return {
      box: { ...box, inflight: queued, queued: null },
      send: queued,
      undo: false,
    }
  }
  return { box: { ...box, inflight: null, queued: null }, send: null, undo: false }
}

/** A reply may paint only when the learner has not moved on or asked to undo. */
export function isCurrentIntent(box: RateMailbox, generation: number): boolean {
  return box.latest === generation && box.undoAfter == null
}
