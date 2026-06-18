import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalStorageState } from '@/shared/lib/localStorage'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { updateClientPreferencesApi } from '@/entities/preferences/api/clientPreferencesApi'

vi.mock('@/entities/preferences/api/clientPreferencesApi', () => ({
  getClientPreferencesApi: vi.fn(),
  updateClientPreferencesApi: vi.fn(async (data: Record<string, unknown>) => ({
    items: {
      memory_anki_shortcuts: null,
      review_feedback_settings: null,
      english_practice_settings: null,
      timer_automation_config: null,
      timer_focus_config: null,
      dashboard_duration_filter: data.dashboard_duration_filter ?? null,
      palace_list_view_settings: data.palace_list_view_settings ?? null,
      palace_shelf_view_settings: data.palace_shelf_view_settings ?? null,
      voice_coach_settings: null,
    },
  })),
}))

const mockUpdateClientPreferencesApi = vi.mocked(updateClientPreferencesApi)

interface ViewState {
  layoutMode: 'compact' | 'wide'
}

function isViewState(value: unknown): value is ViewState {
  return Boolean(
    value &&
      typeof value === 'object' &&
      ((value as ViewState).layoutMode === 'compact' || (value as ViewState).layoutMode === 'wide'),
  )
}

describe('useLocalStorageState', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    vi.clearAllMocks()
  })

  it('uses legacy localStorage as migration input without writing on initial mount', () => {
    window.localStorage.setItem('palace_list_view_settings', JSON.stringify({ layoutMode: 'wide' }))

    const { result } = renderHook(() =>
      useLocalStorageState<ViewState>(
        'palace_list_view_settings',
        { layoutMode: 'compact' },
        isViewState,
        'palace_list_view_settings',
      ),
    )

    expect(result.current[0]).toEqual({ layoutMode: 'wide' })
    expect(mockUpdateClientPreferencesApi).not.toHaveBeenCalled()
  })

  it('persists only when the setter is called', () => {
    const { result } = renderHook(() =>
      useLocalStorageState<ViewState>(
        'palace_list_view_settings',
        { layoutMode: 'compact' },
        isViewState,
        'palace_list_view_settings',
      ),
    )

    act(() => {
      result.current[1]({ layoutMode: 'wide' })
    })

    expect(result.current[0]).toEqual({ layoutMode: 'wide' })
    expect(mockUpdateClientPreferencesApi).toHaveBeenCalledWith({
      palace_list_view_settings: { layoutMode: 'wide' },
    })
  })
})
