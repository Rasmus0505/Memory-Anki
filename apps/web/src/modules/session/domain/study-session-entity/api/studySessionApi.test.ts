import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/api/http', () => ({
  request: requestMock,
}))

import {
  createStudySessionFromTimeRecordApi,
  patchStudySessionApi,
} from './studySessionApi'

describe('study session write metadata', () => {
  beforeEach(() => {
    requestMock.mockReset()
    requestMock.mockResolvedValue({ item: null })
  })

  it('normalizes timer record metadata to the wire contract', async () => {
    await createStudySessionFromTimeRecordApi({
      id: 'timer-1',
      sessionKey: 'palace:42',
      clientRevision: 3,
      operationId: 'timer-op-3',
      kind: 'practice',
      completionMethod: 'left_page',
    })

    const [, init] = requestMock.mock.calls[0] as [string, { body: string }]
    expect(JSON.parse(init.body)).toMatchObject({
      session_key: 'palace:42',
      client_revision: 3,
      operation_id: 'timer-op-3',
    })
  })

  it('uses a stable timer operation and initial revision when omitted', async () => {
    await createStudySessionFromTimeRecordApi({
      id: 'timer-2',
      kind: 'practice',
      completionMethod: 'left_page',
    })

    const [, init] = requestMock.mock.calls[0] as [string, { body: string }]
    expect(JSON.parse(init.body)).toMatchObject({
      client_revision: 1,
      operation_id: 'timer:timer-2:left_page',
    })
  })

  it('adds an operation id to ordinary patches without changing caller fields', () => {
    patchStudySessionApi('session-1', {
      scene: 'practice',
      session_key: 'palace:42',
      client_revision: 4,
    })

    const [, init] = requestMock.mock.calls[0] as [string, { body: string }]
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body).toMatchObject({
      scene: 'practice',
      session_key: 'palace:42',
      client_revision: 4,
    })
    expect(body.operation_id).toEqual(expect.any(String))
  })
})
