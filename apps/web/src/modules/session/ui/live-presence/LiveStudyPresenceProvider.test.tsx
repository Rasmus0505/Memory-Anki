import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyLiveStudyProjection } from '@/modules/session/domain/session-entity/model/live-study/liveStudyModel'
import { LiveStudyPresenceProvider } from './LiveStudyPresenceProvider'
import { useLiveStudyPresence } from './liveStudyPresenceContext'

vi.mock('@/modules/session/domain/session-entity/api/liveStudyApi', () => ({
  consumeLiveStudyStream: vi.fn(),
  publishLiveStudyCommand: vi.fn(),
}))

import { consumeLiveStudyStream, publishLiveStudyCommand } from '@/modules/session/domain/session-entity/api/liveStudyApi'

const consumeMock = vi.mocked(consumeLiveStudyStream)
const publishMock = vi.mocked(publishLiveStudyCommand)

function Probe({ onValue }: { onValue: (value: ReturnType<typeof useLiveStudyPresence>) => void }) {
  const value = useLiveStudyPresence()
  onValue(value)
  return null
}

describe('LiveStudyPresenceProvider hello hydration', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('marks connected and hydrates the projection from hello even if SSE never delivers', async () => {
    const remote = {
      ...emptyLiveStudyProjection(),
      revision: 6,
      surface: 'freestyle' as const,
      route: '/freestyle',
      view: { currentCardId: 'card-2', revealMap: { root: 'revealed', child: 'revealed' } },
      updatedAt: '2026-01-01T00:00:00Z',
    }
    publishMock.mockResolvedValue({
      accepted: true,
      duplicate: false,
      projection: remote,
    })
    consumeMock.mockImplementation((_clientId, _onEnvelope, signal) => (
      new Promise((resolve) => {
        const finish = () => resolve()
        if (signal.aborted) {
          finish()
          return
        }
        signal.addEventListener('abort', finish, { once: true })
      })
    ))
    const seen: Array<ReturnType<typeof useLiveStudyPresence>> = []
    render(
      <MemoryRouter>
        <LiveStudyPresenceProvider>
          <Probe onValue={(value) => seen.push(value)} />
        </LiveStudyPresenceProvider>
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(seen.some((value) => value?.connected && value.projection.revision === 6)).toBe(true)
    })
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'hello' }))
    const hydrated = seen.find((value) => value?.connected && value.projection.revision === 6)
    expect(hydrated?.projection.view).toEqual(remote.view)
    const streamCalls = publishMock.mock.calls.filter((call) => call[0].type !== 'hello')
    expect(streamCalls).toEqual([])
  })
})
