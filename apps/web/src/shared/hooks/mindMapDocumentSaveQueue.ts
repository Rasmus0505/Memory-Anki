export type MindMapFlushSaveOptions = {
  /** Send the current snapshot even when dirty is already cleared (schedule reconcile). */
  force?: boolean
}

export function createSavePromiseTracker() {
  let current: Promise<void> | null = null
  return {
    track(run: () => Promise<unknown>) {
      const promise = run().then(() => undefined, () => undefined)
      current = promise
      void promise.finally(() => {
        if (current === promise) current = null
      })
      return promise
    },
    async wait() {
      while (current) await current
    },
  }
}
