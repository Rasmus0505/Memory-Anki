import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  flushNow,
  getAutoSaveState,
  markDirty,
  registerAutoSaveTarget,
  resetAutoSaveCoordinatorForTest,
  subscribeSaveState,
} from './autosaveCoordinator'

describe('autosaveCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetAutoSaveCoordinatorForTest()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetAutoSaveCoordinatorForTest()
  })

  it('flushes dirty targets after the default autosave window', async () => {
    const flush = vi.fn(async () => undefined)
    registerAutoSaveTarget('timer:1', { flush })

    markDirty('timer:1', 'tick')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(flush).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith('scheduled')
    expect(getAutoSaveState().status).toBe('idle')
  })

  it('coalesces repeated dirty marks into one scheduled flush', async () => {
    const flush = vi.fn(async () => undefined)
    registerAutoSaveTarget('timer:1', { flush })

    markDirty('timer:1', 'tick')
    await vi.advanceTimersByTimeAsync(10_000)
    markDirty('timer:1', 'pause')
    await vi.advanceTimersByTimeAsync(20_000)

    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('retries failed flushes with the documented backoff schedule', async () => {
    const flush = vi.fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockRejectedValueOnce(new Error('second fail'))
      .mockResolvedValueOnce(undefined)
    registerAutoSaveTarget('timer:1', { flush })

    markDirty('timer:1', 'tick')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(getAutoSaveState()).toMatchObject({
      status: 'error',
      retryAttempt: 1,
      errorMessage: 'first fail',
    })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(flush).toHaveBeenCalledTimes(2)
    expect(getAutoSaveState()).toMatchObject({
      status: 'error',
      retryAttempt: 2,
      errorMessage: 'second fail',
    })

    await vi.advanceTimersByTimeAsync(15_000)
    expect(flush).toHaveBeenCalledTimes(3)
    expect(getAutoSaveState()).toMatchObject({
      status: 'idle',
      retryAttempt: 0,
      errorMessage: null,
    })
  })

  it('stops retrying once the attempt budget is exhausted', async () => {
    // Regression guard for a 47-hour livelock: a save that failed forever was
    // retried forever. The key stays dirty (only success clears it), so each tick
    // re-attempted the same doomed request. On the owner's machine this produced
    // `PUT /palaces/40/editor -> 409` every 30–60s, 3,020 times, without pause.
    const flush = vi.fn().mockRejectedValue(new Error('always fails'))
    registerAutoSaveTarget('timer:1', { flush })

    markDirty('timer:1', 'tick')

    await vi.advanceTimersByTimeAsync(30_000)   // attempt 1
    await vi.advanceTimersByTimeAsync(5_000)    // attempt 2
    await vi.advanceTimersByTimeAsync(15_000)   // attempt 3
    const attemptsWhenExhausted = flush.mock.calls.length
    expect(attemptsWhenExhausted).toBe(3)

    // Past the budget, no further attempts may be scheduled — ever.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(flush).toHaveBeenCalledTimes(attemptsWhenExhausted)
    expect(getAutoSaveState().status).toBe('error')
    expect(getAutoSaveState().errorMessage).toBe('always fails')
  })

  it('a fresh edit after exhaustion restores the retry budget', async () => {
    // Stopping must not strand the user: the next real edit has to be saved.
    const flush = vi.fn().mockRejectedValue(new Error('boom'))
    registerAutoSaveTarget('timer:1', { flush })

    markDirty('timer:1', 'tick')
    await vi.advanceTimersByTimeAsync(30_000 + 5_000 + 15_000)
    const afterExhaustion = flush.mock.calls.length

    markDirty('timer:1', 'user edited again')
    expect(getAutoSaveState().retryAttempt).toBe(0)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(flush.mock.calls.length).toBe(afterExhaustion + 1)
  })

  it('keeps edits made during a save dirty until the newer generation is saved', async () => {
    let completeSave!: () => void
    const flush = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { completeSave = resolve }))
      .mockResolvedValue(undefined)
    registerAutoSaveTarget('palace:1', { flush })
    markDirty('palace:1', 'edit A')
    const saving = flushNow('manual')
    await Promise.resolve()

    markDirty('palace:1', 'edit B')
    completeSave()
    await saving
    expect(getAutoSaveState().dirtyKeys).toEqual(['palace:1'])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(flush).toHaveBeenCalledTimes(2)
    expect(getAutoSaveState().dirtyKeys).toEqual([])
  })

  it('saves an independent target while another target is waiting', async () => {
    let completeSlow!: () => void
    const slow = vi.fn(() => new Promise<void>((resolve) => { completeSlow = resolve }))
    const fast = vi.fn(async () => undefined)
    registerAutoSaveTarget('palace:slow', { flush: slow })
    registerAutoSaveTarget('timer:fast', { flush: fast })
    markDirty('palace:slow', 'edit')
    const slowSave = flushNow('manual', ['palace:slow'])
    await Promise.resolve()

    markDirty('timer:fast', 'checkpoint')
    await flushNow('checkpoint', ['timer:fast'])
    expect(fast).toHaveBeenCalledTimes(1)
    expect(getAutoSaveState().dirtyKeys).toEqual(['palace:slow'])
    completeSlow()
    await slowSave
  })

  it('does not let one failed target retry or block a healthy target', async () => {
    const failed = vi.fn().mockRejectedValue(new Error('conflict'))
    const healthy = vi.fn().mockResolvedValue(undefined)
    registerAutoSaveTarget('palace:conflict', { flush: failed })
    registerAutoSaveTarget('timer:healthy', { flush: healthy })
    markDirty('palace:conflict', 'edit')
    markDirty('timer:healthy', 'checkpoint')
    await expect(flushNow('manual')).rejects.toThrow('conflict')
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(getAutoSaveState().dirtyKeys).toEqual(['palace:conflict'])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(failed).toHaveBeenCalledTimes(3)
    markDirty('timer:healthy', 'new checkpoint')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(healthy).toHaveBeenCalledTimes(2)
    expect(failed).toHaveBeenCalledTimes(3)
  })

  it('ignores an old generation failure and preserves the fresh edit retry budget', async () => {
    let failOld!: (error: Error) => void
    const flush = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_, reject) => { failOld = reject }))
      .mockResolvedValue(undefined)
    registerAutoSaveTarget('palace:1', { flush })
    markDirty('palace:1', 'edit A')
    const saving = flushNow('manual')
    await Promise.resolve()
    markDirty('palace:1', 'edit B')
    failOld(new Error('old conflict'))
    await saving
    expect(getAutoSaveState()).toMatchObject({ status: 'dirty', retryAttempt: 0, errorMessage: null })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('does not unregister a replacement target or clear its newer edit', async () => {
    let completeOld!: () => void
    const unregisterOld = registerAutoSaveTarget('palace:1', {
      flush: () => new Promise<void>((resolve) => { completeOld = resolve }),
    })
    markDirty('palace:1', 'old edit')
    const saving = flushNow('manual')
    await Promise.resolve()
    const replacement = vi.fn().mockResolvedValue(undefined)
    registerAutoSaveTarget('palace:1', { flush: replacement })
    unregisterOld()
    markDirty('palace:1', 'new owner edit')
    completeOld()
    await saving
    expect(getAutoSaveState().dirtyKeys).toEqual(['palace:1'])
    await flushNow('manual')
    expect(replacement).toHaveBeenCalledTimes(1)
  })

  it('publishes save state transitions to subscribers', async () => {
    const flush = vi.fn(async () => undefined)
    const listener = vi.fn()
    registerAutoSaveTarget('timer:1', { flush })
    const unsubscribe = subscribeSaveState(listener)

    markDirty('timer:1', 'tick')
    await flushNow('manual')

    unsubscribe()

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'idle',
        dirtyKeys: [],
      }),
    )
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'dirty',
        dirtyKeys: ['timer:1'],
        lastReason: 'tick',
      }),
    )
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'saving',
        lastReason: 'manual',
      }),
    )
  })
})
