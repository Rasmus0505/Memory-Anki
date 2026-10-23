import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT,
  readEnglishPracticeSettings,
  writeEnglishPracticeSettings,
  type EnglishPracticeSettings,
} from '@/modules/settings/public'
import {
  DEFAULT_MASK_RECT,
  FULL_WIDTH_MASK_RECT,
  LAYOUT_LABELS,
  PLAYBACK_SPEEDS,
  nextDictationLayout,
  readMaskEnabled,
  readMaskRect,
  writeMaskEnabled,
  writeMaskRect,
  type MaskRect,
} from './dictationLayout'

interface Params {
  courseId: number
  videoRef: RefObject<HTMLVideoElement | null>
  showFlash: (message: string) => void
}

export function useDictationSettings({ courseId, videoRef, showFlash }: Params) {
  const [settings, setSettings] = useState<EnglishPracticeSettings>(() => readEnglishPracticeSettings())
  const [maskEnabled, setMaskEnabled] = useState(false)
  const [maskRect, setMaskRectState] = useState<MaskRect>(DEFAULT_MASK_RECT)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    const sync = () => setSettings(readEnglishPracticeSettings())
    window.addEventListener(ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT, sync)
    return () => window.removeEventListener(ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT, sync)
  }, [])

  useEffect(() => {
    if (!Number.isFinite(courseId) || courseId <= 0) return
    setMaskRectState(readMaskRect(courseId))
    setMaskEnabled(readMaskEnabled(courseId, settingsRef.current.stage.mask.enabled))
  }, [courseId])

  const applySettings = useCallback((next: EnglishPracticeSettings) => {
    const saved = writeEnglishPracticeSettings(next)
    settingsRef.current = saved
    setSettings(saved)
    const video = videoRef.current
    if (video) video.playbackRate = saved.stage.playbackSpeed
    return saved
  }, [videoRef])

  const cycleLayout = useCallback(() => {
    videoRef.current?.pause()
    const next = nextDictationLayout(settingsRef.current.stage.layout)
    const saved = applySettings({
      ...settingsRef.current,
      stage: { ...settingsRef.current.stage, layout: next },
    })
    showFlash(`布局：${LAYOUT_LABELS[saved.stage.layout]}`)
  }, [applySettings, showFlash, videoRef])

  const toggleMask = useCallback(() => {
    setMaskEnabled((previous) => {
      const next = !previous
      if (Number.isFinite(courseId)) writeMaskEnabled(courseId, next)
      showFlash(next ? '遮挡板已开启 · 拖动或缩放遮住字幕' : '遮挡板已关闭')
      return next
    })
  }, [courseId, showFlash])

  const togglePlaybackMode = useCallback(() => {
    const mode =
      settingsRef.current.playback.mode === 'continuous' ? 'single' : 'continuous'
    applySettings({
      ...settingsRef.current,
      playback: { mode },
    })
    showFlash(
      mode === 'single'
        ? '播放模式：单句（每句结束暂停）'
        : '播放模式：连播（跨句连续播放）',
    )
  }, [applySettings, showFlash])

  const toggleSound = useCallback(() => {
    const saved = applySettings({
      ...settingsRef.current,
      sound: { ...settingsRef.current.sound, enabled: !settingsRef.current.sound.enabled },
    })
    showFlash(saved.sound.enabled ? '反馈音已开启' : '反馈音已关闭')
  }, [applySettings, showFlash])

  const changeSpeed = useCallback(
    (direction: 1 | -1) => {
      const current = settingsRef.current.stage.playbackSpeed
      const currentIndex = PLAYBACK_SPEEDS.indexOf(current as (typeof PLAYBACK_SPEEDS)[number])
      const safeIndex = currentIndex >= 0 ? currentIndex : PLAYBACK_SPEEDS.indexOf(1)
      const nextIndex = Math.max(0, Math.min(PLAYBACK_SPEEDS.length - 1, safeIndex + direction))
      const speed = PLAYBACK_SPEEDS[nextIndex]
      applySettings({
        ...settingsRef.current,
        stage: { ...settingsRef.current.stage, playbackSpeed: speed },
      })
      showFlash(`播放速度 ${speed}×`)
    },
    [applySettings, showFlash],
  )

  const openShortcuts = useCallback(() => {
    videoRef.current?.pause()
    setShortcutsOpen(true)
  }, [videoRef])

  const closeShortcuts = useCallback(() => setShortcutsOpen(false), [])

  const saveSettings = useCallback(
    (next: EnglishPracticeSettings) => {
      const maskDefaultChanged = next.stage.mask.enabled !== settingsRef.current.stage.mask.enabled
      if (next.stage.layout !== settingsRef.current.stage.layout) {
        videoRef.current?.pause()
      }
      const saved = applySettings(next)
      setShortcutsOpen(false)
      if (maskDefaultChanged) {
        setMaskEnabled(saved.stage.mask.enabled)
        if (Number.isFinite(courseId)) writeMaskEnabled(courseId, saved.stage.mask.enabled)
      }
      showFlash('练习设置已保存。')
    },
    [applySettings, courseId, showFlash, videoRef],
  )

  const setMaskRect = useCallback(
    (rect: MaskRect) => {
      setMaskRectState(rect)
      if (Number.isFinite(courseId)) writeMaskRect(courseId, rect)
    },
    [courseId],
  )

  const previewMaskRect = useCallback((rect: MaskRect) => {
    setMaskRectState(rect)
  }, [])

  const resetMask = useCallback(() => {
    setMaskRectState(DEFAULT_MASK_RECT)
    if (Number.isFinite(courseId)) writeMaskRect(courseId, DEFAULT_MASK_RECT)
  }, [courseId])

  const fullWidthMask = useCallback(() => {
    setMaskRectState(FULL_WIDTH_MASK_RECT)
    if (Number.isFinite(courseId)) writeMaskRect(courseId, FULL_WIDTH_MASK_RECT)
  }, [courseId])

  return {
    settings,
    settingsRef,
    maskEnabled,
    maskRect,
    shortcutsOpen,
    applySettings,
    cycleLayout,
    toggleMask,
    togglePlaybackMode,
    toggleSound,
    changeSpeed,
    openShortcuts,
    closeShortcuts,
    saveSettings,
    setMaskRect,
    previewMaskRect,
    resetMask,
    fullWidthMask,
  }
}
