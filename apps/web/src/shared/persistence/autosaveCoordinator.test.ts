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
