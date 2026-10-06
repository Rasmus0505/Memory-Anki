import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { emptyLiveStudyProjection } from '../../domain/session-entity/model/live-study/liveStudyModel'
import { LiveStudyPresenceContext } from './liveStudyPresenceContext'
import { useLiveStudySurfaceMirror } from './useLiveStudySurfaceMirror'

const decode = (raw: unknown) => raw as { questionId: number; revealMap: Record<string, string> }

describe('device-local surface views', () => {
  it('receives presence without applying remote question or reveal state', () => {
    const apply = vi.fn()
    const publish = vi.fn()
    function Harness() {
      useLiveStudySurfaceMirror({
        surface: 'palace_quiz', route: '/palaces/7/quiz',
        view: { questionId: 41, revealMap: {} }, decode, apply,
      })
      return null
    }
    render(<LiveStudyPresenceContext.Provider value={{
      clientId: 'local', connected: true, isController: false, publish,
      projection: { ...emptyLiveStudyProjection(), revision: 2, surface: 'palace_quiz',
        route: '/palaces/7/quiz', view: { questionId: 42, revealMap: { root: 'revealed' } } },
    }}><Harness /></LiveStudyPresenceContext.Provider>)
    expect(apply).not.toHaveBeenCalled()
  })
})
