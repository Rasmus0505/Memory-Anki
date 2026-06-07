import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RotateCcw,
  ScrollText,
  Settings2,
  Sparkles,
  Volume2,
  VolumeX,
  Wand2,
  XCircle,
} from 'lucide-react'
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
} from '@/shared/api/modules/english'
import { formatDuration } from '@/entities/session/model'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { EnglishGenerationLogDialog } from '@/features/english/components/EnglishGenerationLogDialog'
import { EnglishPracticeSettingsDialog } from '@/features/english/components/EnglishPracticeSettingsDialog'
import {
  ENGLISH_PRACTICE_SETTINGS_UPDATED_EVENT,
  ENGLISH_SHORTCUT_ACTIONS,
  getShortcutLabel,
  isShortcutPressed,
  readEnglishPracticeSettings,
  writeEnglishPracticeSettings,
  type EnglishPracticeSettings,
} from '@/features/english/englishPracticeSettings'
import {
  buildLetterSlots,
  isEditableShortcutTarget,
  isTouchPrimaryInputDevice,
  shouldKeepEnglishPracticeControlFocus,
} from '@/features/english/englishTypingHelpers'
import { useEnglishTypingFeedbackSounds } from '@/features/english/useEnglishTypingFeedbackSounds'
import { useEnglishWordTyping } from '@/features/english/useEnglishWordTyping'

const POST_PASS_ADVANCE_DELAY_MS = 1200
const POST_REPLAY_ADVANCE_DELAY_MS = 0
const LOOP_REPLAY_DELAY_MS = 110
const FOCUS_RESTORE_DELAY_MS = 180
const EMPTY_TOKENS: string[] = []
const EMPTY_COMPLETED_SENTENCE_INDEXES: number[] = []

function resolveDisplaySentenceIndex(course: EnglishCourseDetail) {
  const sentenceCount = course.sentences.length
  if (sentenceCount <= 0) return 0

  const rawIndex = Number.isFinite(course.progress.currentSentenceIndex)
    ? Math.round(course.progress.currentSentenceIndex)
    : 0
  const clampedIndex = Math.max(0, Math.min(sentenceCount, rawIndex))

  if (course.progress.completed && clampedIndex >= sentenceCount) {
    return sentenceCount
  }

  if (clampedIndex < sentenceCount && course.sentences[clampedIndex]) {
    return clampedIndex
  }

  const completedSentenceSet = new Set(course.progress.completedSentenceIndexes)
  const firstUnfinishedIndex = course.sentences.findIndex((sentence) => !completedSentenceSet.has(sentence.index))
  if (firstUnfinishedIndex >= 0) {
    return firstUnfinishedIndex
  }

  return course.progress.completed ? sentenceCount : Math.max(0, sentenceCount - 1)
}

interface StatusNotice {
  kind: 'info' | 'success' | 'error'
  text: string
}

function StatusBanner({ notice }: { notice: StatusNotice | null }) {
  if (!notice) return null

  const palette =
    notice.kind === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : notice.kind === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-sky-200 bg-sky-50 text-sky-700'

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${palette}`}>
      <div className="flex items-center gap-2 font-medium">
        {notice.kind === 'success' ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : notice.kind === 'error' ? (
          <XCircle className="h-4 w-4" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {notice.text}
      </div>
    </div>
  )
}

function WordRail({
  expectedTokens,
  wordInputs,
  wordStatuses,
  wordRevealComparableIndices,
}: {
  expectedTokens: string[]
  wordInputs: string[]
  wordStatuses: string[]
  wordRevealComparableIndices: number[][]
}) {
  if (!expectedTokens.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
        当前句没有可练习的 token。
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-3" data-testid="english-word-rail">
      {expectedTokens.map((token, index) => {
        const status = wordStatuses[index] || 'pending'
        const slots = buildLetterSlots(token, wordInputs[index] || '', wordRevealComparableIndices[index] || [])
        const wordShellClassName =
          status === 'correct'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
            : status === 'wrong'
              ? 'border-rose-300 bg-rose-50 text-rose-800'
              : status === 'active'
                ? 'border-sky-300 bg-sky-50 text-sky-800 shadow-[0_0_0_1px_rgba(14,165,233,0.08)]'
                : 'border-border/70 bg-background/80 text-muted-foreground'

        return (
          <div
            key={`${token}-${index}`}
            data-testid={`english-word-${index}`}
            data-status={status}
            className={`min-w-[120px] rounded-2xl border px-3 py-3 transition-colors ${wordShellClassName}`}
          >
            <div className="flex flex-wrap justify-center gap-1">
              {slots.map((slot) => {
                const slotClassName =
                  slot.state === 'correct'
                    ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                    : slot.state === 'wrong'
                      ? 'border-rose-300 bg-rose-100 text-rose-800'
                      : slot.state === 'revealed'
                        ? 'border-amber-300 bg-amber-100 text-amber-800'
                        : slot.state === 'fixed'
                          ? 'border-transparent bg-transparent text-muted-foreground'
                          : 'border-border/70 bg-background text-transparent'
                return (
                  <span
                    key={slot.key}
                    data-slot-state={slot.state}
                    className={`inline-flex h-10 min-w-8 items-center justify-center rounded-xl border px-2 font-mono text-base font-semibold ${
                      slot.extra ? 'min-w-7' : ''
                    } ${slotClassName}`}
                  >
                    {slot.char}
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FinalCheckRail({
  feedback,
}: {
  feedback: EnglishSentenceCheckResponse | null
}) {
  if (!feedback || feedback.passed || feedback.tokenResults.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-4">
      {feedback.tokenResults.map((item, index) => (
        <span
          key={`check-${index}`}
          className={`inline-flex min-h-10 min-w-[58px] items-center justify-center rounded-xl border-b-2 px-3 text-sm font-medium ${
            item.correct
              ? 'border-emerald-500 bg-emerald-100 text-emerald-700'
              : 'border-rose-400 bg-white text-rose-700'
          }`}
        >
          {item.input || '____'}
        </span>
      ))}
    </div>
  )
}

function ShortcutSummary({ settings }: { settings: EnglishPracticeSettings }) {
  return (
    <div className="space-y-2">
      {ENGLISH_SHORTCUT_ACTIONS.map((action) => (
        <div key={action.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{action.label}</span>
          <Badge variant="outline" className="font-mono text-[11px]">
            {getShortcutLabel(settings.shortcuts[action.id])}
          </Badge>
        </div>
      ))}
    </div>
  )
}

function SidePanelTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button type="button" size="sm" variant={active ? 'default' : 'outline'} onClick={onClick}>
      {label}
    </Button>
  )
}

export default function EnglishCoursePage() {
  const { id } = useParams()
  const navigate = useNavigate()
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
  const timerRef = useRef(timer)
  const courseRef = useRef<EnglishCourseDetail | null>(course)
  const displaySentenceIndexRef = useRef(displaySentenceIndex)
  const sentenceResolvedRef = useRef(sentenceResolved)
  const practiceSettingsRef = useRef(practiceSettings)
  const isSegmentPlayingRef = useRef(isSegmentPlaying)
  const submissionFailedRef = useRef(submissionFailed)

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
    timerRef.current = timer
  }, [timer])

  useEffect(() => {
    courseRef.current = course
  }, [course])

  useEffect(() => {
    displaySentenceIndexRef.current = displaySentenceIndex
  }, [displaySentenceIndex])

  useEffect(() => {
    sentenceResolvedRef.current = sentenceResolved
  }, [sentenceResolved])

  useEffect(() => {
    practiceSettingsRef.current = practiceSettings
  }, [practiceSettings])

  useEffect(() => {
    isSegmentPlayingRef.current = isSegmentPlaying
  }, [isSegmentPlaying])

  useEffect(() => {
    submissionFailedRef.current = submissionFailed
  }, [submissionFailed])

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

  const sentenceCount = course?.sentences.length ?? 0
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

  const {
    playKeySound,
    playWrongSound,
    playCorrectSound,
  } = useEnglishTypingFeedbackSounds(practiceSettings.sound.enabled)

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

  const handleShortcutCommand = useCallback(
    (event: KeyboardEvent | React.KeyboardEvent<HTMLInputElement>) => {
      if (settingsOpen) return false
      const keyboardEvent = 'nativeEvent' in event ? event.nativeEvent : event

      if (isShortcutPressed(keyboardEvent, practiceSettingsRef.current.shortcuts.replay_sentence)) {
        event.preventDefault()
        event.stopPropagation()
        replayCurrentSentence(`shortcut_${getShortcutLabel(practiceSettingsRef.current.shortcuts.replay_sentence)}`)
        return true
      }
      if (isShortcutPressed(keyboardEvent, practiceSettingsRef.current.shortcuts.previous_sentence)) {
        event.preventDefault()
        event.stopPropagation()
        handleNavigateSentence(-1)
        return true
      }
      if (isShortcutPressed(keyboardEvent, practiceSettingsRef.current.shortcuts.next_sentence)) {
        event.preventDefault()
        event.stopPropagation()
        handleNavigateSentence(1)
        return true
      }
      if (isShortcutPressed(keyboardEvent, practiceSettingsRef.current.shortcuts.reveal_word)) {
        event.preventDefault()
        event.stopPropagation()
        if (!sentenceResolvedRef.current) revealWord()
        return true
      }
      if (isShortcutPressed(keyboardEvent, practiceSettingsRef.current.shortcuts.reveal_letter)) {
        event.preventDefault()
        event.stopPropagation()
        if (!sentenceResolvedRef.current) revealLetter()
        return true
      }
      if (isShortcutPressed(keyboardEvent, practiceSettingsRef.current.shortcuts.toggle_single_loop)) {
        event.preventDefault()
        event.stopPropagation()
        toggleSingleSentenceLoop()
        return true
      }
      if (isShortcutPressed(keyboardEvent, practiceSettingsRef.current.shortcuts.toggle_auto_replay)) {
        event.preventDefault()
        event.stopPropagation()
        toggleAutoReplayOnPass()
        return true
      }
      if (isShortcutPressed(keyboardEvent, practiceSettingsRef.current.shortcuts.toggle_sound)) {
        event.preventDefault()
        event.stopPropagation()
        toggleSound()
        return true
      }
      return false
    },
    [
      handleNavigateSentence,
      replayCurrentSentence,
      revealLetter,
      revealWord,
      settingsOpen,
      toggleAutoReplayOnPass,
      toggleSingleSentenceLoop,
      toggleSound,
    ],
  )

  const handleTypingInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (handleShortcutCommand(event)) {
        return
      }
      if (!typingEnabled) return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      if (event.key === 'Backspace') {
        event.preventDefault()
        handleBackspace()
        return
      }

      if (event.key.length !== 1) return

      event.preventDefault()
      handleCharacterInput(event.key)
    },
    [handleBackspace, handleCharacterInput, handleShortcutCommand, typingEnabled],
  )

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
    if (typeof window === 'undefined') return undefined

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen) return
      if (event.target === typingInputRef.current) return
      if (isEditableShortcutTarget(event.target)) return
      handleShortcutCommand(event)
    }

    window.addEventListener('keydown', onWindowKeyDown)
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown)
    }
  }, [handleShortcutCommand, settingsOpen])

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

  if (!Number.isFinite(courseId)) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center text-sm text-muted-foreground">
        无效的课程编号。
      </div>
    )
  }

  if (loading || !course) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center text-sm text-muted-foreground">
        正在加载英语课程...
      </div>
    )
  }

  const shouldShowTranslation = Boolean(activeSentence && (activeSentenceCompleted || sentenceResolved))
  const currentSentenceCompletedNotice = activeSentenceCompleted && !sentenceResolved
  const showRetryButton = Boolean(activeSentence && isSentenceLocallyComplete && !sentenceResolved && !submitting)

  return (
    <div className="space-y-4 lg:flex lg:min-h-[calc(100vh-3rem)] lg:flex-col" data-testid="english-course-workbench">
      <div className="flex flex-col gap-4 lg:shrink-0">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/english">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回英语区
                </Link>
              </Button>
              <Badge variant={course.progress.completed ? 'outline' : 'secondary'}>
                {course.progress.completed ? '课程已完成' : '沉浸拼写'}
              </Badge>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">{course.title}</h1>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span>{course.sentences.length} 句</span>
              <span>{formatDuration(course.durationSeconds)}</span>
              <span>已完成 {completedSentenceIndexes.length} / {course.sentences.length}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              练习设置
            </Button>
            <Button variant="outline" onClick={() => void handleOpenGenerationLog()}>
              <ScrollText className="mr-2 h-4 w-4" />
              生成日志
            </Button>
          </div>
        </div>

        <SessionTimerBar
          effectiveSeconds={timer.effectiveSeconds}
          idleSeconds={timer.idleSeconds}
          pauseCount={timer.pauseCount}
          status={timer.status}
          onStart={() => timer.start({ source: 'manual_start', scene: 'english_course' })}
          onPause={() => timer.pause({ source: 'manual_pause', scene: 'english_course' })}
          onResume={() => timer.resume({ source: 'manual_resume', scene: 'english_course' })}
          onAdjustDuration={timer.adjustDuration}
          showCompleteAction={false}
          layout="compact"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-border/70 bg-card/95" data-testid="english-course-main-panel">
          <CardHeader className="space-y-3 lg:shrink-0">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">沉浸式逐词拼写</CardTitle>
              <div className="text-xs text-muted-foreground">{completionRatio}%</div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${completionRatio}%` }}
              />
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <div className="overflow-hidden rounded-3xl border border-border/70 bg-slate-950 lg:shrink-0">
              <video
                ref={videoRef}
                controls
                preload="metadata"
                src={mediaUrl}
                className="aspect-video w-full bg-black object-contain lg:max-h-[34vh]"
              />
            </div>

            {isCourseDisplayCompleted ? (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-8 text-center">
                <div className="flex justify-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                </div>
                <div className="mt-3 text-lg font-semibold text-emerald-700">这门英语课程已经完成</div>
                <div className="mt-2 text-sm text-emerald-700/80">可以回到英语区选择别的课程，或者再次打开重练。</div>
                <div className="mt-4 flex justify-center gap-2">
                  <Button variant="outline" onClick={() => setDisplaySentenceIndex(Math.max(0, course.sentences.length - 1))}>
                    回看最后一句
                  </Button>
                  <Button onClick={() => navigate('/english')}>
                    返回英语区
                  </Button>
                </div>
              </div>
            ) : activeSentence ? (
              <>
                <div className="rounded-3xl border border-border/70 bg-background/70 px-5 py-5 lg:shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        Sentence {activeSentence.index + 1} / {sentenceCount}
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        直接开始输入当前词；点击页面空白处会自动把焦点拉回拼写输入。当前句中文译文会在答对后显示。
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={practiceSettings.flow.autoAdvanceOnPass ? 'secondary' : 'outline'}>
                        {practiceSettings.flow.autoAdvanceOnPass ? '自动下一句开启' : '自动下一句关闭'}
                      </Badge>
                      <Badge variant={practiceSettings.replay.singleSentenceLoopEnabled ? 'default' : 'outline'}>
                        {practiceSettings.replay.singleSentenceLoopEnabled ? '单句循环中' : '单句循环关闭'}
                      </Badge>
                      <Badge variant={practiceSettings.replay.autoReplayOnPass ? 'secondary' : 'outline'}>
                        {practiceSettings.replay.autoReplayOnPass ? '答后重播开启' : '答后重播关闭'}
                      </Badge>
                    </div>
                  </div>
                </div>

                {currentSentenceCompletedNotice ? (
                  <StatusBanner
                    notice={{
                      kind: 'info',
                      text: '这句之前已经通过。你可以重写它，也可以直接切到上一句或下一句。',
                    }}
                  />
                ) : null}

                <StatusBanner notice={statusNotice} />

                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-3xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center justify-between gap-3 lg:shrink-0">
                    <div>
                      <div className="text-base font-semibold">当前句拼写</div>
                      <div className="mt-1 text-sm text-muted-foreground">当前词会实时判定；错误累计过多时会短暂红色闪烁并清空当前词。</div>
                    </div>
                    <Badge variant="outline">重播 {sentenceReplayCount} 次</Badge>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto pr-2" data-testid="english-course-wordrail-scroller">
                    <WordRail
                      expectedTokens={activeSentenceTokens}
                      wordInputs={typingState.wordInputs}
                      wordStatuses={typingState.wordStatuses}
                      wordRevealComparableIndices={wordRevealComparableIndices}
                    />
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-card/80 px-4 py-4 lg:shrink-0" data-testid="english-course-inline-translation">
                    <div className="text-xs text-muted-foreground">本句译文</div>
                    <div className="mt-2 text-sm leading-6 text-foreground">
                      {shouldShowTranslation ? activeSentence.textZh || '本句暂未生成译文。' : '答对当前句后这里会显示本句译文。'}
                    </div>
                  </div>

                  <FinalCheckRail feedback={feedback} />
                </div>

                <input
                  ref={typingInputRef}
                  value={typingState.currentWordInput}
                  onChange={() => undefined}
                  onKeyDown={handleTypingInputKeyDown}
                  onBlur={(event) => {
                    if (!typingEnabled || settingsOpen) return
                    window.setTimeout(() => {
                      const nextFocusTarget = event.relatedTarget ?? document.activeElement
                      if (shouldKeepEnglishPracticeControlFocus(nextFocusTarget)) return
                      focusTypingInput(isTouchDevice)
                    }, 0)
                  }}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  readOnly={!typingEnabled}
                  aria-label="英语拼写隐藏输入"
                  data-testid="english-typing-input"
                  className={
                    isTouchDevice
                      ? 'h-11 w-full rounded-2xl border border-border/70 bg-background px-4 text-base shadow-sm'
                      : 'pointer-events-none absolute h-0 w-0 opacity-0'
                  }
                />

                <div className="flex flex-wrap gap-2 lg:shrink-0">
                  <Button variant="outline" onClick={() => replayCurrentSentence('english_button_replay')}>
                    <Volume2 className="mr-2 h-4 w-4" />
                    重播当前句
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!typingEnabled}
                    onClick={() => {
                      setStatusNotice(null)
                      setSubmissionFailed(false)
                      resetCurrentWord()
                    }}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    重置当前词
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setStatusNotice(null)
                      setSubmissionFailed(false)
                      resetTypingState()
                    }}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    重置本句
                  </Button>
                  <Button variant="outline" disabled={!typingEnabled} onClick={() => revealLetter()}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    揭示一个字母
                  </Button>
                  <Button variant="outline" disabled={!typingEnabled} onClick={() => revealWord()}>
                    <Wand2 className="mr-2 h-4 w-4" />
                    揭示当前词
                  </Button>
                  {showRetryButton ? (
                    <Button onClick={() => void handleRetrySubmission()} disabled={submitting}>
                      {submitting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                      再次校验
                    </Button>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2 lg:shrink-0">
                  <Button variant="outline" onClick={() => handleNavigateSentence(-1)}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    上一句
                  </Button>
                  <Button variant="outline" onClick={() => handleNavigateSentence(1)}>
                    <ChevronRight className="mr-2 h-4 w-4" />
                    下一句
                  </Button>
                  <Button variant="outline" onClick={toggleAutoAdvanceOnPass}>
                    <ChevronRight className="mr-2 h-4 w-4" />
                    {practiceSettings.flow.autoAdvanceOnPass ? '关闭自动下一句' : '开启自动下一句'}
                  </Button>
                  <Button variant="outline" onClick={toggleSingleSentenceLoop}>
                    <Volume2 className="mr-2 h-4 w-4" />
                    {practiceSettings.replay.singleSentenceLoopEnabled ? '关闭单句循环' : '开启单句循环'}
                  </Button>
                  <Button variant="outline" onClick={toggleAutoReplayOnPass}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    {practiceSettings.replay.autoReplayOnPass ? '关闭答后重播' : '开启答后重播'}
                  </Button>
                  <Button variant="outline" onClick={toggleSound}>
                    {practiceSettings.sound.enabled ? (
                      <Volume2 className="mr-2 h-4 w-4" />
                    ) : (
                      <VolumeX className="mr-2 h-4 w-4" />
                    )}
                    {practiceSettings.sound.enabled ? '关闭声音' : '开启声音'}
                  </Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/70 bg-card/95 lg:shrink-0" data-testid="english-course-helper-panel">
          <button
            type="button"
            data-english-control-focus="true"
            aria-expanded={helperPanelOpen}
            onClick={() => setHelperPanelOpen((current) => !current)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-background/60"
          >
            <div>
              <div className="text-base font-semibold">辅助面板</div>
              <div className="mt-1 text-sm text-muted-foreground">快捷键、课程节奏和补充说明默认收起，不占主练习区空间。</div>
            </div>
            <Badge variant={helperPanelOpen ? 'default' : 'outline'}>
              {helperPanelOpen ? '收起' : '展开'}
            </Badge>
          </button>

          {helperPanelOpen ? (
            <CardContent className="space-y-4 border-t px-5 py-5" data-testid="english-course-helper-content">
              <div className="flex flex-wrap gap-2">
                <SidePanelTabButton active={sidePanelTab === 'info'} label="辅助信息" onClick={() => setSidePanelTab('info')} />
                <SidePanelTabButton active={sidePanelTab === 'shortcuts'} label="快捷键" onClick={() => setSidePanelTab('shortcuts')} />
                <SidePanelTabButton active={sidePanelTab === 'rhythm'} label="课程节奏" onClick={() => setSidePanelTab('rhythm')} />
              </div>

              <div className="max-h-[280px] space-y-4 overflow-y-auto pr-1">
                {sidePanelTab === 'info' ? (
                  activeSentence ? (
                    <>
                      <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4 text-sm text-muted-foreground">
                        当前词会实时判定；错误超过阈值或整词不匹配时会短暂红色闪烁并清空当前词。
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4 text-sm text-muted-foreground">
                        当前句重播次数：{sentenceReplayCount}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">
                      当前没有可显示的句子辅助信息。
                    </div>
                  )
                ) : null}

                {sidePanelTab === 'shortcuts' ? (
                  <>
                    <ShortcutSummary settings={practiceSettings} />
                    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4 text-sm text-muted-foreground">
                      点击“练习设置”可以重新录制快捷键。默认全部使用带修饰键组合，避免和拼写输入冲突。
                    </div>
                  </>
                ) : null}

                {sidePanelTab === 'rhythm' ? (
                  <>
                    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                      练累了可以随时暂停，回来会从上次课程进度继续。
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                      本页学习时长会计入总练习时长，同时标记为英语练习来源。
                    </div>
                  </>
                ) : null}
              </div>
            </CardContent>
          ) : null}
        </Card>
      </div>

      <EnglishPracticeSettingsDialog
        open={settingsOpen}
        settings={practiceSettings}
        onOpenChange={setSettingsOpen}
        onSave={(nextSettings) => {
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
        }}
      />

      <EnglishGenerationLogDialog
        open={logDialogOpen}
        onOpenChange={setLogDialogOpen}
        title="英语课程生成日志"
        loading={logLoading}
        error={logError}
        log={logData}
      />
    </div>
  )
}
