/**
 * Cached palace → knowledge binding for time attribution.
 *
 * A dwell record must stamp subject/chapter onto its ledger interval, but the
 * session module must not reach into the knowledge module's stores while a
 * timer is closing. Instead the knowledge UI publishes the binding here whenever
 * it loads a palace, and the session module reads it synchronously at record
 * build time.
 *
 * The cache is intentionally best-effort: a palace that was never opened in this
 * browser session has no binding, and the record simply carries no chapter.
 */

import type { PalaceKnowledgeBinding } from './timeRecordAttribution'

export type { PalaceKnowledgeBinding }

const bindings = new Map<number, PalaceKnowledgeBinding>()
const listeners = new Set<() => void>()

function normalize(value: unknown): number | null {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : null
}

function clean(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

/** Publish (or clear) the knowledge binding for one palace. */
export function setPalaceKnowledgeBinding(
  palaceId: number | null | undefined,
  binding: Partial<PalaceKnowledgeBinding> | null | undefined,
): void {
  const id = normalize(palaceId)
  if (!id) return
  if (!binding) {
    if (bindings.delete(id)) notify()
    return
  }
  const next: PalaceKnowledgeBinding = {
    subjectId: normalize(binding.subjectId),
    subjectName: clean(binding.subjectName),
    chapterId: normalize(binding.chapterId),
    chapterName: clean(binding.chapterName),
  }
  if (!next.subjectId && !next.chapterId && !next.subjectName && !next.chapterName) {
    if (bindings.delete(id)) notify()
    return
  }
  const previous = bindings.get(id)
  if (
    previous &&
    previous.subjectId === next.subjectId &&
    previous.subjectName === next.subjectName &&
    previous.chapterId === next.chapterId &&
    previous.chapterName === next.chapterName
  ) {
    return
  }
  bindings.set(id, next)
  notify()
}

/** Publish several bindings at once, e.g. after a knowledge tree load. */
export function setPalaceKnowledgeBindings(
  entries: Iterable<{ palaceId: number | null | undefined } & Partial<PalaceKnowledgeBinding>>,
): void {
  for (const entry of entries) {
    setPalaceKnowledgeBinding(entry.palaceId, entry)
  }
}

/** Synchronous read for the timer; returns null when unknown. */
export function peekPalaceKnowledgeBinding(
  palaceId: number | null | undefined,
): PalaceKnowledgeBinding | null {
  const id = normalize(palaceId)
  if (!id) return null
  return bindings.get(id) ?? null
}

function notify() {
  for (const listener of listeners) listener()
}

export function subscribePalaceKnowledgeBindings(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test/device-reset hook; not used by production flows. */
export function clearPalaceKnowledgeBindings(): void {
  if (bindings.size === 0) return
  bindings.clear()
  notify()
}
