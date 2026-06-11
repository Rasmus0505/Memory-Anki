import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  SetStateAction,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
} from 'lucide-react'
import type {
  EnglishCourseDetail,
  EnglishGenerationLogResponse,
  EnglishSentenceCheckResponse,
} from '@/shared/api/contracts'
import { formatDuration } from '@/entities/session/model'
import type { useTimedSession } from '@/shared/hooks/useTimedSession'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { EnglishGenerationLogDialog } from '@/features/english/components/EnglishGenerationLogDialog'
import { EnglishPracticeSettingsDialog } from '@/features/english/components/EnglishPracticeSettingsDialog'
import {
  FinalCheckRail,
  ShortcutSummary,
  SidePanelTabButton,
  StatusBanner,
  type StatusNotice,
  WordRail,
} from '@/features/english/components/EnglishCourseParts'
import type { EnglishPracticeSettings } from '@/features/english/englishPracticeSettings'
import { shouldKeepEnglishPracticeControlFocus } from '@/features/english/englishTypingHelpers'
import type { useEnglishWordTyping } from '@/features/english/useEnglishWordTyping'

type EnglishCourseSentence = EnglishCourseDetail['sentences'][number]
type EnglishCourseTimer = ReturnType<typeof useTimedSession>
type EnglishTypingState = ReturnType<typeof useEnglishWordTyping>['typingState']
type SidePanelTab = 'info' | 'shortcuts' | 'rhythm'

interface EnglishCoursePageViewProps {
  courseId: number
  loading: boolean
  course: EnglishCourseDetail | null
  videoRef: RefObject<HTMLVideoElement | null>
  typingInputRef: RefObject<HTMLInputElement | null>
  timer: EnglishCourseTimer
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setDisplaySentenceIndex: Dispatch<SetStateAction<number>>
  handleOpenGenerationLog: () => Promise<void>
  completedSentenceIndexes: number[]
  completionRatio: number
  mediaUrl: string
  isCourseDisplayCompleted: boolean
  activeSentence: EnglishCourseSentence | null
  practiceSettings: EnglishPracticeSettings
  activeSentenceCompleted: boolean
  sentenceResolved: boolean
  statusNotice: StatusNotice | null
  feedback: EnglishSentenceCheckResponse | null
  activeSentenceTokens: string[]
  typingState: EnglishTypingState
  wordRevealComparableIndices: number[][]
  sentenceReplayCount: number
  handleTypingInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  typingEnabled: boolean
  settingsOpen: boolean
  focusTypingInput: (restoreKeyboard?: boolean) => void
  isTouchDevice: boolean
  replayCurrentSentence: (source?: string, nextTargetIndexOverride?: number | null) => boolean
  setStatusNotice: Dispatch<SetStateAction<StatusNotice | null>>
  setSubmissionFailed: Dispatch<SetStateAction<boolean>>
  resetCurrentWord: () => void
  resetTypingState: () => void
  revealLetter: () => void
  revealWord: () => void
  showRetryButton: boolean
  handleRetrySubmission: () => void
  submitting: boolean
  handleNavigateSentence: (delta: number) => void
  toggleAutoAdvanceOnPass: () => void
  toggleSingleSentenceLoop: () => void
  toggleAutoReplayOnPass: () => void
  toggleSound: () => void
  helperPanelOpen: boolean
  setHelperPanelOpen: Dispatch<SetStateAction<boolean>>
  sidePanelTab: SidePanelTab
  setSidePanelTab: Dispatch<SetStateAction<SidePanelTab>>
  handleSavePracticeSettings: (nextSettings: EnglishPracticeSettings) => void
  logDialogOpen: boolean
  setLogDialogOpen: Dispatch<SetStateAction<boolean>>
  logLoading: boolean
  logError: string
  logData: EnglishGenerationLogResponse | null
}

export function EnglishCoursePageView(props: EnglishCoursePageViewProps) {
  const {
    courseId,
    loading,
    course,
    videoRef,
    typingInputRef,
    timer,
    setSettingsOpen,
    setDisplaySentenceIndex,
    handleOpenGenerationLog,
    completedSentenceIndexes,
    completionRatio,
    mediaUrl,
    isCourseDisplayCompleted,
    activeSentence,
    practiceSettings,
    activeSentenceCompleted,
    sentenceResolved,
    statusNotice,
    feedback,
    activeSentenceTokens,
    typingState,
    wordRevealComparableIndices,
    sentenceReplayCount,
    handleTypingInputKeyDown,
    typingEnabled,
    settingsOpen,
    focusTypingInput,
    isTouchDevice,
    replayCurrentSentence,
    setStatusNotice,
    setSubmissionFailed,
    resetCurrentWord,
    resetTypingState,
    revealLetter,
    revealWord,
    showRetryButton,
    handleRetrySubmission,
    submitting,
    handleNavigateSentence,
    toggleAutoAdvanceOnPass,
    toggleSingleSentenceLoop,
    toggleAutoReplayOnPass,
    toggleSound,
    helperPanelOpen,
    setHelperPanelOpen,
    sidePanelTab,
    setSidePanelTab,
    handleSavePracticeSettings,
    logDialogOpen,
    setLogDialogOpen,
    logLoading,
    logError,
    logData,
  } = props
  const navigate = useNavigate()

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

  const sentenceCount = course.sentences.length
  const shouldShowTranslation = Boolean(activeSentence && (activeSentenceCompleted || sentenceResolved))
  const currentSentenceCompletedNotice = activeSentenceCompleted && !sentenceResolved

  return (
    <div className="space-y-4 lg:flex lg:min-h-[calc(100vh-3rem)] lg:flex-col" data-testid="english-course-workbench">
      <div className="flex flex-col gap-4 lg:shrink-0">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/english">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回英语听力
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
                <div className="mt-2 text-sm text-emerald-700/80">可以回到英语听力选择别的课程，或者再次打开重练。</div>
                <div className="mt-4 flex justify-center gap-2">
                  <Button variant="outline" onClick={() => setDisplaySentenceIndex(Math.max(0, course.sentences.length - 1))}>
                    回看最后一句
                  </Button>
                  <Button onClick={() => navigate('/english')}>
                    返回英语听力
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
                    <Button onClick={() => handleRetrySubmission()} disabled={submitting}>
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
                      本页学习时长会计入总听力时长，同时标记为英语听力来源。
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
        onSave={handleSavePracticeSettings}
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
