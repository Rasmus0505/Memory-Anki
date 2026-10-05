import { useSyncExternalStore } from 'react'
import { getUnitReviewPreviewApi, type UnitReviewSessionDto } from '@/modules/practice/public'
import type { FreestyleCard, FreestyleReviewUnitCard } from '@/shared/api/contracts'
import { createVersionedCache } from '@/shared/persistence/versionedCacheStore'
/**
 * Read-only unit previews so a feed card can draw its real map while it slides in,
 * before the encounter is opened on activation. Keyed by unit revision: a map edited
 * on the other device (Syncthing) bumps the revision and is never shown stale.
 */
const cache = createVersionedCache<UnitReviewSessionDto>('freestyle-unit-preview')
const inFlight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let version = 0
let hydrated: Promise<void> | null = null
/** Palace documents already paid for by any unit of that palace. */
const palaceDocs = new Map<number, { title: string; editor_doc: unknown }>()

function notify() {
  version += 1
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notePalaceDocument(preview: UnitReviewSessionDto) {
  const doc = preview.palace?.editor_doc
  if (doc == null) return
  palaceDocs.set(preview.palace_id, {
    title: preview.palace?.title || preview.title,
    editor_doc: doc,
  })
}

function asPaintPreview(session: UnitReviewSessionDto, unitId: string): UnitReviewSessionDto {
  return {
    ...session,
    id: session.id.startsWith('preview:') ? session.id : `preview:${unitId}`,
    status: 'preview',
    units: session.units.map((unit) => (
      unit.id === unitId ? { ...unit, encounter: null } : unit
    )),
  }
}

export function readUnitPreview(unitId: string | null | undefined, revision: number | null | undefined) {
  if (!unitId || revision == null) return null
  return cache.getSync(unitId, revision)
}

/** Re-renders when any preview lands; the lookup itself is synchronous. */
export function useUnitPreview(unitId: string | null | undefined, revision: number | null | undefined) {
  useSyncExternalStore(subscribe, () => version, () => version)
  return readUnitPreview(unitId, revision)
}

/** Palace document already paid for by any unit preview of that palace. */
export function readPalaceEditorDoc(palaceId: number | null | undefined) {
  if (palaceId == null) return null
  return palaceDocs.get(palaceId)?.editor_doc ?? null
}

/** Re-renders when a palace document lands in the preview cache. */
export function usePalaceDocumentVersion() {
  return useSyncExternalStore(subscribe, () => version, () => version)
}

/**
 * Another unit of a palace whose document is already in memory. Lets the next
 * card paint before its own preview request returns.
 */
export function sharedPalacePreviewForCard(card: FreestyleReviewUnitCard | null): UnitReviewSessionDto | null {
  if (!card?.unit_id || card.unit_revision == null) return null
  if (cache.getSync(card.unit_id, card.unit_revision)) return null
  const shared = palaceDocs.get(card.palace_id)
  if (!shared || card.node_uids.length === 0) return null
  return {
    id: `preview:${card.unit_id}`,
    palace_id: card.palace_id,
    title: shared.title || card.palace_title || '',
    status: 'preview',
    palace: {
      id: card.palace_id,
      title: shared.title || card.palace_title || '',
      editor_doc: shared.editor_doc,
    },
    units: [{
      id: card.unit_id,
      palace_id: card.palace_id,
      palace_title: card.palace_title,
      anchor_uid: card.anchor_uid,
      unit_kind: 'marked',
      title: card.palace_title || '',
      node_uids: card.node_uids,
      revision: card.unit_revision,
      stage_index: 0,
      interval_days: 0,
      has_passed: false,
      due_date: '',
      due: true,
      session_status: 'pending',
      retry_count: 0,
      hard_count: 0,
      again_count: 0,
      final_rating: null,
      encounter: null,
    }],
    pending_unit_count: 1,
    completed_unit_count: 0,
  }
}

export function useSharedPalacePreview(card: FreestyleReviewUnitCard | null) {
  useSyncExternalStore(subscribe, () => version, () => version)
  return sharedPalacePreviewForCard(card)
}

/** Copies persisted previews into memory once, so a reload paints maps from disk. */
export function hydrateUnitPreviews() {
  hydrated ??= cache.hydrate().then(notify)
  return hydrated
}

/** Keep a session's map for the next time this revision slides into view. */
export function rememberUnitPreview(unitId: string, revision: number, session: UnitReviewSessionDto) {
  const unit = session.units.find((item) => item.id === unitId)
  if (!unit || session.palace?.editor_doc == null) return
  const stored = asPaintPreview(session, unitId)
  cache.put(unitId, unit.revision, stored)
  if (revision !== unit.revision) cache.put(unitId, revision, stored)
  notePalaceDocument(stored)
  notify()
}

export function prefetchUnitPreview(unitId: string, revision: number): Promise<void> {
  if (cache.getSync(unitId, revision)) return Promise.resolve()
  const key = `${unitId}:${revision}`
  const pending = inFlight.get(key)
  if (pending) return pending
  const promise = getUnitReviewPreviewApi(unitId)
    .then((preview) => {
      const unit = preview.units.find((item) => item.id === unitId)
      if (!unit) return
      // Store under the revision the server actually returned; a newer revision than
      // the card knows about is still valid for that newer card after a rebuild.
      cache.put(unitId, unit.revision, preview)
      notePalaceDocument(preview)
      notify()
    })
    .catch(() => undefined)
    .finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

type PreviewDirection = -1 | 0 | 1

function previewTargets(
  cards: readonly FreestyleCard[],
  centerIndex: number,
  direction: PreviewDirection = 0,
  limit = 3,
) {
  const found: Array<{ unitId: string; revision: number; index: number }> = []
  cards.forEach((card, index) => {
    const unitId = 'unit_id' in card ? card.unit_id : null
    const revision = 'unit_revision' in card ? card.unit_revision : null
    if (card.type !== 'mindmap_branch' || !unitId || revision == null) return
    found.push({ unitId, revision, index })
  })
  const uniqueByUnit = new Map<string, { unitId: string; revision: number; index: number }>()
  for (const target of found) {
    const existing = uniqueByUnit.get(target.unitId)
    if (!existing || Math.abs(target.index - centerIndex) < Math.abs(existing.index - centerIndex)) {
      uniqueByUnit.set(target.unitId, target)
    }
  }
  const ranked = [...uniqueByUnit.values()].sort((a, b) => {
    const distance = Math.abs(a.index - centerIndex) - Math.abs(b.index - centerIndex)
    if (distance !== 0) return distance
    if (direction !== 0) {
      const side = (index: number) => {
        const delta = index - centerIndex
        if (delta === 0) return 0
        return Math.sign(delta) === direction ? 0 : 1
      }
      const sideOrder = side(a.index) - side(b.index)
      if (sideOrder !== 0) return sideOrder
    }
    return a.index - b.index
  })
  return ranked.slice(0, limit).map(({ unitId, revision, index }) => ({
    unitId,
    revision,
    distance: Math.abs(index - centerIndex),
  }))
}

/**
 * Background preload of the current and adjacent unit previews, two at a time so
 * it never competes with the active card's own session request.
 */
export async function prefetchRoundPreviews(
  cards: readonly FreestyleCard[],
  centerIndex: number,
  {
    signal,
    concurrency = 2,
    direction = 0,
  }: { signal?: AbortSignal; concurrency?: number; direction?: PreviewDirection } = {},
) {
  await hydrateUnitPreviews()
  const queue = previewTargets(cards, centerIndex, direction).filter(
    (target) => !cache.getSync(target.unitId, target.revision),
  )
  const worker = async () => {
    while (queue.length && !signal?.aborted) {
      const next = queue.shift()!
      await prefetchUnitPreview(next.unitId, next.revision)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
}

type PreviewJob = {
  cards: readonly FreestyleCard[]
  centerIndex: number
  direction: PreviewDirection
}

let desired: PreviewJob | null = null
let pumping = false

/**
 * Keep prefetching whatever card the feed has settled toward. A fast flip
 * replaces the target instead of aborting the useful fetch and starting over.
 */
export function requestRoundPreview(
  cards: readonly FreestyleCard[],
  centerIndex: number,
  direction: PreviewDirection = 0,
) {
  desired = { cards, centerIndex, direction }
  if (!pumping) void pumpRoundPreviews()
}

export function stopRoundPreview() {
  desired = null
}

async function pumpRoundPreviews() {
  if (pumping) return
  pumping = true
  const attempted = new Set<string>()
  let attemptJob: PreviewJob | null = null
  try {
    await hydrateUnitPreviews()
    while (desired) {
      if (desired !== attemptJob) {
        attempted.clear()
        attemptJob = desired
      }
      const job = desired
      if (!desired) break
      if (desired !== job) continue
      const target = previewTargets(job.cards, job.centerIndex, job.direction, 4).find((item) => {
        const key = `${item.unitId}:${item.revision}`
        return !cache.getSync(item.unitId, item.revision) && !attempted.has(key)
      })
      if (!target) {
        if (desired === job) desired = null
        continue
      }
      attempted.add(`${target.unitId}:${target.revision}`)
      await prefetchUnitPreview(target.unitId, target.revision)
    }
  } finally {
    pumping = false
    if (desired) void pumpRoundPreviews()
  }
}
