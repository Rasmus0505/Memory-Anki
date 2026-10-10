/**
 * Freestyle stays mounted while a palace editor is open. Its queue update must
 * wait until that editor's leave reconcile has started and finished, otherwise
 * a same-commit rebuild reads the old units.
 */

let pending = 0
const waiters: Array<() => void> = []
let editorVisitGeneration = 0
let editorVisitOpen = false

export function beginPalaceEditorLeave(): void {
  pending += 1
}

export function endPalaceEditorLeave(): void {
  pending = Math.max(0, pending - 1)
  if (pending > 0) return
  const current = waiters.splice(0, waiters.length)
  current.forEach((resolve) => resolve())
}

export function palaceEditorLeavePending(): number {
  return pending
}

/** Count one in-flight leave flush, including a flush that already settled. */
export function trackPalaceEditorLeave(work: Promise<unknown> | undefined): void {
  beginPalaceEditorLeave()
  void Promise.resolve(work).finally(() => endPalaceEditorLeave())
}

export function waitForPalaceEditorLeave(timeoutMs = 8_000): Promise<void> {
  if (pending === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = window.setTimeout(finish, timeoutMs)
    function finish() {
      window.clearTimeout(timer)
      const index = waiters.indexOf(finish)
      if (index >= 0) waiters.splice(index, 1)
      resolve()
    }
    waiters.push(finish)
  })
}

/** One tick per palace-editor visit. Queues consume it when they become active. */
export function notePalaceEditorOpen(): void {
  if (editorVisitOpen) return
  editorVisitOpen = true
  editorVisitGeneration += 1
}

export function notePalaceEditorClosed(): void {
  editorVisitOpen = false
}

export function palaceEditorVisitGeneration(): number {
  return editorVisitGeneration
}

export function resetPalaceEditorLeaveGateForTests(): void {
  pending = 0
  waiters.splice(0, waiters.length)
  editorVisitGeneration = 0
  editorVisitOpen = false
}
