import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEnglishReadingVocabularyNoteApi,
  listEnglishReadingVocabularyNotesApi,
  reviewEnglishReadingVocabularyNoteApi,
} from './englishReadingApi'
import { request } from '@/shared/api/http'

vi.mock('@/shared/api/http', () => ({
  API_BASE: 'https://api.example.test/api/v1',
  fetchWithMutationQueue: vi.fn(),
  request: vi.fn(),
  uploadWithFormData: vi.fn(),
}))

const requestMock = vi.mocked(request)

describe('english reading vocabulary api', () => {
  beforeEach(() => {
    requestMock.mockReset()
    requestMock.mockResolvedValue({})
  })

  it('lists vocabulary notes with optional due filter', async () => {
    await listEnglishReadingVocabularyNotesApi({ dueOnly: true, limit: 20 })

    expect(requestMock).toHaveBeenCalledWith(
      '/english-reading/vocabulary-notes?dueOnly=true&limit=20',
    )
  })

  it('creates and reviews vocabulary notes with persistence metadata', async () => {
    await createEnglishReadingVocabularyNoteApi({
      word: 'acquisition',
      definitionZh: '获得',
      materialId: 42,
      spanAnnotationId: 'span-2',
      cefr: 'B2',
    })
    await reviewEnglishReadingVocabularyNoteApi(7, 'good')

    expect(requestMock).toHaveBeenNthCalledWith(1, '/english-reading/vocabulary-notes', {
      method: 'POST',
      body: JSON.stringify({
        word: 'acquisition',
        definitionZh: '获得',
        materialId: 42,
        spanAnnotationId: 'span-2',
        cefr: 'B2',
      }),
      persistence: {
        resourceKey: 'english-reading:vocabulary:acquisition',
        description: '保存英语词汇笔记',
        replayMode: 'manual',
      },
    })
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/english-reading/vocabulary-notes/7/review',
      {
        method: 'POST',
        body: JSON.stringify({ result: 'good' }),
        persistence: {
          resourceKey: 'english-reading:vocabulary:7:review',
          description: '复习英语词汇笔记',
          replayMode: 'manual',
        },
      },
    )
  })
})
