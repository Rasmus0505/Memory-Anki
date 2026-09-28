import { useCallback, useEffect, useState } from 'react'
import {
  FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT,
  readFreestyleDisplaySettings,
  sanitizeFreestyleDisplaySettings,
  saveFreestyleDisplaySettings,
  type FreestyleFlipMode,
} from '@/modules/practice/public'
import { onAppEvent } from '@/shared/events/appEvents'

export function useFreestyleDisplayPrefs() {
  const [flipMode, setFlipMode] = useState<FreestyleFlipMode>(
    () => readFreestyleDisplaySettings().flip_mode,
  )
  const [mindmapZoom, setMindmapZoom] = useState(
    () => readFreestyleDisplaySettings().mindmap_zoom,
  )

  useEffect(() => {
    return onAppEvent(FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT, (detail) => {
      const settings = sanitizeFreestyleDisplaySettings(detail)
      setFlipMode(settings.flip_mode)
      setMindmapZoom(settings.mindmap_zoom)
    })
  }, [])

  const updateFlipMode = useCallback((next: FreestyleFlipMode) => {
    setFlipMode(next)
    saveFreestyleDisplaySettings({ flip_mode: next })
  }, [])

  const updateMindmapZoom = useCallback((next: number) => {
    const saved = saveFreestyleDisplaySettings({ mindmap_zoom: next })
    setMindmapZoom(saved.mindmap_zoom)
  }, [])

  return { flipMode, mindmapZoom, updateFlipMode, updateMindmapZoom }
}
