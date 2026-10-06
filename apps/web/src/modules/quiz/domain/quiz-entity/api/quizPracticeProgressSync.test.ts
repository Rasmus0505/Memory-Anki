import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startQuizPracticeProgressSync } from './quizPracticeProgressSync'
import { clearQuizPracticeProgressApi, getQuizPracticeProgressApi, saveQuizPracticeProgressApi } from './quizApi'
import { readQuizPracticeProgressSnapshot, subscribeQuizPracticeProgressPersist } from '../model/quizSessionProgress'
import type { QuizPracticeProgressSnapshot } from '../model/quizSessionProgress'

vi.mock('./quizApi', () => ({
  getQuizPracticeProgressApi: vi.fn(),
  saveQuizPracticeProgressApi: vi.fn(),
  clearQuizPracticeProgressApi: vi.fn(),
}))
vi.mock('../model/quizSessionProgress', () => ({
  readQuizPracticeProgressSnapshot: vi.fn(),
  mergeQuizPracticeProgressSnapshot: vi.fn(),
  subscribeQuizPracticeProgressPersist: vi.fn(),
}))

const emptyWire = { items: [], clears: { all: null, palaces: {}, questions: {} } }
let local: QuizPracticeProgressSnapshot
let persist: () => void
let stop: (() => void) | undefined

function answer(id: number, stamp = '2026-08-01T02:00:00.000Z') {
  local.items[String(id)] = { palaceId: 7, state: { resolved: true }, updatedAt: stamp }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  local = { items: {}, clears: { all: null, palaces: {}, questions: {} } }
  vi.mocked(readQuizPracticeProgressSnapshot).mockImplementation(() => structuredClone(local))
  vi.mocked(subscribeQuizPracticeProgressPersist).mockImplementation((listener) => {
    persist = listener
    return vi.fn()
  })
  vi.mocked(getQuizPracticeProgressApi).mockResolvedValue(emptyWire)
  vi.mocked(saveQuizPracticeProgressApi).mockImplementation(async (items) => ({ ...emptyWire, items }))
  vi.mocked(clearQuizPracticeProgressApi).mockResolvedValue(emptyWire)
})
afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
})

describe('quiz progress synchronization', () => {
  it('uploads local answers missing from the startup response', async () => {
    answer(41)
    stop = startQuizPracticeProgressSync()
    await vi.advanceTimersByTimeAsync(300)
    expect(saveQuizPracticeProgressApi).toHaveBeenCalledWith([
      expect.objectContaining({ question_id: 41 }),
    ])
  })

  it('drains changes made while a save is in flight', async () => {
    let resolve!: (value: typeof emptyWire) => void
    vi.mocked(saveQuizPracticeProgressApi).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    stop = startQuizPracticeProgressSync()
    await vi.advanceTimersByTimeAsync(300)
    answer(41)
    persist()
    await vi.advanceTimersByTimeAsync(300)
    answer(42)
    persist()
    await vi.advanceTimersByTimeAsync(300)
    resolve(emptyWire)
    await vi.advanceTimersByTimeAsync(300)
    expect(saveQuizPracticeProgressApi).toHaveBeenCalledTimes(2)
    expect(vi.mocked(saveQuizPracticeProgressApi).mock.calls[1][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ question_id: 42 }),
    ]))
  })

  it('keeps distinct clear timestamps instead of applying an old global timestamp to new clears', async () => {
    local.clears.all = '2026-08-01T00:00:00.000Z'
    local.clears.questions['41'] = '2026-08-01T01:00:00.000Z'
    stop = startQuizPracticeProgressSync()
    await vi.advanceTimersByTimeAsync(300)
    expect(clearQuizPracticeProgressApi).toHaveBeenCalledWith(expect.objectContaining({
      question_ids: [41], cleared_at: '2026-08-01T01:00:00.000Z',
    }))
  })

  it('keeps pending status when a save fails and recovers after reconnect', async () => {
    answer(41)
    const status = vi.fn()
    vi.mocked(saveQuizPracticeProgressApi).mockRejectedValueOnce(new Error('offline'))
    stop = startQuizPracticeProgressSync(status)
    await vi.advanceTimersByTimeAsync(300)
    expect(status).toHaveBeenLastCalledWith('pending')
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(300)
    expect(status).toHaveBeenLastCalledWith('synced')
  })

  it('does not claim synchronization when the startup read fails without local edits', async () => {
    vi.mocked(getQuizPracticeProgressApi).mockRejectedValue(new Error('offline'))
    const status = vi.fn()
    stop = startQuizPracticeProgressSync(status)
    await vi.advanceTimersByTimeAsync(300)
    expect(status).toHaveBeenLastCalledWith('unavailable')
  })

  it('stops refresh polling and ignores late reads after disposal', async () => {
    stop = startQuizPracticeProgressSync()
    await vi.advanceTimersByTimeAsync(300)
    stop()
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(getQuizPracticeProgressApi).toHaveBeenCalledTimes(1)
  })

  it('refreshes shared progress when returning to the device', async () => {
    stop = startQuizPracticeProgressSync()
    await vi.advanceTimersByTimeAsync(300)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(1)
    expect(getQuizPracticeProgressApi).toHaveBeenCalledTimes(2)
  })
})
