import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import type {
  EnglishCourseDetail,
  EnglishGenerationLogResponse,
  EnglishSentenceCheckResponse,
} from '@/shared/api/contracts'
import {
  buildEnglishCourseMediaUrl,
  checkEnglishSentenceApi,
  getEnglishCourseApi,
  getEnglishCourseGenerationLogApi,
  updateEnglishCourseProgressApi,
} from '@/features/english/api/englishApi'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { useLatestRef } from '@/shared/hooks/useLatestRef'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { type StatusNotice } from '@/features/english/components/EnglishCourseParts'
import { EnglishCoursePageView } from '@/features/english/components/EnglishCoursePageView'
import {
  ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT,
  readEnglishPracticeSettings,
  writeEnglishPracticeSettings,
  type EnglishPracticeSettings,
} from '@/features/english/englishPracticeSettings'
import {
  isTouchPrimaryInputDevice,
  shouldKeepEnglishPracticeControlFocus,
} from '@/features/english/englishTypingHelpers'
import { useEnglishCourseShortcuts } from '@/features/english/hooks/useEnglishCourseShortcuts'
import { resolveDisplaySentenceIndex } from '@/features/english/model/english-course-progress'
import { useEnglishTypingFeedbackSounds } from '@/features/english/useEnglishTypingFeedbackSounds'
import { useEnglishWordTyping } from '@/features/english/useEnglishWordTyping'

const POST_PASS_ADVANCE_DELAY_MS = 1200
const POST_REPLAY_ADVANCE_DELAY_MS = 0
const LOOP_REPLAY_DELAY_MS = 110
const FOCUS_RESTORE_DELAY_MS = 180
const EMPTY_TOKENS: string[] = []
const EMPTY_COMPLETED_SENTENCE_INDEXES: number[] = []

export default function EnglishCoursePage() {
  const { id } = useParams()
  const courseId = Number(id)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const typingInputRef = useRef<HTMLInputElement | null>(null)
  const autoAdvanceTimerRef = useRef<number | null>(null)
  const focusRestoreTimerRef = useRef<number | null>(null)
  const hardUnloadRef = useRef(false)
  const playbackTokenRef = useRef(0)
  const handlePlaybackEndedRef = useRef<(sentenceIndex: number, nextTargetIndex: number | null) => void>(() => undefined)
  const playbackStateRef = useRef<{
    token: number
    sentenceIndex: number
    endSec: number
    onEnded: (() => void) | null
  } | null>(null)
  const [course, setCourse] = useState<EnglishCourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [displaySentenceIndex, setDisplaySentenceIndex] = useState(0)
  const [sentenceResolved, setSentenceResolved] = useState(false)
  const [submissionFailed, setSubmissionFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [isSegmentPlaying, setIsSegmentPlaying] = useState(false)
  const [feedback, setFeedback] = useState<EnglishSentenceCheckResponse | null>(null)
  const [statusNotice, setStatusNotice] = useState<StatusNotice | null>(null)
  const [sentenceReplayCount, setSentenceReplayCount] = useState(0)
  const [practiceSettings, setPracticeSettings] = useState<EnglishPracticeSettings>(() => readEnglishPracticeSettings())
  const [logDialogOpen, setLogDialogOpen] = useState(false)
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState('')
  const [logData, setLogData] = useState<EnglishGenerationLogResponse | null>(null)
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
  const timerRef = useLatestRef(timer)
  const courseRef = useLatestRef<EnglishCourseDetail | null>(course)
  const displaySentenceIndexRef = useLatestRef(displaySentenceIndex)
  const sentenceResolvedRef = useLatestRef(sentenceResolved)
  const practiceSettingsRef = useLatestRef(practiceSettings)
  const isSegmentPlayingRef = useLatestRef(isSegmentPlaying)
  const submissionFailedRef = useLatestRef(submissionFailed)

  const loadCourse = useCallback(async () => {
    if (!Number.isFinite(courseId)) return
    setLoading(true)
    try {
      const nextCourse = await getEnglishCourseApi(courseId)
      setDisplaySentenceIndex(resolveDisplaySentenceIndex(nextCourse))
      setCourse(nextCourse)
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
      if (autoAdvanceTimerRef.current != null) {
        window.clearTimeout(autoAdvanceTimerRef.current)
      }
      if (focusRestoreTimerRef.current != null) {
        window.clearTimeout(focusRestoreTimerRef.current)
      }
      const currentTimer = timerRef.current
      if (hardUnloadRef.current) return
      if (currentTimer.startedAt && currentTimer.status !== 'completed') {
        void currentTimer.complete('left_page', { source: 'english_course_leave' })
      }
    }
  }, [])

  useEffect(() => {
    if (!course) return
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig(), 'english')) return
    timer.start({ source: 'page_enter', scene: 'english_course' })
  }, [course, timer])

  const completedSentenceIndexes = course?.progress.completedSentenceIndexes ?? EMPTY_COMPLETED_SENTENCE_INDEXES
  const completedSentenceSet = useMemo(() => new Set(completedSentenceIndexes), [completedSentenceIndexes])
  const activeSentence = course?.sentences[displaySentenceIndex] ?? null
  const activeSentenceTokens = activeSentence?.tokens ?? EMPTY_TOKENS
  const activeSentenceCompleted = Boolean(activeSentence && completedSentenceSet.has(activeSentence.index))
  const isCourseDisplayCompleted = Boolean(course && displaySentenceIndex >= course.sentences.length)
  const completionRatio =
    course && course.sentences.length > 0
      ? Math.min(100, Math.round((completedSentenceIndexes.length / course.sentences.length) * 100))
      : 0
  const mediaUrl = useMemo(() => {
    if (!course) return ''
    return course.mediaUrl || buildEnglishCourseMediaUrl(course.id)
  }, [course])

  const { playKeySound, playWrongSound, playCorrectSound } = useEnglishTypingFeedbackSounds(practiceSettings.sound.enabled)

  const typingEnabled = Boolean(activeSentence) && !settingsOpen && !submitting && !sentenceResolved

  const {
    typingState,
    wordRevealComparableIndices,
    sentenceInputText,
    isSentenceLocallyComplete,
    resetTypingState,
    resetCurrentWord,
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

  const clearAutoAdvanceTimer = useCallback(() => {
    if (autoAdvanceTimerRef.current != null) {
      window.clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
    }
  }, [])

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

  const scheduleDisplayAdvance = useCallback(
    (targetIndex: number, delayMs = POST_PASS_ADVANCE_DELAY_MS) => {
      clearAutoAdvanceTimer()
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null
        stopSegmentPlayback()
        setDisplaySentenceIndex(targetIndex)
      }, delayMs)
    },
    [clearAutoAdvanceTimer, stopSegmentPlayback],
  )

  const startSentenceSegmentPlayback = useCallback(
    (
      sentence: NonNullable<EnglishCourseDetail['sentences'][number]>,
      options: {
        source: string
        countReplay?: boolean
        onEnded?: (() => void) | null
      },
    ) => {
      const element = videoRef.current
      if (!element) return false
      const token = playbackTokenRef.current + 1
      playbackTokenRef.current = token
      playbackStateRef.current = {
        token,
        sentenceIndex: sentence.index,
        endSec: Math.max(0.1, sentence.endMs / 1000),
        onEnded: options.onEnded || null,
      }
      element.currentTime = Math.max(0, sentence.startMs / 1000)
      if (options.countReplay !== false) {
        setSentenceReplayCount((current) => current + 1)
      }
      setIsSegmentPlaying(true)
      timer.registerActivity('practice_interaction', { source: options.source })
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

  const handlePlaybackEnded = useCallback(
    (sentenceIndex: number, nextTargetIndex: number | null) => {
      if (displaySentenceIndexRef.current !== sentenceIndex) return

      if (practiceSettingsRef.current.replay.singleSentenceLoopEnabled) {
        window.setTimeout(() => {
          if (displaySentenceIndexRef.current !== sentenceIndex) return
          if (!practiceSettingsRef.current.replay.singleSentenceLoopEnabled) {
            if (sentenceResolvedRef.current && nextTargetIndex != null) {
              scheduleDisplayAdvance(nextTargetIndex, POST_REPLAY_ADVANCE_DELAY_MS)
            }
            return
          }
          const sentence = courseRef.current?.sentences[sentenceIndex]
          if (!sentence) return
          void startSentenceSegmentPlayback(sentence, {
            source: sentenceResolvedRef.current ? 'english_pass_loop' : 'english_manual_loop',
            onEnded: () => handlePlaybackEndedRef.current(sentenceIndex, nextTargetIndex),
          })
        }, LOOP_REPLAY_DELAY_MS)
        return
      }

      if (
        sentenceResolvedRef.current &&
        practiceSettingsRef.current.flow.autoAdvanceOnPass &&
        nextTargetIndex != null
      ) {
        scheduleDisplayAdvance(nextTargetIndex, POST_REPLAY_ADVANCE_DELAY_MS)
      }
    },
    [scheduleDisplayAdvance, startSentenceSegmentPlayback],
  )

  useEffect(() => {
    handlePlaybackEndedRef.current = handlePlaybackEnded
  }, [handlePlaybackEnded])

  const replayCurrentSentence = useCallback(
    (source = 'english_replay', nextTargetIndexOverride?: number | null) => {
      const sentence = courseRef.current?.sentences[displaySentenceIndexRef.current] ?? null
      if (!sentence) return false
      clearAutoAdvanceTimer()
      setStatusNotice(null)
      const nextTargetIndex =
        nextTargetIndexOverride !== undefined
          ? nextTargetIndexOverride
          : sentenceResolvedRef.current && courseRef.current
            ? Math.min(courseRef.current.progress.currentSentenceIndex, courseRef.current.sentences.length)
            : null
      return startSentenceSegmentPlayback(sentence, {
        source,
        onEnded: () => handlePlaybackEnded(sentence.index, nextTargetIndex),
      })
    },
    [clearAutoAdvanceTimer, handlePlaybackEnded, startSentenceSegmentPlayback],
  )

  const submitCurrentSentence = useCallback(
    async (inputText: string) => {
      if (!courseRef.current || !activeSentence || submitting) return
      setSubmitting(true)
      setSubmissionFailed(false)
      setFeedback(null)
      setStatusNotice({
        kind: 'info',
        text: '正在校验当前句并保存进度...',
      })
      try {
        const result = await checkEnglishSentenceApi(courseRef.current.id, {
          sentenceIndex: activeSentence.index,
          inputText,
        })
        setFeedback(result)

        if (!result.passed) {
          playWrongSound()
          setSubmissionFailed(true)
          setStatusNotice({
            kind: 'error',
            text: '本地拼写与最终校验不同步，请重置本句后再试。',
          })
          return
        }

        const nextCompletedIndexes = Array.from(
          new Set([...courseRef.current.progress.completedSentenceIndexes, activeSentence.index]),
        ).sort((left, right) => left - right)
        const nextSentenceIndex = Math.min(activeSentence.index + 1, courseRef.current.sentences.length)
        const shouldAutoAdvance = practiceSettingsRef.current.flow.autoAdvanceOnPass

        await handlePersistProgress(nextSentenceIndex, nextCompletedIndexes)
        setSentenceResolved(true)
        setStatusNotice({
          kind: 'success',
          text:
            nextSentenceIndex >= courseRef.current.sentences.length
              ? shouldAutoAdvance
                ? '最后一句已通过，正在结束本轮练习。'
                : '最后一句已通过。'
              : '本句已通过。',
        })

        const shouldReplayOnPass =
          practiceSettingsRef.current.replay.singleSentenceLoopEnabled ||
          practiceSettingsRef.current.replay.autoReplayOnPass

        if (shouldReplayOnPass) {
          const replayStarted = replayCurrentSentence('english_pass_replay', nextSentenceIndex)
          if (
            shouldAutoAdvance &&
            !replayStarted &&
            !practiceSettingsRef.current.replay.singleSentenceLoopEnabled
          ) {
            scheduleDisplayAdvance(nextSentenceIndex)
          }
        } else if (shouldAutoAdvance) {
          scheduleDisplayAdvance(nextSentenceIndex)
        }
      } catch (error) {
        setSubmissionFailed(true)
        setStatusNotice({
          kind: 'error',
          text: error instanceof Error ? error.message : '校验失败，请稍后再试。',
        })
        toast.error(error instanceof Error ? error.message : '校验失败，请稍后再试。')
      } finally {
        setSubmitting(false)
      }
    },
    [
      activeSentence,
      handlePersistProgress,
      playWrongSound,
      replayCurrentSentence,
      scheduleDisplayAdvance,
      submitting,
    ],
  )

  const handleNavigateSentence = useCallback(
    (delta: number) => {
      const currentCourse = courseRef.current
      if (!currentCourse) return

      const currentIndex = displaySentenceIndexRef.current
      const currentSentence = currentCourse.sentences[currentIndex] ?? null
      const currentCompleted =
        (currentSentence ? currentCourse.progress.completedSentenceIndexes.includes(currentSentence.index) : false) ||
        sentenceResolvedRef.current

      let targetIndex = currentIndex + delta
      if (delta > 0 && currentIndex === currentCourse.sentences.length - 1) {
        if (!currentCompleted && !currentCourse.progress.completed) return
        targetIndex = currentCourse.sentences.length
      }

      targetIndex = Math.max(0, Math.min(currentCourse.sentences.length, targetIndex))
      if (targetIndex === currentIndex) return

      clearAutoAdvanceTimer()
      stopSegmentPlayback()
      timer.registerActivity('practice_interaction', {
        source: delta > 0 ? 'english_next_sentence' : 'english_previous_sentence',
      })
      setDisplaySentenceIndex(targetIndex)

      if (
        targetIndex < currentCourse.sentences.length &&
        targetIndex > currentCourse.progress.currentSentenceIndex
      ) {
        void handlePersistProgress(targetIndex, currentCourse.progress.completedSentenceIndexes)
      }
    },
    [clearAutoAdvanceTimer, handlePersistProgress, stopSegmentPlayback, timer],
  )

  const toggleSingleSentenceLoop = useCallback(() => {
    const nextEnabled = !practiceSettingsRef.current.replay.singleSentenceLoopEnabled
    updatePracticeSettings((current) => ({
      ...current,
      replay: {
        ...current.replay,
        singleSentenceLoopEnabled: nextEnabled,
      },
    }))
    if (!nextEnabled && sentenceResolvedRef.current && practiceSettingsRef.current.flow.autoAdvanceOnPass) {
      const nextTargetIndex = courseRef.current?.progress.currentSentenceIndex ?? displaySentenceIndexRef.current
      if (nextTargetIndex > displaySentenceIndexRef.current && !isSegmentPlayingRef.current) {
        scheduleDisplayAdvance(nextTargetIndex, POST_REPLAY_ADVANCE_DELAY_MS)
      }
    }
  }, [scheduleDisplayAdvance, updatePracticeSettings])

  const toggleAutoReplayOnPass = useCallback(() => {
    updatePracticeSettings((current) => ({
      ...current,
      replay: {
        ...current.replay,
        autoReplayOnPass: !current.replay.autoReplayOnPass,
      },
    }))
  }, [updatePracticeSettings])

  const toggleAutoAdvanceOnPass = useCallback(() => {
    const nextEnabled = !practiceSettingsRef.current.flow.autoAdvanceOnPass
    updatePracticeSettings((current) => ({
      ...current,
      flow: {
        ...current.flow,
        autoAdvanceOnPass: nextEnabled,
      },
    }))

    if (!sentenceResolvedRef.current) return
    if (!nextEnabled) {
      clearAutoAdvanceTimer()
      return
    }
    if (practiceSettingsRef.current.replay.singleSentenceLoopEnabled || isSegmentPlayingRef.current) return
    const nextTargetIndex = courseRef.current?.progress.currentSentenceIndex ?? displaySentenceIndexRef.current
    if (nextTargetIndex > displaySentenceIndexRef.current) {
      scheduleDisplayAdvance(nextTargetIndex, POST_REPLAY_ADVANCE_DELAY_MS)
    }
  }, [clearAutoAdvanceTimer, scheduleDisplayAdvance, updatePracticeSettings])

  const toggleSound = useCallback(() => {
    updatePracticeSettings((current) => ({
      ...current,
      sound: {
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
    if (!activeSentence || !isSentenceLocallyComplete || sentenceResolved || submitting || submissionFailed) return
    void submitCurrentSentence(sentenceInputText)
  }, [
    activeSentence,
    isSentenceLocallyComplete,
    sentenceInputText,
    sentenceResolved,
    submissionFailed,
    submitCurrentSentence,
    submitting,
  ])

  useEffect(() => {
    if (!typingEnabled) return
    focusTypingInput(isTouchDevice)
  }, [activeSentence?.id, focusTypingInput, isTouchDevice, typingEnabled, typingState.activeWordIndex])

  useEffect(() => {
    if (!typingEnabled || settingsOpen || isTouchDevice) return undefined

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
  }, [focusTypingInput, isTouchDevice, settingsOpen, typingEnabled])

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    const handlePlaybackBoundary = (event: Event) => {
      const playbackState = playbackStateRef.current
      if (!playbackState) return
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

  useEffect(() => {
    clearAutoAdvanceTimer()
    stopSegmentPlayback()
    resetTypingState()
    setSentenceResolved(false)
    setSubmissionFailed(false)
    setSubmitting(false)
    setFeedback(null)
    setStatusNotice(null)
    setSentenceReplayCount(0)
  }, [clearAutoAdvanceTimer, displaySentenceIndex, resetTypingState, stopSegmentPlayback])

  const handleRetrySubmission = useCallback(() => {
    setSubmissionFailed(false)
    void submitCurrentSentence(sentenceInputText)
  }, [sentenceInputText, submitCurrentSentence])

  const handleOpenGenerationLog = useCallback(async () => {
    if (!Number.isFinite(courseId)) return
    setLogDialogOpen(true)
    setLogLoading(true)
    setLogError('')
    try {
      const response = await getEnglishCourseGenerationLogApi(courseId)
      setLogData(response)
    } catch (error) {
      setLogError(error instanceof Error ? error.message : '加载生成日志失败。')
    } finally {
      setLogLoading(false)
    }
  }, [courseId])

  const handleSavePracticeSettings = useCallback(
    (nextSettings: EnglishPracticeSettings) => {
      updatePracticeSettings(nextSettings)
      setStatusNotice({
        kind: 'info',
        text: '练习设置已更新。',
      })
      if (!sentenceResolvedRef.current) return
      if (!nextSettings.flow.autoAdvanceOnPass) {
        clearAutoAdvanceTimer()
        return
      }
      if (nextSettings.replay.singleSentenceLoopEnabled || isSegmentPlayingRef.current) return
      const nextTargetIndex = courseRef.current?.progress.currentSentenceIndex ?? displaySentenceIndexRef.current
      if (nextTargetIndex > displaySentenceIndexRef.current) {
        scheduleDisplayAdvance(nextTargetIndex, POST_REPLAY_ADVANCE_DELAY_MS)
      }
    },
    [clearAutoAdvanceTimer, scheduleDisplayAdvance, updatePracticeSettings],
  )

  const showRetryButton = Boolean(activeSentence && isSentenceLocallyComplete && !sentenceResolved && !submitting)

  return (
    <EnglishCoursePageView
      courseId={courseId}
      loading={loading}
      course={course}
      videoRef={videoRef}
      typingInputRef={typingInputRef}
      timer={timer}
      setSettingsOpen={setSettingsOpen}
      setDisplaySentenceIndex={setDisplaySentenceIndex}
      handleOpenGenerationLog={handleOpenGenerationLog}
      completedSentenceIndexes={completedSentenceIndexes}
      completionRatio={completionRatio}
      mediaUrl={mediaUrl}
      isCourseDisplayCompleted={isCourseDisplayCompleted}
      activeSentence={activeSentence}
      practiceSettings={practiceSettings}
      activeSentenceCompleted={activeSentenceCompleted}
      sentenceResolved={sentenceResolved}
      statusNotice={statusNotice}
      feedback={feedback}
      activeSentenceTokens={activeSentenceTokens}
      typingState={typingState}
      wordRevealComparableIndices={wordRevealComparableIndices}
      sentenceReplayCount={sentenceReplayCount}
      handleTypingInputKeyDown={handleTypingInputKeyDown}
      typingEnabled={typingEnabled}
      settingsOpen={settingsOpen}
      focusTypingInput={focusTypingInput}
      isTouchDevice={isTouchDevice}
      replayCurrentSentence={replayCurrentSentence}
      setStatusNotice={setStatusNotice}
      setSubmissionFailed={setSubmissionFailed}
      resetCurrentWord={resetCurrentWord}
      resetTypingState={resetTypingState}
      revealLetter={revealLetter}
      revealWord={revealWord}
      showRetryButton={showRetryButton}
      handleRetrySubmission={handleRetrySubmission}
      submitting={submitting}
      handleNavigateSentence={handleNavigateSentence}
      toggleAutoAdvanceOnPass={toggleAutoAdvanceOnPass}
      toggleSingleSentenceLoop={toggleSingleSentenceLoop}
      toggleAutoReplayOnPass={toggleAutoReplayOnPass}
      toggleSound={toggleSound}
      helperPanelOpen={helperPanelOpen}
      setHelperPanelOpen={setHelperPanelOpen}
      sidePanelTab={sidePanelTab}
      setSidePanelTab={setSidePanelTab}
      handleSavePracticeSettings={handleSavePracticeSettings}
      logDialogOpen={logDialogOpen}
      setLogDialogOpen={setLogDialogOpen}
      logLoading={logLoading}
      logError={logError}
      logData={logData}
    />
  )
}
