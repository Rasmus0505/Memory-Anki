import { describe, expect, it } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/domain/feedConfig'
import { overlayQuizPalaceIds, overlayQuizRangeLabel } from './overlayQuizRange'

describe('overlayQuizRange', () => {
  it('prefers quiz stream palace ids, then memory palace ids', () => {
    const quizFirst = overlayQuizPalaceIds({
      ...DEFAULT_FREESTYLE_FEED_CONFIG,
      streams: {
        ...DEFAULT_FREESTYLE_FEED_CONFIG.streams,
        quiz: { ...DEFAULT_FREESTYLE_FEED_CONFIG.streams.quiz, specific_palace_ids: [3, 4] },
        memory_palace: {
          ...DEFAULT_FREESTYLE_FEED_CONFIG.streams.memory_palace,
          specific_palace_ids: [1, 2],
        },
      },
    })
    expect(quizFirst).toEqual([3, 4])
    expect(
      overlayQuizPalaceIds({
        ...DEFAULT_FREESTYLE_FEED_CONFIG,
        streams: {
          ...DEFAULT_FREESTYLE_FEED_CONFIG.streams,
          memory_palace: {
            ...DEFAULT_FREESTYLE_FEED_CONFIG.streams.memory_palace,
            specific_palace_ids: [9],
          },
        },
      }),
    ).toEqual([9])
  })

  it('labels an empty explicit list as the whole configured range', () => {
    expect(overlayQuizRangeLabel(DEFAULT_FREESTYLE_FEED_CONFIG)).toBe('当前配置下的全部宫殿')
  })
})
