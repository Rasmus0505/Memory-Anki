import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pathname: '/dashboard',
  start: vi.fn(), resume: vi.fn(), setSceneActive: vi.fn(), register: vi.fn(),
}))
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: mocks.pathname, search: '' }) }))
vi.mock('@/shared/components/session/globalTimerContext', () => ({ useGlobalTimerRegistration: mocks.register }))
vi.mock('@/modules/session/domain/session-entity/model/timed-session/timedSessionStateMachine', () => ({
  useTimedSession: () => ({ start: mocks.start, resume: mocks.resume, setSceneActive: mocks.setSceneActive }),
}))
import { AppDwellSession } from './AppDwellSession'

describe('AppDwellSession click activation', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.pathname = '/dashboard' })

  it('registers the initial route without starting time before the first click', () => {
    render(<AppDwellSession />)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ isRouteActive: true, isDwellSession: true }))
    expect(mocks.setSceneActive).toHaveBeenCalledWith(true, { source: 'route_activity' })
  })

  it('keeps settings click eligible without resuming time on navigation', () => {
    const { rerender } = render(<AppDwellSession />)
    mocks.pathname = '/profile/timer'
    rerender(<AppDwellSession />)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
    expect(mocks.register).toHaveBeenLastCalledWith(expect.objectContaining({ isRouteActive: true, routePath: '/profile/timer' }))
    expect(mocks.setSceneActive).toHaveBeenLastCalledWith(true, { source: 'route_activity' })
  })
})
