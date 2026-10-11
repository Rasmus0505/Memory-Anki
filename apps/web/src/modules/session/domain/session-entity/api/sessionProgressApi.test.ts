import { beforeEach, describe, expect, it, vi } from 'vitest'

const httpMocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@/shared/api/http', () => httpMocks)

import { saveSessionProgressApi } from './sessionProgressApi'

describe('sessionProgressApi', () => {
  beforeEach(() => {
    httpMocks.request.mockReset()
  })

  it('keeps progress local without calling the removed study-session API', async () => {
    const result = await saveSessionProgressApi('practice', 42, {
      reveal_map: { a: 'revealed' },
      red_node_ids: ['node-1'],
      completed: false,
    }, 'save')

    expect(httpMocks.request).not.toHaveBeenCalled()
    expect(result.progress).toMatchObject({
      palace_id: 42,
      reveal_map: { a: 'revealed' },
      red_node_ids: ['node-1'],
      completed: false,
    })
  })
})
