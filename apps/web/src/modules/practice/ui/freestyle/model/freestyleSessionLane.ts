/**
 * One freestyle session mutation at a time.
 *
 * Rapid paging used to POST a session start and a cancel for every card the
 * viewport touched. Those writes piled onto SQLite and surfaced as
 * "加载单元超时" or "encounter_id belongs to another review unit".
 * Tasks run in order; a reset drops the queue so a superseded card never
 * starts behind the one the learner actually stopped on.
 */

let epoch = 0
let depth = 0
let tail: Promise<void> = Promise.resolve()
const idleWaiters: Array<() => void> = []

function wakeIdleWaiters() {
  if (depth !== 0) return
  const waiters = idleWaiters.splice(0)
  waiters.forEach((waiter) => waiter())
}

export function freestyleSessionLaneBusy() {
  return depth > 0
}

/** Resolves once queued session writes have finished. */
export function whenFreestyleSessionLaneIdle(): Promise<void> {
  if (depth === 0) return Promise.resolve()
  return new Promise((resolve) => {
    idleWaiters.push(resolve)
  })
}

export function enqueueFreestyleSessionTask(task: () => Promise<unknown>): Promise<void> {
  const ticket = epoch
  depth += 1
  const run = tail.then(async () => {
    if (ticket !== epoch) return
    try {
      await task()
    } catch {
      // The task reports its own failure. A throw must not wedge the next card.
    }
  })
  tail = run.then(
    () => {
      if (ticket === epoch) {
        depth = Math.max(0, depth - 1)
        wakeIdleWaiters()
      }
    },
    () => {
      if (ticket === epoch) {
        depth = Math.max(0, depth - 1)
        wakeIdleWaiters()
      }
    },
  )
  return run
}

export function resetFreestyleSessionLaneForTests() {
  epoch += 1
  depth = 0
  tail = Promise.resolve()
  wakeIdleWaiters()
}

/** How long a card must stay active before a session write is worth sending. */
export const FREESTYLE_SESSION_OPEN_DELAY_MS = 160
