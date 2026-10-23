import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { EnglishCourseDetail, EnglishCourseSentence } from '@/shared/api/contracts'
import {
  buildEnglishCourseMediaUrl,
  getEnglishCourseApi,
  updateEnglishCourseProgressApi,
} from '@/modules/english/domain/english-entity/api'
import {
  backspaceDictationChar,
  clearWrongDictationWord,
  createDictationSession,
  resetDictationSession,
  revealDictationLetter,
  revealDictationWord,
  revealWholeDictationSession,
  typeDictationChar,
  type DictationSentenceSession,
  type DictationStep,
} from '@/modules/english/domain/english-dictation/model'
import { isShortcutPressed, type EnglishShortcutActionId } from '@/modules/settings/public'
import { useEnglishTypingFeedbackSounds } from '@/modules/english/ui/english/useEnglishTypingFeedbackSounds'
import { cn } from '@/shared/lib/utils'
import { DictationHeader } from './components/DictationChrome'
import {
  DictationFlash,
  DictationPageMessage,
  DictationPauseOverlay,
  DictationSummary,
} from './components/DictationOverlays'
import { DictationStageLayouts } from './components/DictationStageLayouts'
import { DictationShortcutPanel } from './components/DictationShortcutPanel'
import { isTouchPrimaryInput } from './dictationLayout'
import { buildDictationVideoProps } from './dictationVideoProps'
import {
  EMPTY_SESSION,
  WRONG_SOUND_FLASH_MS,
  buildPlaybackShortcutLabel,
  buildResumeHint,
  buildShortcutsLabel,
  buildSummaryStats,
  clearTimer,
  errorMessage,
  isEditableTarget,
  sentenceForIndex,
  type SentenceStats,
} from './dictationControllerUtils'
import { useDictationSettings } from './useDictationSettings'
import { useDictationPlayback } from './useDictationPlayback'

const WRONG_CLEAR_DELAY_MS = 480
const SUMMARY_DELAY_MS = 900
const AUTO_ADVANCE_DELAY_MS = 1_100

export function EnglishDictationPage() {
  const { id } = useParams<{ id: string }>()
  const courseId = Number(id)
  const navigate = useNavigate()

  const [course, setCourse] = useState<EnglishCourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<number, DictationSentenceSession>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [completedIndexes, setCompletedIndexes] = useState<Set<number>>(new Set())
  const [roundCompleted, setRoundCompleted] = useState<Set<number>>(new Set())
  const [statsByIndex, setStatsByIndex] = useState<Record<number, SentenceStats>>({})
  const [translationVisible, setTranslationVisible] = useState(true)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [roundStartedAt, setRoundStartedAt] = useState(() => Date.now())
  const [summaryDurationMs, setSummaryDurationMs] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const typingInputRef = useRef<HTMLInputElement>(null)
  const sessionRef = useRef<DictationSentenceSession>(EMPTY_SESSION)
  const sentenceRef = useRef<EnglishCourseSentence | null>(null)
  const courseRef = useRef<EnglishCourseDetail | null>(null)
  const indexRef = useRef(0)
  const completedRef = useRef<Set<number>>(new Set())
  const roundCompletedRef = useRef<Set<number>>(new Set())
  const statsRef = useRef<Record<number, SentenceStats>>({})
  const serverCompletedRef = useRef<Set<number>>(new Set())
  const summaryOpenRef = useRef(false)
  const shortcutsOpenRef = useRef(false)
  const roundStartedAtRef = useRef(roundStartedAt)
  const wrongTimerRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const autoTimerRef = useRef<number | null>(null)
  const summaryTimerRef = useRef<number | null>(null)
  const handlerRef = useRef<(event: KeyboardEvent) => void>(() => {})

  const showFlash = useCallback((message: string, duration = WRONG_SOUND_FLASH_MS) => {
    clearTimer(flashTimerRef)
    setFlash(message)
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null
      setFlash(null)
    }, duration)
  }, [])

  const {
    settings,
    settingsRef,
    maskEnabled,
    maskRect,
    shortcutsOpen,
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
  } = useDictationSettings({ courseId, videoRef, showFlash })

  const blockedRef = useRef(false)
  blockedRef.current = summaryOpen || shortcutsOpen
  summaryOpenRef.current = summaryOpen
  shortcutsOpenRef.current = shortcutsOpen
  roundStartedAtRef.current = roundStartedAt

  const handleSentenceChange = useCallback((index: number, persist = true) => {
    setCurrentIndex(index)
    setTranslationVisible(true)
    if (!persist) return
    const snapshot = courseRef.current
    if (!snapshot) return
    const union = new Set([...serverCompletedRef.current, ...completedRef.current])
    void updateEnglishCourseProgressApi(snapshot.id, {
      currentSentenceIndex: index,
      completedSentenceIndexes: Array.from(union).sort((a, b) => a - b),
    }).catch(() => undefined)
  }, [])

  const handleBeforeNavigate = useCallback(() => {
    clearTimer(wrongTimerRef)
    clearTimer(autoTimerRef)
    let next = sessionRef.current
    next.words.forEach((word, index) => {
      if (word.status === 'wrong') next = clearWrongDictationWord(next, index)
    })
    if (next !== sessionRef.current) {
      sessionRef.current = next
      setSessions((previous) => ({ ...previous, [next.sentenceIndex]: next }))
    }
    setTranslationVisible(true)
  }, [])

  const playback = useDictationPlayback({
    videoRef,
    courseRef,
    indexRef,
    sentenceRef,
    settingsRef,
    blockedRef,
    layout: settings.stage.layout,
    onBeforeNavigate: handleBeforeNavigate,
    onSentenceChange: handleSentenceChange,
  })

  const sound = useEnglishTypingFeedbackSounds(settings.sound)
  const { resetPlayback, armAutoplay } = playback
  const sentence = sentenceForIndex(course, currentIndex)

  const activeSession = useMemo(() => {
    if (!sentence) return EMPTY_SESSION
    const stored = sessions[sentence.index]
    if (stored) return stored
    const created = createDictationSession(sentence.index, sentence.textEn, sentence.tokens)
    return completedIndexes.has(sentence.index) ? revealWholeDictationSession(created) : created
  }, [sentence, sessions, completedIndexes])

  sessionRef.current = activeSession
  sentenceRef.current = sentence

  useEffect(() => {
    return () => {
      clearTimer(wrongTimerRef)
      clearTimer(flashTimerRef)
      clearTimer(autoTimerRef)
      clearTimer(summaryTimerRef)
    }
  }, [])

  useEffect(() => {
    if (!Number.isFinite(courseId) || courseId <= 0) {
      setLoading(false)
      setLoadError('无效的课程编号。')
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    getEnglishCourseApi(courseId)
      .then((data) => {
        if (cancelled) return
        courseRef.current = data
        setCourse(data)
        const serverDone = new Set(
          data.progress.completedSentenceIndexes.filter(
            (index) => index >= 0 && index < data.sentences.length,
          ),
        )
        serverCompletedRef.current = serverDone
        const allDone = data.sentences.length > 0 && serverDone.size >= data.sentences.length
        const firstUnfinished = data.sentences.findIndex((item) => !serverDone.has(item.index))
        const savedIndex = Math.min(
          Math.max(0, data.progress.currentSentenceIndex),
          Math.max(0, data.sentences.length - 1),
        )
        const candidates = [firstUnfinished, savedIndex].filter(
          (index) => index >= 0 && index < data.sentences.length && !serverDone.has(index),
        )
        const startIndex = allDone ? 0 : candidates.length > 0 ? Math.max(...candidates) : 0
        indexRef.current = startIndex
        setCurrentIndex(startIndex)
        setSessions({})
        setStatsByIndex({})
        statsRef.current = {}
        setRoundCompleted(new Set())
        roundCompletedRef.current = new Set()
        const initialCompleted = allDone ? new Set<number>() : new Set(serverDone)
        setCompletedIndexes(initialCompleted)
        completedRef.current = initialCompleted
        setRoundStartedAt(Date.now())
        setTranslationVisible(true)
        setSummaryOpen(allDone)
        setLoading(false)
        resetPlayback()
        armAutoplay(!allDone)
      })
      .catch((error) => {
        if (cancelled) return
        setLoading(false)
        setLoadError(errorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [armAutoplay, courseId, resetPlayback])

  const bumpStats = useCallback((index: number, patch: Partial<SentenceStats>) => {
    const previous = statsRef.current[index] || { errors: 0, hints: 0 }
    const next = {
      errors: previous.errors + (patch.errors || 0),
      hints: previous.hints + (patch.hints || 0),
    }
    statsRef.current = { ...statsRef.current, [index]: next }
    setStatsByIndex(statsRef.current)
  }, [])

  const persistProgress = useCallback(
    (completedSet: Set<number>, courseSnapshot: EnglishCourseDetail, preferredCurrent?: number) => {
      const union = new Set([...serverCompletedRef.current, ...completedSet])
      const sorted = Array.from(union).sort((a, b) => a - b)
      const nextUnfinished = courseSnapshot.sentences.find((item) => !union.has(item.index))
      const preferred =
        preferredCurrent != null
        && preferredCurrent >= 0
        && preferredCurrent < courseSnapshot.sentences.length
        && !union.has(preferredCurrent)
          ? preferredCurrent
          : null
      const current = preferred ?? (nextUnfinished ? nextUnfinished.index : courseSnapshot.sentences.length)
      void updateEnglishCourseProgressApi(courseSnapshot.id, {
        currentSentenceIndex: current,
        completedSentenceIndexes: sorted,
      }).catch(() => toast.error('进度保存失败，稍后会自动重试。'))
    },
    [],
  )

  const handleSentenceComplete = useCallback(
    (completedSession: DictationSentenceSession) => {
      const snapshot = courseRef.current
      if (!snapshot) return
      const index = completedSession.sentenceIndex
      const nextCompleted = new Set(completedRef.current)
      nextCompleted.add(index)
      completedRef.current = nextCompleted
      setCompletedIndexes(nextCompleted)

      const nextRound = new Set(roundCompletedRef.current)
      nextRound.add(index)
      roundCompletedRef.current = nextRound
      setRoundCompleted(nextRound)
      setTranslationVisible(true)
      sound.playSentenceComplete()
      persistProgress(nextCompleted, snapshot, index + 1)

      const finishedAll = nextCompleted.size >= snapshot.sentences.length
      if (finishedAll) {
        setSummaryDurationMs(Date.now() - roundStartedAtRef.current)
        clearTimer(summaryTimerRef)
        summaryTimerRef.current = window.setTimeout(() => {
          summaryTimerRef.current = null
          videoRef.current?.pause()
          setSummaryOpen(true)
        }, SUMMARY_DELAY_MS)
        return
      }
      const continuous = settingsRef.current.playback.mode === 'continuous'
      if (!continuous && settingsRef.current.replay.autoReplayOnPass) {
        clearTimer(autoTimerRef)
        autoTimerRef.current = window.setTimeout(() => {
          autoTimerRef.current = null
          playback.replayCurrentSentence()
        }, 700)
      } else if (!continuous && settingsRef.current.flow.autoAdvanceOnPass) {
        clearTimer(autoTimerRef)
        autoTimerRef.current = window.setTimeout(() => {
          autoTimerRef.current = null
          playback.goToSentence(indexRef.current + 1)
        }, AUTO_ADVANCE_DELAY_MS)
      }
    },
    [persistProgress, playback, settingsRef, sound],
  )

  const applyStep = useCallback(
    (step: DictationStep, hinted = false) => {
      const active = sentenceRef.current
      if (!active) return
      if (step.session !== sessionRef.current) {
        sessionRef.current = step.session
        setSessions((previous) => ({ ...previous, [active.index]: step.session }))
      }
      if (hinted && step.outcome !== 'ignored') bumpStats(active.index, { hints: 1 })

      if (step.outcome === 'typing') {
        return
      }
      if (step.outcome === 'word-correct') {
        sound.playCorrectSound()
        return
      }
      if (step.outcome === 'word-wrong') {
        sound.playWrongSound()
        bumpStats(active.index, { errors: 1 })
        const wrongSentenceIndex = active.index
        clearTimer(wrongTimerRef)
        wrongTimerRef.current = window.setTimeout(() => {
          wrongTimerRef.current = null
          const latest = sessionRef.current
          if (!latest || latest.sentenceIndex !== wrongSentenceIndex) return
          const cleared = clearWrongDictationWord(latest, step.wordIndex)
          if (cleared !== latest) {
            sessionRef.current = cleared
            setSessions((previous) => ({ ...previous, [latest.sentenceIndex]: cleared }))
          }
        }, WRONG_CLEAR_DELAY_MS)
        return
      }
      if (step.outcome === 'complete') {
        clearTimer(wrongTimerRef)
        handleSentenceComplete(step.session)
      }
    },
    [bumpStats, handleSentenceComplete, sound],
  )

  const typeChar = useCallback(
    (char: string) => {
      const active = sentenceRef.current
      if (!active || char.length !== 1 || char === ' ') return
      const step = typeDictationChar(sessionRef.current, char)
      if (step.outcome !== 'ignored') sound.playKeySound()
      applyStep(step)
    },
    [applyStep, sound],
  )

  const revealLetter = useCallback(() => {
    if (!sentenceRef.current) return
    const step = revealDictationLetter(sessionRef.current)
    if (step.outcome === 'ignored') {
      showFlash('本句已经完成，按 → 进入下一句。')
      return
    }
    sound.playKeySound()
    applyStep(step, true)
  }, [applyStep, showFlash, sound])

  const revealWord = useCallback(() => {
    const active = sentenceRef.current
    if (!active) return
    const step = revealDictationWord(sessionRef.current)
    if (step.outcome === 'ignored') {
      showFlash('本句已经完成，按 → 进入下一句。')
      return
    }
    bumpStats(active.index, { hints: 1 })
    sound.playCorrectSound()
    sessionRef.current = step.session
    setSessions((previous) => ({ ...previous, [active.index]: step.session }))
    if (step.outcome === 'complete') {
      clearTimer(wrongTimerRef)
      handleSentenceComplete(step.session)
    }
  }, [bumpStats, handleSentenceComplete, showFlash, sound])

  const resetSentence = useCallback(() => {
    const active = sentenceRef.current
    if (!active) return
    clearTimer(wrongTimerRef); clearTimer(autoTimerRef); clearTimer(summaryTimerRef)
    const next = resetDictationSession(sessionRef.current)
    sessionRef.current = next
    setSessions((previous) => ({ ...previous, [active.index]: next }))
    setTranslationVisible(false)
    if (completedRef.current.has(active.index)) {
      const completed = new Set(completedRef.current)
      completed.delete(active.index)
      completedRef.current = completed
      setCompletedIndexes(completed)
      const round = new Set(roundCompletedRef.current)
      round.delete(active.index)
      roundCompletedRef.current = round
      setRoundCompleted(round)
      if (statsRef.current[active.index]) {
        const nextStats = { ...statsRef.current }
        delete nextStats[active.index]
        statsRef.current = nextStats
        setStatsByIndex(nextStats)
      }
    }
    showFlash('本句已重置，可以重新拼写。')
  }, [showFlash])

  const toggleTranslation = useCallback(() => {
    if (!sessionRef.current.completed) {
      showFlash('完成本句后才会显示译文。')
      return
    }
    setTranslationVisible((previous) => !previous)
  }, [showFlash])

  const restartRound = useCallback(() => {
    clearTimer(wrongTimerRef)
    clearTimer(autoTimerRef)
    clearTimer(summaryTimerRef)
    const snapshot = courseRef.current
    setSessions({})
    setStatsByIndex({})
    statsRef.current = {}
    setCompletedIndexes(new Set())
    completedRef.current = new Set()
    setRoundCompleted(new Set())
    roundCompletedRef.current = new Set()
    setSummaryOpen(false)
    setCurrentIndex(0)
    indexRef.current = 0
    setTranslationVisible(true)
    setRoundStartedAt(Date.now())
    roundStartedAtRef.current = Date.now()
    playback.resetPlayback()
    const first = snapshot?.sentences[0]
    const video = videoRef.current
    playback.armAutoplay(!(video && video.readyState >= 1))
    if (video && first) {
      try {
        video.currentTime = first.startMs / 1000
      } catch {
        // Ignore.
      }
      video.playbackRate = settingsRef.current.stage.playbackSpeed
      void video.play().catch(() => undefined)
    }
  }, [playback, settingsRef])

  const handleKeyAction = useCallback(
    (action: EnglishShortcutActionId) => {
      switch (action) {
        case 'replay_sentence':
          if (playback.userPaused) {
            playback.toggleUserPause()
          } else {
            playback.replayCurrentSentence()
          }
          break
        case 'previous_sentence':
          playback.goToSentence(indexRef.current - 1)
          break
        case 'next_sentence':
          playback.goToSentence(indexRef.current + 1)
          break
        case 'pause_session':
          playback.toggleUserPause()
          break
        case 'toggle_playback_mode':
          togglePlaybackMode()
          break
        case 'reveal_letter':
          revealLetter()
          break
        case 'reveal_word':
          revealWord()
          break
        case 'reset_sentence':
          resetSentence()
          break
        case 'toggle_translation':
          toggleTranslation()
          break
        case 'toggle_mask':
          toggleMask()
          break
        case 'cycle_layout':
          cycleLayout()
          break
        case 'speed_up':
          changeSpeed(1)
          break
        case 'speed_down':
          changeSpeed(-1)
          break
        case 'toggle_sound':
          toggleSound()
          break
        case 'open_shortcuts':
          openShortcuts()
          break
      }
    },
    [
      changeSpeed,
      cycleLayout,
      openShortcuts,
      playback,
      resetSentence,
      revealLetter,
      revealWord,
      toggleMask,
      togglePlaybackMode,
      toggleSound,
      toggleTranslation,
    ],
  )

  const handleGlobalKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (shortcutsOpenRef.current) return

      if (summaryOpenRef.current) {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          restartRound()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          navigate('/english/listening')
        }
        return
      }

      if (!courseRef.current) return
      if (isEditableTarget(event.target, typingInputRef.current)) return

      const shortcuts = settingsRef.current.shortcuts
      for (const action of Object.keys(shortcuts) as EnglishShortcutActionId[]) {
        if (isShortcutPressed(event, shortcuts[action])) {
          event.preventDefault()
          event.stopPropagation()
          handleKeyAction(action)
          return
        }
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return

      if (event.key === 'Backspace') {
        event.preventDefault(); event.stopPropagation()
        if (sessionRef.current.completed) { resetSentence(); return }
        const next = backspaceDictationChar(sessionRef.current)
        if (next !== sessionRef.current) {
          sessionRef.current = next
          setSessions((previous) => ({ ...previous, [next.sentenceIndex]: next }))
        }
        return
      }
      if (event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.key.length === 1) {
        event.preventDefault()
        event.stopPropagation()
        typeChar(event.key)
      }
    },
    [handleKeyAction, navigate, resetSentence, restartRound, settingsRef, typeChar],
  )

  handlerRef.current = handleGlobalKeyDown

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handlerRef.current(event)
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])

  const handleBack = useCallback(() => {
    videoRef.current?.pause()
    navigate('/english/listening')
  }, [navigate, videoRef])

  const summaryStats = useMemo(
    () => buildSummaryStats(course, roundCompleted, statsByIndex, summaryDurationMs),
    [course, roundCompleted, statsByIndex, summaryDurationMs],
  )

  const handleStagePointerDown = useCallback(() => {
    if (isTouchPrimaryInput()) typingInputRef.current?.focus({ preventScroll: true })
  }, [])

  if (!Number.isFinite(courseId) || courseId <= 0) {
    return <DictationPageMessage title="无效的课程编号" description="回到片库重新选择一部课程。" onBack={handleBack} />
  }

  if (loading) {
    return (
      <div className="ed-page ed-page--loading" aria-label="课程载入中">
        <LoaderCircle className="size-6 animate-spin" />
        <span>正在打开听写课程…</span>
      </div>
    )
  }

  if (loadError || !course) {
    return (
      <DictationPageMessage
        title="课程没有加载出来"
        description={loadError || '课程不存在或已被删除。'}
        onBack={handleBack}
      />
    )
  }

  if (course.sentences.length === 0) {
    return (
      <DictationPageMessage
        title="课程里没有句子"
        description="这份课程没有可练习的字幕句子，请重新导入视频与英文字幕。"
        onBack={handleBack}
      />
    )
  }

  const layout = settings.stage.layout
  const sentenceNumber = (sentence?.index ?? 0) + 1
  const completedCount = completedIndexes.size
  const mediaUrl = course.mediaUrl || buildEnglishCourseMediaUrl(course.id)
  const resumeHint = buildResumeHint(settings)
  const videoProps = buildDictationVideoProps({
    videoRef, mediaUrl, maskEnabled, maskRect, mask: settings.stage.mask,
    onMaskChange: previewMaskRect, onMaskCommit: setMaskRect, playback, settings,
  })

  return (
    <div
      className={cn('ed-page', `ed-page--${layout}`)}
      data-testid="english-course-workbench"
    >
      <div className="ed-page__ambient" aria-hidden />
      <DictationHeader
        title={course.title}
        sentenceNumber={sentenceNumber}
        sentenceCount={course.sentences.length}
        completedCount={completedCount}
        layout={layout}
        playbackMode={settings.playback.mode}
        playbackShortcutLabel={buildPlaybackShortcutLabel(settings)}
        maskEnabled={maskEnabled}
        soundEnabled={settings.sound.enabled}
        onBack={handleBack}
        onCycleLayout={cycleLayout}
        onTogglePlaybackMode={togglePlaybackMode}
        onToggleMask={toggleMask}
        onToggleSound={toggleSound}
        onOpenShortcuts={openShortcuts}
        shortcutsLabel={buildShortcutsLabel(settings)}
      />

      <DictationStageLayouts
        course={course}
        sentence={sentence}
        activeSession={activeSession}
        sentenceNumber={sentenceNumber}
        currentIndex={currentIndex}
        completedIndexes={completedIndexes}
        translationVisible={translationVisible}
        settings={settings}
        videoProps={videoProps}
        onToggleTranslation={toggleTranslation}
        onOpenShortcuts={openShortcuts}
        onGoToSentence={playback.goToSentence}
        onActivateInput={handleStagePointerDown}
      />

      <input
        ref={typingInputRef}
        className="ed-hidden-input"
        aria-label="英语拼写输入"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value=""
        onChange={() => undefined}
      />

      <DictationPauseOverlay
        visible={playback.userPaused && !summaryOpen && !shortcutsOpen}
        onResume={playback.toggleUserPause}
        resumeHint={resumeHint}
      />
      <DictationSummary
        visible={summaryOpen}
        title={course.title}
        sentenceCount={course.sentences.length}
        hasRound={roundCompleted.size > 0}
        stats={summaryStats}
        onRestart={restartRound}
        onBack={handleBack}
      />
      <DictationShortcutPanel
        open={shortcutsOpen}
        settings={settings}
        onClose={closeShortcuts}
        onSave={saveSettings}
        onResetMask={resetMask}
        onFullWidthMask={fullWidthMask}
        maskRect={maskRect}
      />
      <DictationFlash message={flash} />
    </div>
  )
}

