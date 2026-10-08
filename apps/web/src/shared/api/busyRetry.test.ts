import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isBusyResponseError, retryWhileBusy } from './busyRetry'

function busyError(status = 503) {
  const error = new Error('数据正在写入中，请稍候重试。') as Error & { status?: number }
  error.status = status
  return error
}

describe('retryWhileBusy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries a 503 and succeeds on the next attempt', async () => {
    // The exact production shape: the server answers 503 + Retry-After while a
    // write lock is held, and the write itself is fine. Before this, the card
    // died on the first 503 and only a manual 重试 click moved it.
    const attempt = vi.fn()
      .mockRejectedValueOnce(busyError())
      .mockResolvedValueOnce({ item: { ok: true } })

    const promise = retryWhileBusy(attempt, { delaysMs: [10] })
    await vi.advanceTimersByTimeAsync(20)

    await expect(promise).resolves.toEqual({ item: { ok: true } })
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('reuses one correlation id across every attempt', async () => {
    // All attempts must collapse into one traceable action in the server log,
    // otherwise a retried card looks like several unrelated requests.
    const attempt = vi.fn()
      .mockRejectedValueOnce(busyError())
      .mockRejectedValueOnce(busyError())
      .mockResolvedValueOnce('done')

    const promise = retryWhileBusy(attempt, { delaysMs: [5, 5] })
    await vi.advanceTimersByTimeAsync(30)
    await promise

    const ids = attempt.mock.calls.map((call) => (call[0] as Record<string, string>)['X-Request-ID'])
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toEqual(expect.any(String))
  })

  it('gives up after the schedule is exhausted and rethrows the busy error', async () => {
    const attempt = vi.fn().mockRejectedValue(busyError())

    const promise = retryWhileBusy(attempt, { delaysMs: [5, 5] })
    const assertion = expect(promise).rejects.toThrow('数据正在写入中')
    await vi.advanceTimersByTimeAsync(40)
    await assertion

    expect(attempt).toHaveBeenCalledTimes(3)
  })

  it('never retries a non-busy failure', async () => {
    // A 409 conflict must reach the UI so it can repair state; retrying it would
    // hide a real divergence, and a 400 can never succeed.
    const attempt = vi.fn().mockRejectedValue(busyError(409))

    await expect(retryWhileBusy(attempt, { delaysMs: [5, 5] })).rejects.toThrow()
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('reports each retry so the UI can show progress', async () => {
    const onRetry = vi.fn()
    const attempt = vi.fn()
      .mockRejectedValueOnce(busyError())
      .mockResolvedValueOnce('done')

    const promise = retryWhileBusy(attempt, { delaysMs: [5], onRetry })
    await vi.advanceTimersByTimeAsync(20)
    await promise

    expect(onRetry).toHaveBeenCalledWith(1)
  })

  it('classifies only 503 as busy', () => {
    expect(isBusyResponseError(busyError(503))).toBe(true)
    expect(isBusyResponseError(busyError(500))).toBe(false)
    expect(isBusyResponseError(new Error('plain'))).toBe(false)
    expect(isBusyResponseError(null)).toBe(false)
  })
})
