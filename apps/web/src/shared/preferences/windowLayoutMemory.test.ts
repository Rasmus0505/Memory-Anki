import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { updateClientPreferencesApi } from '@/modules/settings/public'
import {
  LEGACY_PALACE_LOOKUP_LAYOUT_KEY,
  flushWindowLayoutRemotePersist,
  migrateLegacyWindowLayouts,
  readPalaceLookupMemory,
  resetWindowLayoutMemoryForTest,
  setWindowLayoutRemotePersistEnabledForTest,
  writePalaceLookupMemory,
} from './windowLayoutMemory'

vi.mock('@/modules/settings/public', () => ({
  getClientPreferencesApi: vi.fn(),
  updateClientPreferencesApi: vi.fn(),
}))

const mockUpdateClientPreferencesApi = vi.mocked(updateClientPreferencesApi)

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
}

describe('window layout memory', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetWindowLayoutMemoryForTest()
    resetClientPreferenceCacheForTest()
    setWindowLayoutRemotePersistEnabledForTest(false)
    mockUpdateClientPreferencesApi.mockReset()
    mockUpdateClientPreferencesApi.mockResolvedValue({ items: {} } as never)
    setViewport(1200, 800)
  })

  afterEach(() => {
    vi.useRealTimers()
    setWindowLayoutRemotePersistEnabledForTest(false)
    resetWindowLayoutMemoryForTest()
    resetClientPreferenceCacheForTest()
    window.localStorage.clear()
    setViewport(1024, 768)
  })

  it('folds a legacy palace pixel layout into a viewport ratio', async () => {
    window.localStorage.setItem(
      LEGACY_PALACE_LOOKUP_LAYOUT_KEY,
      JSON.stringify({ x: 48, y: 36, width: 900, height: 600, collapsed: false }),
    )

    const folded = await migrateLegacyWindowLayouts()

    expect(folded.palaceMemoryLookup).toMatchObject({ widthRatio: 0.75, heightRatio: 0.75 })
    expect(mockUpdateClientPreferencesApi).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(LEGACY_PALACE_LOOKUP_LAYOUT_KEY)).not.toBeNull()
    expect(readPalaceLookupMemory()).toMatchObject({ widthRatio: 0.75, heightRatio: 0.75 })
  })

  it('debounces remote persistence and flushes the latest ratios', async () => {
    setWindowLayoutRemotePersistEnabledForTest(true)
    vi.useFakeTimers()
    writePalaceLookupMemory({
      xRatio: 0.04,
      yRatio: 0.05,
      widthRatio: 0.75,
      heightRatio: 0.75,
      collapsed: false,
      pinned: true,
      listCollapsed: false,
    })

    expect(mockUpdateClientPreferencesApi).not.toHaveBeenCalled()
    flushWindowLayoutRemotePersist()
    await vi.runAllTimersAsync()

    expect(mockUpdateClientPreferencesApi).toHaveBeenCalledWith(
      expect.objectContaining({
        window_layouts: expect.objectContaining({
          palaceMemoryLookup: expect.objectContaining({
            widthRatio: 0.75,
            heightRatio: 0.75,
            pinned: true,
          }),
        }),
      }),
    )
  })
})
