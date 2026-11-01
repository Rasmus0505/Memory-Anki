import { useEffect, useRef, useState } from 'react'
import { listQuestionNodeBindingsApi } from '@/modules/quiz/domain/quiz-entity/api'
import {
  collectMemoryLookupFocusNodeUids,
  pickMemoryLookupBinding,
  resolveMemoryLookupPalaceId,
} from './model/memoryLookupDialogSupport'

interface QuestionLookupFocusEntry {
  /** Bound node UIDs on the palace the lookup should open. */
  nodeUids: string[]
  /** Palace that owns the binding, else the question's own palace. */
  palaceId: number | null
}

export interface QuestionLookupFocus {
  /** Bound cards the lookup should center/highlight; empty when none are known. */
  focusNodeUids: string[]
  /** Palace override from the binding, else the question's palace. */
  palaceIdOverride: number | null
  /**
   * The bindings for this question are still being read. Opening the lookup now
   * would mount the map before its target is known — the map would fit the whole
   * palace and then fly across it, which is the jank this prefetch removes.
   */
  pending: boolean
}

interface QuestionLookupQuestion {
  id: number
  palace_id?: number | null
}

const FOCUS_READ_DEBOUNCE_MS = 150
/** Enough for a long round; evict the oldest question once it is exceeded. */
const FOCUS_CACHE_LIMIT = 400

function readFocusEntry(
  response: { items?: Array<{ node_uid?: string | null; palace_id?: number | null; target_palace_id?: number | null }> } | null | undefined,
  fallbackPalaceId: number | null,
): QuestionLookupFocusEntry {
  const items = response?.items || []
  const binding = pickMemoryLookupBinding(items, fallbackPalaceId)
  return {
    nodeUids: collectMemoryLookupFocusNodeUids(items, fallbackPalaceId),
    palaceId: resolveMemoryLookupPalaceId(binding, fallbackPalaceId),
  }
}

function readBindings(questionId: number) {
  try {
    return Promise.resolve(listQuestionNodeBindingsApi(questionId))
  } catch (error) {
    return Promise.reject(error)
  }
}

/**
 * Resolves which palace / bound nodes 查看宫殿 should center for the current
 * question. Reads run ahead of the click (debounced) so the lookup mounts
 * already knowing its target: no whole-palace fit first, then no camera flight.
 */
export function useQuestionLookupFocus(
  current: QuestionLookupQuestion | null,
  enabled: boolean,
  fallbackPalaceId?: number | null,
): QuestionLookupFocus {
  const cacheRef = useRef(new Map<number, QuestionLookupFocusEntry>())
  const [, bumpVersion] = useState(0)
  const questionId = current?.id ?? null
  const fallback = current?.palace_id ?? fallbackPalaceId ?? null
  const entry = questionId != null ? cacheRef.current.get(questionId) : undefined

  useEffect(() => {
    if (!enabled || questionId == null) return
    if (cacheRef.current.has(questionId)) return
    // Debounce: holding ArrowDown walks several questions; only the one the
    // learner settles on is worth a read.
    const timer = window.setTimeout(() => {
      const remember = (next: QuestionLookupFocusEntry) => {
        const cache = cacheRef.current
        // Refresh insertion order so the oldest question is evicted first.
        cache.delete(questionId)
        cache.set(questionId, next)
        while (cache.size > FOCUS_CACHE_LIMIT) {
          const oldest = cache.keys().next().value
          if (oldest == null) break
          cache.delete(oldest)
        }
        // The answer is worth keeping even if this effect was superseded (the
        // question changed mid-read); the cache lookup re-renders for it later.
        bumpVersion((version) => version + 1)
      }
      void readBindings(questionId)
        .then((response) => {
          remember(readFocusEntry(response, fallback))
        })
        .catch(() => {
          // A failed read must not block the lookup: open on the whole palace.
          remember({ nodeUids: [], palaceId: fallback })
        })
    }, FOCUS_READ_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [enabled, fallback, questionId])

  return {
    focusNodeUids: entry?.nodeUids ?? [],
    palaceIdOverride: entry?.palaceId ?? fallback,
    pending: enabled && questionId != null && entry == null,
  }
}
