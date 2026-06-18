import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from '@/shared/feedback/toast'
import type { EnglishCourseDetail, EnglishSentenceCheckResponse } from '@/shared/api/contracts'
import {
  buildEnglishCourseMediaUrl,
  checkEnglishSentenceApi,
  getEnglishCourseApi,
  updateEnglishCourseProgressApi,
} from '@/features/english/api/englishApi'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { useLatestRef } from '@/shared/hooks/useLatestRef'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import {
  type StatusNotice,
  type WordRailDensity,
} from '@/features/english/components/EnglishCourseParts'
import { EnglishCoursePageView } from '@/features/english/components/EnglishCoursePageView'
import {
  ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT,
  readEnglishPracticeSettings,
  writeEnglishPracticeSettings,
  type EnglishPracticeSettings,
} from '@/entities/preferences/model/englishPracticeSettings'
import {
  isTouchPrimaryInputDevice,
  shouldKeepEnglishPracticeControlFocus,
} from '@/features/english/englishTypingHelpers'
import { useEnglishCourseShortcuts } from '@/features/english/hooks/useEnglishCourseShortcuts'
import { resolveDisplaySentenceIndex } from '@/features/english/model/english-course-progress'
import { useEnglishTypingFeedbackSounds } from '@/features/english/useEnglishTypingFeedbackSounds'
import { useEnglishWordTyping } from '@/features/english/useEnglishWordTyping'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'

const FOCUS_RESTORE_DELAY_MS = 180
const EMPTY_TOKENS: string[] = []

type SentencePhase = 'listening_wait_input' | 'locally_completed' | 'chain_playing' | 'server_rejected'

interface PlaybackState {
  token: number
  endSec: number
  onEnded: (() => void) | null
  nextSentenceSwitchSec: number | null
  onNextSentenceStart: (() => void) | null
  didSwitchToNextSentence: boolean
}

function findLastCompletedSentenceIndex(course: EnglishCourseDetail, beforeIndexExclusive: number) {
  const completedSet = new Set(course.progress.completedSentenceIndexes)
  for (let index = Math.min(beforeIndexExclusive - 1, course.sentences.length - 1); index >= 0; index -= 1) {
    if (completedSet.has(course.sentences[index]?.index ?? -1)) {
      return index
    }
  }
  return null
}

function resolveWordRailDensity(
  sentence: EnglishCourseDetail['sentences'][number] | null,
): WordRailDensity {
  if (!sentence) return 'regular'
  const tokenCount = sentence.tokens.length
  const characterCount = sentence.tokens.reduce((total, token) => total + token.length, 0)
  const longestToken = sentence.tokens.reduce((max, token) => Math.max(max, token.length), 0)

  if (tokenCount >= 14 || characterCount >= 72 || longestToken >= 14) {
    return 'dense'
  }

  if (tokenCount >= 10 || characterCount >= 48 || longestToken >= 10) {
    return 'compact'
  }

  return 'regular'
}

export default function EnglishCoursePage() {
  const { isActive, becameActiveAt } = useRouteResidency()
  const { id } = useParams()
  const courseId = Number(id)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const typingInputRef = useRef<HTMLInputElement | null>(null)
  const focusRestoreTimerRef = useRef<number | null>(null)
  const hardUnloadRef = useRef(false)
  const playbackTokenRef = useRef(0)
  const playbackStateRef = useRef<PlaybackState | null>(null)
  const autoPreviewKeyRef = useRef('')
  const pendingSubmissionIndexesRef = useRef<Set<number>>(new Set())

  const [course, setCourse] = useState<EnglishCourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [typingSentenceIndex, setTypingSentenceIndex] = useState(0)
  const [translationSentenceIndex, setTranslationSentenceIndex] = useState<number | null>(null)
  const [sentencePhase, setSentencePhase] = useState<SentencePhase>('listening_wait_input')
  const [isSegmentPlaying, setIsSegmentPlaying] = useState(false)
  const [feedback, setFeedback] = useState<EnglishSentenceCheckResponse | null>(null)
  const [statusNotice, setStatusNotice] = useState<StatusNotice | null>(null)
  const [practiceSettings, setPracticeSettings] = useState<EnglishPracticeSettings>(() => readEnglishPracticeSettings())
  const [helperPanelOpen, setHelperPanelOpen] = useState(false)
  const [sidePanelTab, setSidePanelTab] = useState<'info' | 'shortcuts' | 'rhythm'>('info')
  const isTouchDevice = useMemo(() => isTouchPrimaryInputDevice(), [])

  const timer = useTimedSession({
    kind: 'practice',
    title: course ? `英语听写 · ${course.title}` : '英语听写',
    palaceId: null,
    automationScene: 'english',
    sourceKind: 'english',
    englishCourseId: Number.isFinite(courseId) ? courseId : null,
    persistKey: Number.isFinite(courseId) ? `english-course:${courseId}` : null,
  })

  useGlobalTimerRegistration({
    scene: 'english',
    title: course ? `英语听写 · ${course.title}` : '英语听写',
    timer,
    isRouteActive: isActive,
    becameActiveAt,
  })

  const timerRef = useLatestRef(timer)
  const courseRef = useLatestRef<EnglishCourseDetail | null>(course)
  const typingSentenceIndexRef = useLatestRef(typingSentenceIndex)
  const sentencePhaseRef = useLatestRef(sentencePhase)
  const practiceSettingsRef = useLatestRef(practiceSettings)
  const isSegmentPlayingRef = useLatestRef(isSegmentPlaying)
  const sentenceResolvedRef = useLatestRef(
    sentencePhase === 'locally_completed' || sentencePhase === 'chain_playing',
  )

  const loadCourse = useCallback(async () => {
    if (!Number.isFinite(courseId)) return
    setLoading(true)
    try {
      const nextCourse = await getEnglishCourseApi(courseId)
      const nextTypingIndex = resolveDisplaySentenceIndex(nextCourse)
      autoPreviewKeyRef.current = ''
      setTypingSentenceIndex(nextTypingIndex)
      setTranslationSentenceIndex(findLastCompletedSentenceIndex(nextCourse, nextTypingIndex))
      setSentencePhase(nextTypingIndex >= nextCourse.sentences.length ? 'locally_completed' : 'listening_wait_input')
      setCourse(nextCourse)
      setFeedback(null)
      setStatusNotice(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '课程加载失败。')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void loadCourse()
  }, [loadCourse])

  useEffect(() => {
    timer.setSceneActive?.(isActive, { source: isActive ? 'route_active' : 'route_inactive' })
  }, [isActive, timer])

  useEffect(() => {
    const syncPracticeSettings = () => {
      setPracticeSettings(readEnglishPracticeSettings())
    }
    window.addEventListener(ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT, syncPracticeSettings)
    return () => {
      window.removeEventListener(ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT, syncPracticeSettings)
    }
  }, [])

  useEffect(() => {
    const markHardUnload = () => {
      hardUnloadRef.current = true
    }
    window.addEventListener('beforeunload', markHardUnload)
    window.addEventListener('pagehide', markHardUnload)
    return () => {
      window.removeEventListener('beforeunload', markHardUnload)
      window.removeEventListener('pagehide', markHardUnload)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (focusRestoreTimerRef.current != null) {
        window.clearTimeout(focusRestoreTimerRef.current)
      }
      if (hardUnloadRef.current) return
    }
  }, [])

  useEffect(() => {
    if (!course) return
    if (!isActive) return
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig(), 'english')) return
    timer.start({ source: 'page_enter', scene: 'english_course' })
  }, [course, isActive, timer])

  const activeSentence = course?.sentences[typingSentenceIndex] ?? null
  const translationSentence =
    translationSentenceIndex != null ? course?.sentences[translationSentenceIndex] ?? null : null
  const activeSentenceTokens = activeSentence?.tokens ?? EMPTY_TOKENS
  const isCourseDisplayCompleted = Boolean(course && typingSentenceIndex >= course.sentences.length)
  const mediaUrl = useMemo(() => {
    if (!course) return ''
    return course.mediaUrl || buildEnglishCourseMediaUrl(course.id)
  }, [course])
  const wordRailDensity = useMemo(() => resolveWordRailDensity(activeSentence), [activeSentence])
  const typingEnabled =
    Boolean(activeSentence) &&
    !settingsOpen &&
    !isSegmentPlaying &&
    sentencePhase !== 'locally_completed' &&
    sentencePhase !== 'chain_playing'
  const translationMode =
    translationSentenceIndex == null
      ? 'placeholder'
      : activeSentence && translationSentenceIndex === activeSentence.index
        ? 'current'
        : 'previous'

  const { playKeySound, playWrongSound, playCorrectSound, playSentenceComplete } =
    useEnglishTypingFeedbackSounds(practiceSettings.sound)

  const {
    typingState,
    wordRevealComparableIndices,
    sentenceInputText,
    isSentenceLocallyComplete,
    resetTypingState,
    handleBackspace,
    handleCharacterInput,
    revealLetter,
    revealWord,
  } = useEnglishWordTyping({
    tokens: activeSentenceTokens,
    onActivitySignal: () => timer.registerActivity('practice_interaction', { source: 'english_typing' }),
    playKeySound,
    playWrongSound,
    playCorrectSound,
  })

  const clearFocusRestoreTimer = useCallback(() => {
    if (focusRestoreTimerRef.current != null) {
      window.clearTimeout(focusRestoreTimerRef.current)
      focusRestoreTimerRef.current = null
    }
  }, [])

  const stopSegmentPlayback = useCallback(() => {
    playbackTokenRef.current += 1
    playbackStateRef.current = null
    const element = videoRef.current
    if (element && !element.paused) {
      element.pause()
    }
    setIsSegmentPlaying(false)
  }, [])

  useEffect(() => {
    if (isActive) return
    clearFocusRestoreTimer()
    stopSegmentPlayback()
  }, [clearFocusRestoreTimer, isActive, stopSegmentPlayback])

  const focusTypingInput = useCallback(
    (restoreKeyboard = false) => {
      if (!typingEnabled || typeof window === 'undefined') return
      clearFocusRestoreTimer()
      window.requestAnimationFrame(() => {
        const input = typingInputRef.current
        if (!input) return
        input.focus({ preventScroll: true })
        const caret = String(input.value || '').length
        try {
          input.setSelectionRange(caret, caret)
        } catch {
          // Ignore selection errors on unsupported browsers.
        }
        if (restoreKeyboard && isTouchDevice) {
          focusRestoreTimerRef.current = window.setTimeout(() => {
            focusRestoreTimerRef.current = null
            const nextInput = typingInputRef.current
            if (!nextInput || !typingEnabled) return
            nextInput.focus({ preventScroll: true })
          }, FOCUS_RESTORE_DELAY_MS)
        }
      })
    },
    [clearFocusRestoreTimer, isTouchDevice, typingEnabled],
  )

  const updatePracticeSettings = useCallback(
    (
      nextSettings:
        | EnglishPracticeSettings
        | ((current: EnglishPracticeSettings) => EnglishPracticeSettings),
    ) => {
      setPracticeSettings((current) => {
        const candidate = typeof nextSettings === 'function' ? nextSettings(current) : nextSettings
        return writeEnglishPracticeSettings(candidate)
      })
    },
    [],
  )

  const handlePersistProgress = useCallback(
    async (nextSentenceIndex: number, nextCompletedIndexes: number[]) => {
      if (!courseRef.current) return null
      const nextProgress = await updateEnglishCourseProgressApi(courseRef.current.id, {
        currentSentenceIndex: nextSentenceIndex,
        completedSentenceIndexes: nextCompletedIndexes,
      })
      courseRef.current = courseRef.current ? { ...courseRef.current, progress: nextProgress } : courseRef.current
      setCourse((current) => (current ? { ...current, progress: nextProgress } : current))
      return nextProgress
    },
    [],
  )

  const startPlaybackWindow = useCallback(
    ({
      startSentence,
      endSentence,
      source,
      countReplay = true,
      nextSentenceSwitchSec = null,
      onNextSentenceStart = null,
      onEnded = null,
    }: {
      startSentence: NonNullable<EnglishCourseDetail['sentences'][number]>
      endSentence: NonNullable<EnglishCourseDetail['sentences'][number]>
      source: string
      countReplay?: boolean
      nextSentenceSwitchSec?: number | null
      onNextSentenceStart?: (() => void) | null
      onEnded?: (() => void) | null
    }) => {
      const element = videoRef.current
      if (!element) return false

      const token = playbackTokenRef.current + 1
      playbackTokenRef.current = token
      playbackStateRef.current = {
        token,
        endSec: Math.max(0.1, endSentence.endMs / 1000),
        onEnded,
        nextSentenceSwitchSec,
        onNextSentenceStart,
        didSwitchToNextSentence: false,
      }

      element.currentTime = Math.max(0, startSentence.startMs / 1000)
      if (countReplay) {
        timer.registerActivity('practice_interaction', { source })
      }
      setIsSegmentPlaying(true)

      void element.play().catch(() => {
        if (playbackStateRef.current?.token !== token) return
        playbackStateRef.current = null
        setIsSegmentPlaying(false)
        setStatusNotice({
          kind: 'error',
          text: '当前浏览器阻止了媒体播放，请先与页面交互后再试。',
        })
      })

      return true
    },
    [timer],
  )

  const rollbackToSentence = useCallback(
    (sentenceIndex: number, message: string) => {
      const currentCourse = courseRef.current
      stopSegmentPlayback()
      autoPreviewKeyRef.current = ''
      setTypingSentenceIndex(sentenceIndex)
      setTranslationSentenceIndex(
        currentCourse ? findLastCompletedSentenceIndex(currentCourse, sentenceIndex) : null,
      )
      setSentencePhase('server_rejected')
      setStatusNotice({
        kind: 'error',
        text: message,
      })
      resetTypingState()
    },
    [courseRef, resetTypingState, stopSegmentPlayback],
  )

  const submitCurrentSentence = useCallback(
    async (sentenceIndex: number, inputText: string) => {
      if (!courseRef.current) return
      if (pendingSubmissionIndexesRef.current.has(sentenceIndex)) return

      pendingSubmissionIndexesRef.current.add(sentenceIndex)

      try {
        const result = await checkEnglishSentenceApi(courseRef.current.id, {
          sentenceIndex,
          inputText,
        })
        setFeedback(result)

        if (!result.passed) {
          playWrongSound()
          rollbackToSentence(sentenceIndex, '本句本地已完整显示，但最终校验未通过，请重新拼写这一句。')
          return
        }

        const latestCourse = courseRef.current
        if (!latestCourse) return
        const nextCompletedIndexes = Array.from(
          new Set([...latestCourse.progress.completedSentenceIndexes, sentenceIndex]),
        ).sort((left, right) => left - right)
        const nextSentenceIndex = Math.min(sentenceIndex + 1, latestCourse.sentences.length)

        await handlePersistProgress(nextSentenceIndex, nextCompletedIndexes)

        if (
          nextSentenceIndex >= latestCourse.sentences.length &&
          !isSegmentPlayingRef.current &&
          sentencePhaseRef.current !== 'server_rejected'
        ) {
          setTypingSentenceIndex(latestCourse.sentences.length)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '校验失败，请重新拼写这一句。'
        rollbackToSentence(sentenceIndex, message)
        toast.error(message)
      } finally {
        pendingSubmissionIndexesRef.current.delete(sentenceIndex)
      }
    },
    [handlePersistProgress, isSegmentPlayingRef, playWrongSound, rollbackToSentence, sentencePhaseRef],
  )

  const replayCurrentSentence = useCallback(
    (source = 'english_replay') => {
      const sentence = courseRef.current?.sentences[typingSentenceIndexRef.current] ?? null
      if (!sentence) return false
      setSentencePhase('listening_wait_input')
      setStatusNotice(null)
      return startPlaybackWindow({
        startSentence: sentence,
        endSentence: sentence,
        source,
      })
    },
    [startPlaybackWindow, typingSentenceIndexRef],
  )

  const handleLocalSentenceCompletion = useCallback(
    (sentenceIndex: number, inputText: string) => {
      const currentCourse = courseRef.current
      const sentence = currentCourse?.sentences[sentenceIndex] ?? null
      if (!currentCourse || !sentence) return

      const nextSentence = currentCourse.sentences[sentenceIndex + 1] ?? null
      setFeedback(null)
      playSentenceComplete()
      setTranslationSentenceIndex(sentenceIndex)
      setStatusNotice({
        kind: 'success',
        text: nextSentence ? '本句已完整显示，正在重播本句并衔接下一句。' : '本句已完整显示，正在重播本句。',
      })

      if (nextSentence) {
        autoPreviewKeyRef.current = `${currentCourse.id}:${nextSentence.index}`
        setSentencePhase('chain_playing')
        startPlaybackWindow({
          startSentence: sentence,
          endSentence: nextSentence,
          source: 'english_completion_chain',
          nextSentenceSwitchSec: nextSentence.startMs / 1000,
          onNextSentenceStart: () => {
            setTypingSentenceIndex(nextSentence.index)
            setTranslationSentenceIndex(sentenceIndex)
            setSentencePhase('chain_playing')
          },
          onEnded: () => {
            setTypingSentenceIndex(nextSentence.index)
            setSentencePhase('listening_wait_input')
            setStatusNotice(null)
          },
        })
      } else {
        setSentencePhase('chain_playing')
        startPlaybackWindow({
          startSentence: sentence,
          endSentence: sentence,
          source: 'english_final_sentence_replay',
          onEnded: () => {
            setSentencePhase('locally_completed')
            setStatusNotice(null)
            if (
              courseRef.current &&
              courseRef.current.progress.currentSentenceIndex >= courseRef.current.sentences.length
            ) {
              setTypingSentenceIndex(courseRef.current.sentences.length)
            }
          },
        })
      }

      void submitCurrentSentence(sentenceIndex, inputText)
    },
    [courseRef, playSentenceComplete, startPlaybackWindow, submitCurrentSentence],
  )

  const handleNavigateSentence = useCallback(
    (delta: number) => {
      const currentCourse = courseRef.current
      if (!currentCourse) return

      const currentIndex = typingSentenceIndexRef.current
      const currentSentence = currentCourse.sentences[currentIndex] ?? null
      const currentCompleted = Boolean(
        currentSentence &&
          (currentCourse.progress.completedSentenceIndexes.includes(currentSentence.index) ||
            sentencePhaseRef.current === 'locally_completed'),
      )

      let targetIndex = currentIndex + delta
      if (delta > 0 && currentIndex === currentCourse.sentences.length - 1) {
        if (!currentCompleted && !currentCourse.progress.completed) return
        targetIndex = currentCourse.sentences.length
      }

      targetIndex = Math.max(0, Math.min(currentCourse.sentences.length, targetIndex))
      if (targetIndex === currentIndex) return

      autoPreviewKeyRef.current = ''
      stopSegmentPlayback()
      timer.registerActivity('practice_interaction', {
        source: delta > 0 ? 'english_next_sentence' : 'english_previous_sentence',
      })
      setTypingSentenceIndex(targetIndex)
      setTranslationSentenceIndex(
        targetIndex >= currentCourse.sentences.length
          ? findLastCompletedSentenceIndex(currentCourse, currentCourse.sentences.length)
          : findLastCompletedSentenceIndex(currentCourse, targetIndex),
      )
      setSentencePhase(targetIndex >= currentCourse.sentences.length ? 'locally_completed' : 'listening_wait_input')
      setStatusNotice(null)
      setFeedback(null)

      if (
        targetIndex < currentCourse.sentences.length &&
        targetIndex > currentCourse.progress.currentSentenceIndex
      ) {
        void handlePersistProgress(targetIndex, currentCourse.progress.completedSentenceIndexes)
      }
    },
    [courseRef, handlePersistProgress, sentencePhaseRef, stopSegmentPlayback, timer, typingSentenceIndexRef],
  )

  const toggleSingleSentenceLoop = useCallback(() => {
    updatePracticeSettings((current) => ({
      ...current,
      replay: {
        ...current.replay,
        singleSentenceLoopEnabled: !current.replay.singleSentenceLoopEnabled,
      },
    }))
  }, [updatePracticeSettings])

  const toggleAutoReplayOnPass = useCallback(() => {
    updatePracticeSettings((current) => ({
      ...current,
      replay: {
        ...current.replay,
        autoReplayOnPass: !current.replay.autoReplayOnPass,
      },
    }))
  }, [updatePracticeSettings])

  const toggleSound = useCallback(() => {
    updatePracticeSettings((current) => ({
      ...current,
      sound: {
        ...current.sound,
        enabled: !current.sound.enabled,
      },
    }))
  }, [updatePracticeSettings])

  const { handleTypingInputKeyDown } = useEnglishCourseShortcuts({
    settingsOpen,
    typingEnabled,
    typingInputRef,
    practiceSettingsRef,
    sentenceResolvedRef,
    handleBackspace,
    handleCharacterInput,
    replayCurrentSentence,
    handleNavigateSentence,
    revealLetter,
    revealWord,
    toggleSingleSentenceLoop,
    toggleAutoReplayOnPass,
    toggleSound,
  })

  useEffect(() => {
    if (!activeSentence) return
    resetTypingState()
  }, [activeSentence?.id, resetTypingState])

  useEffect(() => {
    if (!activeSentence || !isSentenceLocallyComplete) return
    if (sentencePhase !== 'listening_wait_input' && sentencePhase !== 'server_rejected') return
    handleLocalSentenceCompletion(activeSentence.index, sentenceInputText)
  }, [
    activeSentence,
    handleLocalSentenceCompletion,
    isSentenceLocallyComplete,
    sentenceInputText,
    sentencePhase,
  ])

  useEffect(() => {
    if (!isActive) return
    if (!typingEnabled) return
    focusTypingInput(isTouchDevice)
  }, [activeSentence?.id, focusTypingInput, isActive, isTouchDevice, typingEnabled, typingState.activeWordIndex])

  useEffect(() => {
    if (!isActive || !typingEnabled || settingsOpen || isTouchDevice) return undefined

    const onPointerDownCapture = (event: PointerEvent) => {
      if (shouldKeepEnglishPracticeControlFocus(event.target)) return
      window.setTimeout(() => {
        focusTypingInput(false)
      }, 0)
    }

    window.addEventListener('pointerdown', onPointerDownCapture, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDownCapture, true)
    }
  }, [focusTypingInput, isActive, isTouchDevice, settingsOpen, typingEnabled])

  useEffect(() => {
    if (!isActive) return
    if (!activeSentence || sentencePhase !== 'listening_wait_input') return
    const previewKey = `${course?.id}:${activeSentence.index}`
    if (autoPreviewKeyRef.current === previewKey) return
    autoPreviewKeyRef.current = previewKey
    void startPlaybackWindow({
      startSentence: activeSentence,
      endSentence: activeSentence,
      source: 'english_sentence_preview',
      countReplay: false,
    })
  }, [activeSentence, course?.id, isActive, sentencePhase, startPlaybackWindow])

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    const handlePlaybackBoundary = (event: Event) => {
      const playbackState = playbackStateRef.current
      if (!playbackState) return

      if (
        playbackState.nextSentenceSwitchSec != null &&
        !playbackState.didSwitchToNextSentence &&
        element.currentTime + 0.01 >= playbackState.nextSentenceSwitchSec
      ) {
        playbackState.didSwitchToNextSentence = true
        playbackState.onNextSentenceStart?.()
      }

      if (event.type !== 'ended' && element.currentTime + 0.01 < playbackState.endSec) return
      const onEnded = playbackState.onEnded
      playbackStateRef.current = null
      setIsSegmentPlaying(false)
      element.pause()
      onEnded?.()
    }

    element.addEventListener('timeupdate', handlePlaybackBoundary)
    element.addEventListener('ended', handlePlaybackBoundary)
    return () => {
      element.removeEventListener('timeupdate', handlePlaybackBoundary)
      element.removeEventListener('ended', handlePlaybackBoundary)
    }
  }, [mediaUrl])

  const handleSavePracticeSettings = useCallback(
    (nextSettings: EnglishPracticeSettings) => {
      updatePracticeSettings(nextSettings)
      setStatusNotice({
        kind: 'info',
        text: '练习设置已更新。',
      })
    },
    [updatePracticeSettings],
  )

  return (
    <EnglishCoursePageView
      courseId={courseId}
      loading={loading}
      course={course}
      videoRef={videoRef}
      typingInputRef={typingInputRef}
      timer={timer}
      mediaUrl={mediaUrl}
      isCourseDisplayCompleted={isCourseDisplayCompleted}
      activeSentence={activeSentence}
      translationSentence={translationSentence}
      translationMode={translationMode}
      practiceSettings={practiceSettings}
      statusNotice={statusNotice}
      feedback={feedback}
      activeSentenceTokens={activeSentenceTokens}
      typingState={typingState}
      wordRevealComparableIndices={wordRevealComparableIndices}
      wordRailDensity={wordRailDensity}
      handleTypingInputKeyDown={handleTypingInputKeyDown}
      typingEnabled={typingEnabled}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      focusTypingInput={focusTypingInput}
      isTouchDevice={isTouchDevice}
      replayCurrentSentence={replayCurrentSentence}
      revealLetter={revealLetter}
      handleNavigateSentence={handleNavigateSentence}
      helperPanelOpen={helperPanelOpen}
      setHelperPanelOpen={setHelperPanelOpen}
      sidePanelTab={sidePanelTab}
      setSidePanelTab={setSidePanelTab}
      handleSavePracticeSettings={handleSavePracticeSettings}
    />
  )
}
