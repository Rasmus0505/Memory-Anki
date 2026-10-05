import { beforeEach, describe, expect, it, vi } from 'vitest'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/shared/api/http', () => ({ request }))
import { getProgressionOverviewApi } from './progressionApi'

const overview = { level: { level: 1, xp: 0 }, quests: [], stamps: [], starmap: {} }

beforeEach(() => request.mockReset())

describe('progression overview concurrent refreshes', () => {
  it('shares a pending read and reads fresh data after settlement', async () => {
    let resolve!: (value: unknown) => void
    request.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const hud = getProgressionOverviewApi()
    const settlement = getProgressionOverviewApi()
    expect(hud).toBe(settlement)
    expect(request).toHaveBeenCalledTimes(1)
    resolve(overview)
    await expect(hud).resolves.toEqual(overview)
    request.mockResolvedValueOnce({ ...overview, level: { level: 2, xp: 100 } })
    await expect(getProgressionOverviewApi()).resolves.toMatchObject({ level: { level: 2 } })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('releases a failed request so a later refresh can recover', async () => {
    request.mockRejectedValueOnce(new Error('timeout'))
    const first = getProgressionOverviewApi()
    const second = getProgressionOverviewApi()
    await expect(first).rejects.toThrow('timeout')
    await expect(second).rejects.toThrow('timeout')
    request.mockResolvedValueOnce(overview)
    await expect(getProgressionOverviewApi()).resolves.toEqual(overview)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed data and permits retry', async () => {
    request.mockResolvedValueOnce({ html: 'offline' })
    await expect(getProgressionOverviewApi()).rejects.toThrow('成长数据格式不完整。')
    request.mockResolvedValueOnce(overview)
    await expect(getProgressionOverviewApi()).resolves.toEqual(overview)
  })
})
