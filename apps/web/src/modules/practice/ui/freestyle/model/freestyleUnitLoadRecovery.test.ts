import { describe, expect, it } from 'vitest'

import { freestyleUnitLoadFailureCopy } from './freestyleUnitLoadRecovery'

describe('freestyleUnitLoadFailureCopy', () => {
  it('maps a passed-unit start 400 to a choice, not English', () => {
    expect(freestyleUnitLoadFailureCopy({
      message: 'passed review unit cannot start another encounter',
      status: 400,
    })).toEqual({
      title: '这张已经评过',
      hint: '可以改评分、只看不评，或跳过。',
    })
  })

  it('maps session-required and generic load failures without raw API text', () => {
    expect(freestyleUnitLoadFailureCopy({
      message: 'Active unit review session required',
    }).title).toBe('复习会话还没准备好')
    expect(freestyleUnitLoadFailureCopy(new Error('temporary API failure'))).toEqual({
      title: '这张卡暂时打不开',
      hint: '可以重试、跳过、重建本轮，或只看不评。',
    })
  })
})
