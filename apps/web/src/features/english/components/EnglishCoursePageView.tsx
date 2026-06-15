import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Settings2, Sparkles, Volume2 } from 'lucide-react'
import type { EnglishCourseDetail, EnglishSentenceCheckResponse } from '@/shared/api/contracts'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import { LoadingState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'
import { EnglishPracticeSettingsDialog } from '@/features/english/components/EnglishPracticeSettingsDialog'
import {
  FinalCheckRail,
  ShortcutSummary,
  SidePanelTabButton,
  StatusBanner,
  WordRail,
  type StatusNotice,
  type WordRailDensity,
} from '@/features/english/components/EnglishCourseParts'
import type { EnglishPracticeSettings } from '@/features/english/englishPracticeSettings'
import { shouldKeepEnglishPracticeControlFocus } from '@/features/english/englishTypingHelpers'
import type { useEnglishWordTyping } from '@/features/english/useEnglishWordTyping'
import type { useTimedSession } from '@/shared/hooks/useTimedSession'

type EnglishCourseSentence = EnglishCourseDetail['sentences'][number]
type EnglishTypingState = ReturnType<typeof useEnglishWordTyping>['typingState']
type EnglishCourseTimer = ReturnType<typeof useTimedSession>
type TranslationMode = 'placeholder' | 'previous' | 'current'
type SidePanelTab = 'info' | 'shortcuts' | 'rhythm'

interface EnglishCoursePageViewProps {
  courseId: number
  loading: boolean
  course: EnglishCourseDetail | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  typingInputRef: React.RefObject<HTMLInputElement | null>
  timer: EnglishCourseTimer
  mediaUrl: string
  isCourseDisplayCompleted: boolean
  activeSentence: EnglishCourseSentence | null
  translationSentence: EnglishCourseSentence | null
  translationMode: TranslationMode
  practiceSettings: EnglishPracticeSettings
  statusNotice: StatusNotice | null
  feedback: EnglishSentenceCheckResponse | null
  activeSentenceTokens: string[]
  typingState: EnglishTypingState
  wordRevealComparableIndices: number[][]
  wordRailDensity: WordRailDensity
  handleTypingInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  typingEnabled: boolean
  settingsOpen: boolean
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
  focusTypingInput: (restoreKeyboard?: boolean) => void
  isTouchDevice: boolean
  replayCurrentSentence: (source?: string, nextTargetIndexOverride?: number | null) => boolean
  revealLetter: () => void
  handleNavigateSentence: (delta: number) => void
  helperPanelOpen: boolean
  setHelperPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  sidePanelTab: SidePanelTab
  setSidePanelTab: React.Dispatch<React.SetStateAction<SidePanelTab>>
  handleSavePracticeSettings: (nextSettings: EnglishPracticeSettings) => void
}

function getWorkbenchDensityClasses(density: WordRailDensity) {
  if (density === 'dense') {
    return {
      panel: 'grid-rows-[minmax(0,24vh)_minmax(0,1fr)] lg:grid-rows-[minmax(0,28vh)_minmax(0,1fr)]',
      translation: 'px-3 py-2.5 text-xs leading-5',
    }
  }

  if (density === 'compact') {
    return {
      panel: 'grid-rows-[minmax(0,26vh)_minmax(0,1fr)] lg:grid-rows-[minmax(0,31vh)_minmax(0,1fr)]',
      translation: 'px-4 py-3 text-sm leading-5',
    }
  }

  return {
    panel: 'grid-rows-[minmax(0,28vh)_minmax(0,1fr)] lg:grid-rows-[minmax(0,34vh)_minmax(0,1fr)]',
    translation: 'px-4 py-3 text-sm leading-6',
  }
}

export function EnglishCoursePageView(props: EnglishCoursePageViewProps) {
  const {
    courseId,
    loading,
    course,
    videoRef,
    typingInputRef,
    timer,
    mediaUrl,
    isCourseDisplayCompleted,
    activeSentence,
    translationSentence,
    translationMode,
    practiceSettings,
    statusNotice,
    feedback,
    activeSentenceTokens,
    typingState,
    wordRevealComparableIndices,
    wordRailDensity,
    handleTypingInputKeyDown,
    typingEnabled,
    settingsOpen,
    setSettingsOpen,
    focusTypingInput,
    isTouchDevice,
    replayCurrentSentence,
    revealLetter,
    handleNavigateSentence,
    helperPanelOpen,
    setHelperPanelOpen,
    sidePanelTab,
    setSidePanelTab,
    handleSavePracticeSettings,
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
    return <LoadingState text="正在加载英语课程…" />
  }

  const sentenceCount = course.sentences.length
  const densityClasses = getWorkbenchDensityClasses(wordRailDensity)
  const translationTitle =
    translationMode === 'current' ? '当前句译文' : translationMode === 'previous' ? '上一句译文' : '翻译区'
  const translationBody =
    translationMode === 'placeholder'
      ? '本句单词全部显示后，这里会立刻切到当前句译文。'
      : translationSentence?.textZh || '本句暂未生成译文。'

  return (
    <div
      className="flex h-[calc(100dvh-3rem)] min-h-[calc(100dvh-3rem)] flex-col overflow-hidden"
      data-testid="english-course-workbench"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-2">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/english">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <span className="truncate text-sm font-medium">{course.title}</span>
        {activeSentence ? (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            Sentence {activeSentence.index + 1} / {sentenceCount}
          </span>
        ) : null}
      </div>

      <div className="shrink-0 px-3 pt-3">
        <SessionTimerBar
          effectiveSeconds={timer.effectiveSeconds}
          idleSeconds={timer.idleSeconds}
          automationScene="english"
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        {isCourseDisplayCompleted ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="text-lg font-semibold text-muted-foreground">课程已完成</div>
            <Button variant="outline" size="sm" onClick={() => navigate('/english')}>
              返回英语听力
            </Button>
          </div>
        ) : activeSentence ? (
          <>
            <div
              data-testid="english-course-main-panel"
              data-density={wordRailDensity}
              className={`grid min-h-0 flex-1 gap-3 overflow-hidden ${densityClasses.panel}`}
            >
              <div
                data-testid="english-course-video-panel"
                className="overflow-hidden rounded-2xl bg-black"
              >
                <video
                  ref={videoRef}
                  controls
                  preload="metadata"
                  src={mediaUrl}
                  className="h-full w-full object-contain"
                />
              </div>

              <div
                data-testid="english-course-spelling-panel"
                className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 p-4"
              >
                <div className="flex shrink-0 items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">当前句拼写</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      本句播完会暂停等待输入；单词全部显示后会立刻重播本句并连播下一句。
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex min-h-0 flex-1 items-start overflow-hidden">
                  <WordRail
                    expectedTokens={activeSentenceTokens}
                    wordInputs={typingState.wordInputs}
                    wordStatuses={typingState.wordStatuses}
                    wordRevealComparableIndices={wordRevealComparableIndices}
                    density={wordRailDensity}
                  />
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
                  className="pointer-events-none absolute h-0 w-0 opacity-0"
                />

                <div data-testid="english-course-inline-translation" className="mt-3 shrink-0">
                  <div className="mb-1 text-xs text-muted-foreground">{translationTitle}</div>
                  <p
                    className={`rounded-xl ${
                      translationMode === 'current'
                        ? 'border border-success/20 bg-success/5 text-success'
                        : translationMode === 'previous'
                          ? 'border border-info/20 bg-info/5 text-info'
                          : 'bg-muted/40 text-muted-foreground'
                    } ${densityClasses.translation}`}
                  >
                    {translationBody}
                  </p>
                </div>

                {statusNotice ? (
                  <div className="mt-3 shrink-0">
                    <StatusBanner notice={statusNotice} />
                  </div>
                ) : null}

                {feedback && !feedback.passed && feedback.tokenResults.length > 0 ? (
                  <div className="mt-3 shrink-0">
                    <FinalCheckRail feedback={feedback} />
                  </div>
                ) : null}

                <div className="mt-3 flex shrink-0 items-center justify-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => replayCurrentSentence('english_button_replay')}
                    title="重播"
                  >
                    <Volume2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!typingEnabled}
                    onClick={() => revealLetter()}
                    title="揭示字母"
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                  <div className="mx-1 h-5 w-px bg-border" />
                  <Button variant="ghost" size="icon" onClick={() => handleNavigateSentence(-1)} title="上一句">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleNavigateSentence(1)} title="下一句">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <div className="mx-1 h-5 w-px bg-border" />
                  <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} title="设置">
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div data-testid="english-course-helper-panel" className="shrink-0">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHelperPanelOpen(!helperPanelOpen)}
                  aria-label="辅助面板"
                >
                  {helperPanelOpen ? '收起辅助面板' : '辅助面板'}
                </Button>
              </div>
              {helperPanelOpen ? (
                <div
                  data-testid="english-course-helper-content"
                  className="mt-2 max-h-[22vh] space-y-3 overflow-y-auto rounded-2xl border border-border/70 p-4"
                >
                  <div className="flex items-center gap-2">
                    <SidePanelTabButton active={sidePanelTab === 'info'} label="信息" onClick={() => setSidePanelTab('info')} />
                    <SidePanelTabButton active={sidePanelTab === 'shortcuts'} label="快捷键" onClick={() => setSidePanelTab('shortcuts')} />
                    <SidePanelTabButton active={sidePanelTab === 'rhythm'} label="节奏" onClick={() => setSidePanelTab('rhythm')} />
                  </div>
                  {sidePanelTab === 'shortcuts' ? (
                    <div className="space-y-3">
                      <ShortcutSummary settings={practiceSettings} />
                      <div className="rounded-2xl border border-info/20 bg-info/5 px-4 py-3 text-sm text-info">
                        点击“练习设置”可以重新录制快捷键。默认全部使用带修饰键组合，避免和拼写输入冲突。
                      </div>
                    </div>
                  ) : sidePanelTab === 'rhythm' ? (
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>默认节奏是“听一句停一句”，本句完整显示后会自动连播“本句 + 下一句”。</p>
                      <p>视频区域只会在少量固定档位里轻微收紧，避免每句都明显跳动。</p>
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>当前句输入时，翻译区默认保留上一句译文；本句完整显示后会立即切到本句译文。</p>
                      <p>如果最终校验和本地显示不一致，系统会回退到该句重新拼写。</p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      <EnglishPracticeSettingsDialog
        open={settingsOpen}
        settings={practiceSettings}
        onOpenChange={setSettingsOpen}
        onSave={handleSavePracticeSettings}
      />
    </div>
  )
}
