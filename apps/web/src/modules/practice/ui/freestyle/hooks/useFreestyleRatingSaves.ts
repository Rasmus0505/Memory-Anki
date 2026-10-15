import { useEffect, useRef, useSyncExternalStore } from 'react'
import { freestyleRatingSaves } from '@/modules/practice/ui/freestyle/model/ratingSaveRuntime'
import {
  applyRatingSaveEvent,
  type RatingLedgerHandlers,
} from '@/modules/practice/ui/freestyle/model/ratingSaveLedger'
import type {
  RatingSaveEntry,
  RatingSaveEvent,
} from '@/modules/practice/ui/freestyle/model/ratingSaveStore'

const EMPTY_ENTRIES: Record<string, RatingSaveEntry> = {}

/** This card's save state: 保存中 / 已保存 / 未保存, or null when it never rated here. */
export function useRatingSaveEntry(roundId: string, cardId: string): RatingSaveEntry | null {
  const store = freestyleRatingSaves()
  return useSyncExternalStore(store.subscribe, () => store.getEntry(roundId, cardId))
}

/** Every card's save state in this round, keyed by card id. */
export function useRatingSaveEntries(roundId: string): Record<string, RatingSaveEntry> {
  const store = freestyleRatingSaves()
  return useSyncExternalStore(
    store.subscribe,
    () => (roundId ? store.getRoundEntries(roundId) : EMPTY_ENTRIES),
  )
}

/** How many ratings of this round are 未保存. */
export function useRatingSaveFailedCount(roundId: string): number {
  const store = freestyleRatingSaves()
  return useSyncExternalStore(store.subscribe, () => (roundId ? store.failedCount(roundId) : 0))
}

/** Outbox events while this component is mounted. The latest listener is always used. */
export function useRatingSaveEvents(listener: (event: RatingSaveEvent) => void) {
  const ref = useRef(listener)
  ref.current = listener
  useEffect(() => freestyleRatingSaves().listen((event) => ref.current(event)), [])
}

/** The page's single ledger owner: acknowledged ratings update round progress here. */
export function useRatingSaveLedger(handlers: RatingLedgerHandlers) {
  useRatingSaveEvents((event) => applyRatingSaveEvent(event, handlers))
}
