import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { EnglishCourseDetail, EnglishCourseSentence } from '@/shared/api/contracts'
import type {
  EnglishDictationLayout,
  EnglishPracticeSettings,
} from '@/modules/settings/public'
import {
  clearTimer,
  resolvePlaybackBoundary,
  sentenceForIndex,
} from './dictationControllerUtils'

interface Params {
  videoRef: RefObject<HTMLVideoElement | null>
  courseRef: RefObject<EnglishCourseDetail | null>
  indexRef: RefObject<number>
  sentenceRef: RefObject<EnglishCourseSentence | null>
  settingsRef: RefObject<EnglishPracticeSettings>
  blockedRef: RefObject<boolean>
  layout: EnglishDictationLayout
  onBeforeNavigate: () => void
  onSentenceChange: (index: number, persist?: boolean) => void
}

export function useDictationPlayback({
  videoRef,
  courseRef,
  indexRef,
  sentenceRef,
  settingsRef,
  blockedRef,
  layout,
  onBeforeNavigate,
  onSentenceChange,
}: Params) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [userPaused, setUserPaused] = useState(false)
  const pendingAutoplayRef = useRef(true)
  const loopTimerRef = useRef<number | null>(null)

  useEffect(() => {
    // Switching layouts remounts the <video> element. Do not leave stale
    // isPlaying state that would hide the play affordance on the new element.
    setIsPlaying(false)
    setUserPaused(false)
    pendingAutoplayRef.current = false
  }, [layout])

  const resetPlayback = useCallback(() => {
    clearTimer(loopTimerRef)
    setIsPlaying(false)
    setUserPaused(false)
  }, [])

  const armAutoplay = useCallback((enabled: boolean) => {
    pendingAutoplayRef.current = enabled
  }, [])

  const replayCurrentSentence = useCallback(() => {
    const video = videoRef.current
    const active = sentenceRef.current
    if (!video || !active) return
    setUserPaused(false)
    try {
      video.currentTime = active.startMs / 1000
    } catch {
      // Metadata is not ready yet; loadedmetadata seeks before autoplay.
    }
    video.playbackRate = settingsRef.current.stage.playbackSpeed
    void video.play().catch(() => setIsPlaying(false))
  }, [sentenceRef, settingsRef, videoRef])

  const goToSentence = useCallback(
    (targetIndex: number, autoplay = true) => {
      const snapshot = courseRef.current
      if (!snapshot) return
      const target = snapshot.sentences.find((item) => item.index === targetIndex)
      if (!target) return
      clearTimer(loopTimerRef)
      onBeforeNavigate()
      indexRef.current = target.index
      sentenceRef.current = target
      onSentenceChange(target.index, true)
      setUserPaused(false)
      const video = videoRef.current
      if (video) {
        video.playbackRate = settingsRef.current.stage.playbackSpeed
        try {
          video.currentTime = target.startMs / 1000
        } catch {
          // loadedmetadata will seek using indexRef.
        }
        if (autoplay) void video.play().catch(() => setIsPlaying(false))
        else video.pause()
      }
    },
    [courseRef, indexRef, onBeforeNavigate, onSentenceChange, sentenceRef, settingsRef, videoRef],
  )

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    const active = sentenceRef.current
    if (!video || !active) return
    if (!video.paused) {
      video.pause()
      return
    }
    setUserPaused(false)
    const currentMs = video.currentTime * 1000
    if (currentMs >= active.endMs - 60 || currentMs < active.startMs - 60) {
      try {
        video.currentTime = active.startMs / 1000
      } catch {
        // Ignore pre-metadata seeks.
      }
    }
    video.playbackRate = settingsRef.current.stage.playbackSpeed
    void video.play().catch(() => setIsPlaying(false))
  }, [sentenceRef, settingsRef, videoRef])

  const toggleUserPause = useCallback(() => {
    const video = videoRef.current
    const active = sentenceRef.current
    if (!video || !active) return
    if (!video.paused) {
      video.pause()
      setUserPaused(true)
      return
    }
    setUserPaused(false)
    const currentMs = video.currentTime * 1000
    if (currentMs >= active.endMs - 60) {
      try {
        video.currentTime = active.startMs / 1000
      } catch {
        // Ignore.
      }
    }
    void video.play().catch(() => setIsPlaying(false))
  }, [sentenceRef, videoRef])

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current
    const active = sentenceForIndex(courseRef.current, indexRef.current)
    if (!video || !active) return
    video.playbackRate = settingsRef.current.stage.playbackSpeed
    try {
      video.currentTime = active.startMs / 1000
    } catch {
      // Ignore.
    }
    if (pendingAutoplayRef.current && !blockedRef.current) {
      pendingAutoplayRef.current = false
      void video.play().catch(() => setIsPlaying(false))
    }
  }, [blockedRef, courseRef, indexRef, settingsRef, videoRef])

  const handlePlay = useCallback(() => {
    setIsPlaying(true)
    setUserPaused(false)
  }, [])

  const handlePause = useCallback(() => {
    setIsPlaying(false)
    onSentenceChange(indexRef.current, true)
  }, [indexRef, onSentenceChange])

  const handleEnded = useCallback(() => {
    setIsPlaying(false)
    if (
      settingsRef.current.playback.mode === 'single'
      && settingsRef.current.replay.singleSentenceLoopEnabled
    ) {
      clearTimer(loopTimerRef)
      loopTimerRef.current = window.setTimeout(() => {
        loopTimerRef.current = null
        replayCurrentSentence()
      }, 320)
    }
  }, [replayCurrentSentence, settingsRef])

  useEffect(() => {
    if (!isPlaying) return
    let disposed = false

    // A 30ms boundary poll keeps video rendering off the main-thread hot path.
    // requestVideoFrameCallback/rAF are throttled when the app window is
    // occluded (and rVFC does not fire at all for audio-only media), so a light
    // timer is both cheaper and more reliable than a per-frame callback.
    const tick = () => {
      if (disposed) return
      const video = videoRef.current
      const active = sentenceRef.current
      const snapshot = courseRef.current
      if (!video || !active || !snapshot) return

      const mode = settingsRef.current.playback.mode
      const boundary = resolvePlaybackBoundary(
        snapshot.sentences,
        active.index,
        video.currentTime * 1000,
        mode,
      )

      if (boundary.kind === 'advance') {
        const next = snapshot.sentences.find((sentence) => sentence.index === boundary.index)
        if (next) {
          onBeforeNavigate()
          indexRef.current = next.index
          sentenceRef.current = next
          onSentenceChange(next.index, next.index % 10 === 0)
        }
        return
      }

      if (boundary.kind === 'pause') {
        video.pause()
        setIsPlaying(false)
        if (mode === 'single' && settingsRef.current.replay.singleSentenceLoopEnabled) {
          clearTimer(loopTimerRef)
          loopTimerRef.current = window.setTimeout(() => {
            loopTimerRef.current = null
            replayCurrentSentence()
          }, 360)
        }
      }
    }

    const intervalId = window.setInterval(tick, 30)

    return () => {
      disposed = true
      window.clearInterval(intervalId)
    }
  }, [
    courseRef,
    indexRef,
    isPlaying,
    onBeforeNavigate,
    onSentenceChange,
    replayCurrentSentence,
    sentenceRef,
    settingsRef,
    videoRef,
  ])
  useEffect(() => {
    return () => clearTimer(loopTimerRef)
  }, [])

  return {
    isPlaying,
    userPaused,
    setUserPaused,
    resetPlayback,
    armAutoplay,
    replayCurrentSentence,
    goToSentence,
    togglePlay,
    toggleUserPause,
    handleLoadedMetadata,
    handlePlay,
    handlePause,
    handleEnded,
  }
}
