import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  uploadWithFormData: vi.fn(),
}))

vi.mock('@/shared/api/http', () => ({
  API_BASE: '/api/v1',
  request: vi.fn(),
  uploadWithFormData: mocks.uploadWithFormData,
}))

import { importEnglishCourseApi } from './englishApi'

describe('importEnglishCourseApi', () => {
  beforeEach(() => {
    mocks.uploadWithFormData.mockReset()
    mocks.uploadWithFormData.mockResolvedValue({
      course: { id: 12 },
      matchedTranslationCount: 2,
    })
  })

  it('posts the video, required English subtitle, optional Chinese track, and title', async () => {
    const videoFile = new File(['video'], 'lesson.mp4', { type: 'video/mp4' })
    const english = new File(['en'], 'lesson.en.srt', { type: 'text/plain' })
    const chinese = new File(['zh'], 'lesson.zh.srt', { type: 'text/plain' })

    await importEnglishCourseApi({
      videoFile,
      englishSubtitle: english,
      chineseSubtitle: chinese,
      title: '  My Lesson  ',
    })

    expect(mocks.uploadWithFormData).toHaveBeenCalledTimes(1)
    const [url, formData] = mocks.uploadWithFormData.mock.calls[0]
    expect(url).toBe('/english/import')
    expect(formData).toBeInstanceOf(FormData)
    expect((formData as FormData).get('video_file')).toBe(videoFile)
    expect((formData as FormData).get('english_subtitle')).toBe(english)
    expect((formData as FormData).get('chinese_subtitle')).toBe(chinese)
    expect((formData as FormData).get('title')).toBe('My Lesson')
  })

  it('omits the optional Chinese track and blank title', async () => {
    const videoFile = new File(['video'], 'lesson.mp4', { type: 'video/mp4' })
    const english = new File(['en'], 'lesson.en.vtt', { type: 'text/plain' })

    await importEnglishCourseApi({
      videoFile,
      englishSubtitle: english,
      chineseSubtitle: null,
      title: '   ',
    })

    const [, formData] = mocks.uploadWithFormData.mock.calls[0]
    expect((formData as FormData).get('chinese_subtitle')).toBeNull()
    expect((formData as FormData).get('title')).toBeNull()
  })
})
