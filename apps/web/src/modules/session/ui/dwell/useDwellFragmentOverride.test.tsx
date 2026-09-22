import { renderHook } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'
import {
  peekDwellFragmentOverride,
  resetDwellFragmentOverridesForTests,
} from '@/modules/session/domain/session-entity/model/timed-session/dwellFragmentOverride'
import { useDwellFragmentOverride } from './useDwellFragmentOverride'

describe('useDwellFragmentOverride', () => {
  beforeEach(() => {
    resetDwellFragmentOverridesForTests()
  })

  it('keeps 查看宫殿 above 做题 when the quiz palace changes', () => {
    const quiz = renderHook(
      ({ palaceId }: { palaceId: number | null }) => useDwellFragmentOverride(true, {
        scene: 'quiz',
        kind: 'quiz',
        title: '做题',
        palaceId,
        sourceKind: palaceId != null ? 'palace' : null,
        priority: 1,
      }),
      { initialProps: { palaceId: 1 as number | null } },
    )
    const lookup = renderHook(() => useDwellFragmentOverride(true, {
      scene: 'practice',
      kind: 'practice',
      title: '查看宫殿',
      palaceId: 2,
      sourceKind: 'palace',
      priority: 2,
    }))

    expect(peekDwellFragmentOverride()?.title).toBe('查看宫殿')

    quiz.rerender({ palaceId: 9 })
    expect(peekDwellFragmentOverride()).toMatchObject({
      title: '查看宫殿',
      palaceId: 2,
    })

    lookup.unmount()
    expect(peekDwellFragmentOverride()).toMatchObject({
      title: '做题',
      palaceId: 9,
    })

    quiz.unmount()
    expect(peekDwellFragmentOverride()).toBeNull()
  })
})
