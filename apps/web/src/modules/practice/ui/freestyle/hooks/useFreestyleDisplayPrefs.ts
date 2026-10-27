import { useCallback, useEffect, useState } from 'react'
import {
  FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT,
  readFreestyleDisplaySettings,
  sanitizeFreestyleDisplaySettings,
  saveFreestyleDisplaySettings,
  type FreestyleDisplaySettings,
  type FreestyleFlipMode,
} from '@/modules/practice/public'
import { onAppEvent } from '@/shared/events/appEvents'

/** Same width the map canvas uses to pick its phone camera. */
const NARROW_VIEWPORT_QUERY = '(max-width: 767px)'

function readNarrowViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(NARROW_VIEWPORT_QUERY).matches
}

/**
 * The learner's freestyle display preferences.
 *
 * Mind-map zoom is remembered per device class: a desktop window and a phone
 * keep separate values, so switching units restores the learner's own zoom on
 * either without a desktop 1.4 being applied to a phone. Before the learner
 * zooms on a phone the phone value is `null`, which leaves the per-card fit
 * in charge (the map opens on a readable tree instead of a blank corner).
 */
export function useFreestyleDisplayPrefs() {
  const [settings, setSettings] = useState<FreestyleDisplaySettings>(
    () => readFreestyleDisplaySettings(),
  )
  const [narrowViewport, setNarrowViewport] = useState(readNarrowViewport)

  useEffect(() => {
    return onAppEvent(FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT, (detail) => {
      setSettings(sanitizeFreestyleDisplaySettings(detail))
    })
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(NARROW_VIEWPORT_QUERY)
    const sync = () => setNarrowViewport(query.matches)
    sync()
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', sync)
      return () => query.removeEventListener('change', sync)
    }
    query.addListener(sync)
    return () => query.removeListener(sync)
  }, [])

  const flipMode = settings.flip_mode
  const mindmapZoom = narrowViewport
    ? settings.mindmap_zoom_phone ?? undefined
    : settings.mindmap_zoom

  const updateFlipMode = useCallback((next: FreestyleFlipMode) => {
    setSettings((current) => ({ ...current, flip_mode: next }))
    saveFreestyleDisplaySettings({ flip_mode: next })
  }, [])

  const updateMindmapZoom = useCallback((next: number) => {
    const saved = narrowViewport
      ? saveFreestyleDisplaySettings({ mindmap_zoom_phone: next })
      : saveFreestyleDisplaySettings({ mindmap_zoom: next })
    setSettings(saved)
  }, [narrowViewport])

  return { flipMode, mindmapZoom, updateFlipMode, updateMindmapZoom }
}
