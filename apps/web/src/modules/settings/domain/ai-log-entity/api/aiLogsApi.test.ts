import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAiCallLogApi, listAiCallLogsApi } from './aiLogsApi'

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}))

vi.mock('@/shared/api/http', () => ({
  request: requestMock,
}))

describe('ai logs api', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('filters list params and serializes backend query names', async () => {
    requestMock.mockResolvedValueOnce({ items: [] })

    await listAiCallLogsApi({
      jobId: 'job-1',
      palaceId: 12,
      provider: '',
      model: 'gpt-5-mini',
      feature: null,
      status: 'failed',
      limit: 25,
    })

    expect(requestMock).toHaveBeenCalledWith(
      '/ai-call-logs?job_id=job-1&palace_id=12&model=gpt-5-mini&status=failed&limit=25',
    )
  })

  it('uses the bare list endpoint when no filters are present', async () => {
    requestMock.mockResolvedValueOnce({ items: [] })

    await listAiCallLogsApi({ palaceId: null, jobId: '', limit: undefined })

    expect(requestMock).toHaveBeenCalledWith('/ai-call-logs')
  })

  it('loads a single log by id', async () => {
    requestMock.mockResolvedValueOnce({ id: 'log-1' })

    await getAiCallLogApi('log-1')

    expect(requestMock).toHaveBeenCalledWith('/ai-call-logs/log-1')
  })
})
