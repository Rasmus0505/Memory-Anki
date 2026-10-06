import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity/model/quizRuntime'
import {
  mergeQuizPracticeProgressSnapshot,
  readQuizPracticeProgressSnapshot,
  subscribeQuizPracticeProgressPersist,
  type QuizPracticeProgressSnapshot,
} from '@/modules/quiz/domain/quiz-entity/model/quizSessionProgress'
import {
  clearQuizPracticeProgressApi,
  getQuizPracticeProgressApi,
  saveQuizPracticeProgressApi,
  type QuizPracticeProgressWire,
} from './quizApi'

function wireToSnapshot(wire: QuizPracticeProgressWire): QuizPracticeProgressSnapshot {
  const items: QuizPracticeProgressSnapshot['items'] = {}
  for (const item of wire.items || []) {
    const questionId = Number(item.question_id)
    if (!Number.isInteger(questionId) || questionId <= 0) continue
    items[String(questionId)] = {
      palaceId: item.palace_id,
      state: (item.state || {}) as QuizRuntimeState,
      updatedAt: item.updated_at || '',
    }
  }
  return {
    items,
    clears: {
      all: wire.clears?.all || null,
      palaces: { ...(wire.clears?.palaces || {}) },
      questions: { ...(wire.clears?.questions || {}) },
    },
  }
}

/**
 * Restore 已做 from the database after refresh, and push later local answers.
 * A failed request leaves the local copy in place.
 */
export type QuizProgressSyncStatus = 'syncing' | 'pending' | 'synced' | 'unavailable'

export function startQuizPracticeProgressSync(onStatus?: (status: QuizProgressSyncStatus) => void) {
  let stopped = false
  let timer: number | null = null
  let pushing = false
  let pulling = false
  let pushRequested = false
  let lastPullSucceeded = false
  const pushedItems = new Map<number, string>()
  const pushedClears = {
    all: '',
    palaces: {} as Record<string, string>,
    questions: {} as Record<string, string>,
  }

  function remember(snapshot: QuizPracticeProgressSnapshot) {
    pushedItems.clear()
    for (const [rawId, item] of Object.entries(snapshot.items)) {
      pushedItems.set(Number(rawId), item.updatedAt)
    }
    pushedClears.all = snapshot.clears.all || ''
    pushedClears.palaces = { ...snapshot.clears.palaces }
    pushedClears.questions = { ...snapshot.clears.questions }
  }

  async function pull() {
    if (stopped || pulling || pushing) return
    pulling = true
    lastPullSucceeded = false
    onStatus?.('syncing')
    try {
      const remote = await getQuizPracticeProgressApi()
      if (stopped) return
      const snapshot = wireToSnapshot(remote)
      mergeQuizPracticeProgressSnapshot(snapshot)
      // Only the server response acknowledges a save, never the merged local copy.
      remember(snapshot)
      lastPullSucceeded = true
    } finally {
      pulling = false
    }
  }

  async function push() {
    if (stopped) return
    if (pushing || pulling) {
      pushRequested = true
      return
    }
    pushing = true
    pushRequested = false
    try {
      const local = readQuizPracticeProgressSnapshot()
      const palaceIds = Object.entries(local.clears.palaces)
        .filter(([id, stamp]) => stamp > (pushedClears.palaces[id] || ''))
        .map(([id]) => Number(id))
      const questionIds = Object.entries(local.clears.questions)
        .filter(([id, stamp]) => stamp > (pushedClears.questions[id] || ''))
        .map(([id]) => Number(id))
      const clearAll = Boolean(local.clears.all && local.clears.all > pushedClears.all)
      const clearGroups = new Map<string, { all: boolean; palace_ids: number[]; question_ids: number[] }>()
      const groupFor = (stamp: string) => {
        let group = clearGroups.get(stamp)
        if (!group) {
          group = { all: false, palace_ids: [], question_ids: [] }
          clearGroups.set(stamp, group)
        }
        return group
      }
      if (clearAll && local.clears.all) groupFor(local.clears.all).all = true
      for (const id of palaceIds) groupFor(local.clears.palaces[String(id)]).palace_ids.push(id)
      for (const id of questionIds) groupFor(local.clears.questions[String(id)]).question_ids.push(id)
      for (const [stamp, group] of [...clearGroups].sort(([a], [b]) => a.localeCompare(b))) {
        if (stopped) return
        const remote = await clearQuizPracticeProgressApi({ ...group, cleared_at: stamp })
        if (!stopped) mergeQuizPracticeProgressSnapshot(wireToSnapshot(remote))
      }
      const items = Object.entries(local.items)
        .filter(([rawId, item]) => item.updatedAt > (pushedItems.get(Number(rawId)) || ''))
        .map(([rawId, item]) => ({
          question_id: Number(rawId),
          palace_id: item.palaceId,
          state: item.state as Record<string, unknown>,
          updated_at: item.updatedAt,
        }))
      if (items.length > 0) {
        const remote = await saveQuizPracticeProgressApi(items)
        if (!stopped) mergeQuizPracticeProgressSnapshot(wireToSnapshot(remote))
      }
      if (!stopped) {
        remember(local)
        const verified = lastPullSucceeded || items.length > 0 || clearGroups.size > 0
        onStatus?.(pushRequested ? 'pending' : verified ? 'synced' : 'unavailable')
      }
    } catch {
      if (!stopped) onStatus?.('pending')
      // The durable local copy and mutation queue retain failed operations.
    } finally {
      pushing = false
      if (!stopped && pushRequested) {
        pushRequested = false
        schedulePush()
      }
    }
  }

  function schedulePush() {
    if (stopped) return
    if (timer != null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      void push()
    }, 250)
  }

  const pullAndPush = () => {
    void pull()
      .catch(() => {
        if (!stopped) onStatus?.('unavailable')
      })
      .finally(() => {
        if (!stopped) schedulePush()
      })
  }
  pullAndPush()
  const unsubscribe = subscribeQuizPracticeProgressPersist(() => {
    pushRequested = true
    onStatus?.('pending')
    schedulePush()
  })
  const refresh = () => {
    pullAndPush()
  }
  const refreshVisible = () => {
    if (document.visibilityState === 'visible') refresh()
  }
  const interval = window.setInterval(refreshVisible, 15_000)
  window.addEventListener('focus', refresh)
  window.addEventListener('online', refresh)
  document.addEventListener('visibilitychange', refreshVisible)
  return () => {
    stopped = true
    unsubscribe()
    window.removeEventListener('focus', refresh)
    window.removeEventListener('online', refresh)
    document.removeEventListener('visibilitychange', refreshVisible)
    window.clearInterval(interval)
    if (timer != null) window.clearTimeout(timer)
  }
}
