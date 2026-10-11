import { beforeEach, describe, expect, it, vi } from 'vitest'

const httpMocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@/shared/api/http', () => httpMocks)

import { saveSessionProgressApi } from './sessionProgressApi'

describe('sessionProgressApi', () => {
  beforeEach(() => {
    httpMocks.request.mockReset()
  })

  it('uses one stable session id when concurrent first saves race', async () => {
    httpMocks.request.mockImplementation(async (path: string, init?: { method?: string, body?: string }) => {
      if (path.startsWith('/study-sessions/by-target')) return { item: null }
      const payload = JSON.parse(init?.body ?? '{}')
      return {
        item: {
          id: payload.id,
          palace_id: null,
          progress: payload.progress ?? {},
          updated_at: null,
        },
      }
    })

    await Promise.all([
      saveSessionProgressApi('practice', 42, {
        reveal_map: {},
        red_node_ids: [],
        completed: false,
      }, 'save one'),
      saveSessionProgressApi('practice', 42, {
        reveal_map: {},
        red_node_ids: ['node-1'],
        completed: false,
      }, 'save two'),
    ])

    const createdIds = httpMocks.request.mock.calls
      .filter(([path]) => path === '/study-sessions')
      .map(([, init]) => JSON.parse(init.body).id)
    expect(createdIds).toEqual(['session-progress-practice-42', 'session-progress-practice-42'])
  })
})
