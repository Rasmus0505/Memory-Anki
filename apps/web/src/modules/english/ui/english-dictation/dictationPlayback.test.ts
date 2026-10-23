import { describe, expect, it } from 'vitest'
import type { EnglishCourseSentence } from '@/shared/api/contracts'
import { resolvePlaybackBoundary } from './dictationControllerUtils'

const sentences: EnglishCourseSentence[] = [
  {
    id: 1,
    index: 0,
    textEn: 'first',
    textZh: '',
    startMs: 0,
    endMs: 1000,
    tokens: ['first'],
  },
  {
    id: 2,
    index: 1,
    textEn: 'second',
    textZh: '',
    startMs: 1100,
    endMs: 2200,
    tokens: ['second'],
  },
]

describe('resolvePlaybackBoundary', () => {
  it('single mode pauses at the end of the current sentence', () => {
    expect(resolvePlaybackBoundary(sentences, 0, 500, 'single')).toEqual({ kind: 'continue' })
    expect(resolvePlaybackBoundary(sentences, 0, 1000, 'single')).toEqual({ kind: 'pause' })
    expect(resolvePlaybackBoundary(sentences, 1, 1000, 'single')).toEqual({ kind: 'continue' })
  })

  it('continuous mode follows the playhead across sentence boundaries', () => {
    expect(resolvePlaybackBoundary(sentences, 0, 500, 'continuous')).toEqual({ kind: 'continue' })
    expect(resolvePlaybackBoundary(sentences, 0, 1050, 'continuous')).toEqual({
      kind: 'advance',
      index: 1,
    })
    expect(resolvePlaybackBoundary(sentences, 0, 1500, 'continuous')).toEqual({
      kind: 'advance',
      index: 1,
    })
    expect(resolvePlaybackBoundary(sentences, 1, 1500, 'continuous')).toEqual({ kind: 'continue' })
  })

  it('continuous mode pauses only at the end of the final sentence', () => {
    expect(resolvePlaybackBoundary(sentences, 1, 2200, 'continuous')).toEqual({ kind: 'pause' })
    expect(resolvePlaybackBoundary(sentences, 0, 2300, 'continuous')).toEqual({ kind: 'pause' })
  })

  it('follows a backward seek in continuous mode', () => {
    expect(resolvePlaybackBoundary(sentences, 1, 400, 'continuous')).toEqual({
      kind: 'advance',
      index: 0,
    })
  })

  it('pauses when there are no sentences', () => {
    expect(resolvePlaybackBoundary([], 0, 0, 'continuous')).toEqual({ kind: 'pause' })
  })
})
