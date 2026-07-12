import { beforeEach, describe, expect, it, vi } from 'vitest'

const studySessionApiMocks = vi.hoisted(() => ({
  createStudySessionApi: vi.fn(),
  getActiveStudySessionByTargetApi: vi.fn(),
  patchStudySessionApi: vi.fn(),
}))

vi.mock('@/entities/study-session/api', () => studySessionApiMocks)

import { saveSessionProgressApi } from './sessionProgressApi'

describe('sessionProgressApi', () => {
  beforeEach(() => {
    studySessionApiMocks.createStudySessionApi.mockReset()
    studySessionApiMocks.getActiveStudySessionByTargetApi.mockReset()
    studySessionApiMocks.patchStudySessionApi.mockReset()
  })

  it('uses one stable session id when concurrent first saves race', async () => {
    studySessionApiMocks.getActiveStudySessionByTargetApi.mockResolvedValue({ item: null })
    studySessionApiMocks.createStudySessionApi.mockImplementation(async (payload) => ({
      item: {
        ...payload,
        progress: payload.progress ?? {},
        events: [],
        summary: {},
        target_id: payload.target_id ?? null,
        palace_id: null,
        palace_segment_id: null,
        mini_palace_id: null,
        english_course_id: null,
        english_reading_material_id: null,
        effective_seconds: 0,
        idle_seconds: 0,
        pause_count: 0,
        completion_method: '',
        ended_at: null,
        deleted_at: null,
        deleted_reason: null,
        created_at: null,
        updated_at: null,
      },
    }))

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

    expect(studySessionApiMocks.createStudySessionApi).toHaveBeenCalledTimes(2)
    expect(studySessionApiMocks.createStudySessionApi.mock.calls.map(([payload]) => payload.id)).toEqual([
      'session-progress-practice-42',
      'session-progress-practice-42',
    ])
  })
})