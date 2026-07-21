import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookmarkPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  LoaderCircle,
  PartyPopper,
  Settings2,
  Sparkles,
  Volume2,
} from 'lucide-react'
import { collectEnglishPatternSentenceApi } from '@/entities/english/api'
import type { EnglishCourseDetail, EnglishSentenceCheckResponse } from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'
import { LoadingState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
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
import type { EnglishPracticeSettings } from '@/entities/preferences/model/englishPracticeSettings'
import { shouldKeepEnglishPracticeControlFocus } from '@/features/english/englishTypingHelpers'
import { EnglishFocusChrome } from '@/features/english-shell'
import {
  EnglishDictionaryFloat,
  EnglishLookupText,
  useEnglishDictionaryLookup,
} from '@/features/english-text-interactions'
import type { useEnglishWordTyping } from '@/features/english/useEnglishWordTyping'
import type { useTimedSession } from '@/shared/hooks/useTimedSession'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { cn } from '@/shared/lib/utils'

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

function preferCollapsedVideo() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(max-height: 820px), (max-width: 900px)').matches
  } catch {
    return false
  }
}

export function EnglishCoursePageView(props: EnglishCoursePageViewProps) {
  const [collectingPattern, setCollectingPattern] = useState(false)
  const [sourceTextOpen, setSourceTextOpen] = useState(false)
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
  const { isActive } = useRouteResidency()
  const dictionary = useEnglishDictionaryLookup({
    isActive,
    timer,
  })
  const [videoCollapsed, setVideoCollapsed] = useState(preferCollapsedVideo)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-height: 820px), (max-width: 900px)')
    const sync = () => {
      if (media.matches) setVideoCollapsed(true)
    }
    sync()
    media.addEventListener?.('change', sync)
    return () => media.removeEventListener?.('change', sync)
  }, [])

  const handleCollectToPattern = async () => {
    if (!activeSentence?.textEn?.trim()) {
      toast.error('当前句没有可收藏的英文内容。')
      return
    }
    setCollectingPattern(true)
    try {
      const result = await collectEnglishPatternSentenceApi({
        patternTitle: course?.title ? `${course.title} · 听力摘句` : '听力摘句',
        textEn: activeSentence.textEn,
        textZh: activeSentence.textZh || '',
        source: 'from_listening',
        sourceCourseId: courseId,
        sourceSentenceId: activeSentence.id,
      })
      toast.success(`已加入句模「${result.pattern.title}」`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加入句模失败。')
    } finally {
      setCollectingPattern(false)
    }
  }

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
  const translationTitle =
    translationMode === 'current'
      ? '当前句译文'
      : translationMode === 'previous'
        ? '上一句译文'
        : '翻译区'
  const translationBody =
    translationMode === 'placeholder'
      ? '本句单词全部显示后，这里会立刻切到当前句译文。'
      : translationSentence?.textZh || '本句暂未生成译文。'

  const controlButtonClass = cn(
    'rounded-xl',
    isTouchDevice ? 'size-12' : 'size-10',
  )

  return (
    <div
      className="flex h-[calc(100dvh-3rem)] min-h-[calc(100dvh-3rem)] flex-col overflow-hidden bg-gradient-to-b from-background via-background to-muted/20"
      data-testid="english-course-workbench"
    >
      <EnglishFocusChrome
        backTo="/english/listening"
        backLabel="返回听力"
        title={course.title}
        subtitle={
          activeSentence
            ? `Sentence ${activeSentence.index + 1} / ${sentenceCount}`
            : isCourseDisplayCompleted
              ? '课程已完成'
              : undefined
        }
        trailing={
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-xl"
              onClick={() => setHelperPanelOpen(true)}
              title="帮助"
            >
              <CircleHelp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-xl"
              onClick={() => setSettingsOpen(true)}
              title="设置"
            >
              <Settings2 className="size-4" />
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4">
        {isCourseDisplayCompleted ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-3xl bg-success/10 text-success">
              <PartyPopper className="size-8" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xl font-semibold">课程完成</div>
              <p className="max-w-sm text-sm text-muted-foreground">
                共 {sentenceCount} 句听写完成。可以返回英语区，或再过一遍巩固。
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => navigate('/english')}>
                返回英语
              </Button>
              <Button
                className="min-h-11 rounded-xl"
                onClick={() => handleNavigateSentence(-(sentenceCount || 1))}
              >
                从头再练
              </Button>
            </div>
          </div>
        ) : activeSentence ? (
          <>
            <div
              data-testid="english-course-main-panel"
              data-density={wordRailDensity}
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
            >
              <div
                data-testid="english-course-video-panel"
                className={cn(
                  'relative overflow-hidden rounded-2xl border border-border/60 bg-black shadow-soft transition-all',
                  videoCollapsed ? 'h-12 shrink-0' : 'h-[min(32vh,280px)] shrink-0 sm:h-[min(34vh,320px)]',
                )}
              >
                <video
                  ref={videoRef}
                  controls
                  preload="metadata"
                  src={mediaUrl}
                  className={cn(
                    'h-full w-full object-contain',
                    videoCollapsed && 'pointer-events-none opacity-0',
                  )}
                />
                {videoCollapsed ? (
                  <button
                    type="button"
                    className="absolute inset-0 flex h-full w-full items-center justify-between gap-3 bg-zinc-950 px-4 text-left text-sm text-zinc-100"
                    onClick={() => setVideoCollapsed(false)}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Volume2 className="size-4 text-info" />
                      视频已收起 · 点击展开
                    </span>
                    <ChevronDown className="size-4 text-zinc-400" />
                  </button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="absolute right-2 top-2 rounded-xl bg-background/90"
                    onClick={() => setVideoCollapsed(true)}
                  >
                    <ChevronUp className="size-4" />
                    收起视频
                  </Button>
                )}
              </div>

              <div
                data-testid="english-course-spelling-panel"
                className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border/70 bg-card/95 p-4 shadow-card sm:p-5"
              >
                <div className="flex shrink-0 items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight">当前句拼写</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      听完输入；单词全部显示后会重播本句并连播下一句。
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex min-h-0 flex-1 items-start overflow-y-auto overflow-x-hidden pr-1">
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
                    if (!typingEnabled || settingsOpen || helperPanelOpen) return
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
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">{translationTitle}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 rounded-xl px-2.5 text-xs"
                        disabled={!activeSentence?.textEn}
                        onClick={() => setSourceTextOpen((open) => !open)}
                        data-testid="english-toggle-source-text"
                        data-english-control-focus="true"
                      >
                        {sourceTextOpen ? '收起原文' : '点词原文'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-xl px-2.5 text-xs"
                        disabled={!activeSentence?.textEn || collectingPattern}
                        onClick={() => void handleCollectToPattern()}
                        data-testid="english-collect-pattern"
                        data-english-control-focus="true"
                      >
                        {collectingPattern ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <BookmarkPlus className="size-3.5" />
                        )}
                        加入句模
                      </Button>
                    </div>
                  </div>
                  {sourceTextOpen && activeSentence?.textEn ? (
                    <div
                      data-testid="english-course-source-text"
                      className="mb-2 rounded-2xl border border-info/20 bg-info/5 px-4 py-3 text-sm leading-6 text-foreground"
                    >
                      <EnglishLookupText
                        text={activeSentence.textEn}
                        onLookupWord={dictionary.handleLookupWord}
                      />
                    </div>
                  ) : null}
                  <p
                    className={cn(
                      'rounded-2xl px-4 py-3 text-sm leading-6 transition-colors',
                      translationMode === 'current'
                        ? 'border border-success/20 bg-success/5 text-success'
                        : translationMode === 'previous'
                          ? 'border border-info/20 bg-info/5 text-info'
                          : 'bg-muted/40 text-muted-foreground',
                    )}
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
              </div>
            </div>

            <div
              className="mt-3 flex shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-border/60 bg-card/95 px-2 py-2 shadow-soft pb-[max(0.5rem,env(safe-area-inset-bottom))]"
              data-testid="english-course-control-bar"
            >
              <Button
                variant="ghost"
                size="icon"
                className={controlButtonClass}
                onClick={() => replayCurrentSentence('english_button_replay')}
                title="重播"
              >
                <Volume2 className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={controlButtonClass}
                disabled={!typingEnabled}
                onClick={() => revealLetter()}
                title="揭示字母"
              >
                <Sparkles className="size-4" />
              </Button>
              <div className="mx-1 h-5 w-px bg-border" />
              <Button
                variant="ghost"
                size="icon"
                className={controlButtonClass}
                onClick={() => handleNavigateSentence(-1)}
                title="上一句"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={controlButtonClass}
                onClick={() => handleNavigateSentence(1)}
                title="下一句"
              >
                <ChevronRight className="size-4" />
              </Button>
              <div className="mx-1 h-5 w-px bg-border" />
              <Button
                variant="ghost"
                size="icon"
                className={controlButtonClass}
                onClick={() => setSettingsOpen(true)}
                title="设置"
              >
                <Settings2 className="size-4" />
              </Button>
            </div>
          </>
        ) : null}
      </div>

      <Sheet open={helperPanelOpen} onOpenChange={setHelperPanelOpen}>
        <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>练习帮助</SheetTitle>
            <SheetDescription>节奏说明、快捷键与练习提示。</SheetDescription>
          </SheetHeader>
          <div
            data-testid="english-course-helper-panel"
            className="mt-4 space-y-3"
          >
            <div className="flex flex-wrap gap-2">
              <SidePanelTabButton
                active={sidePanelTab === 'info'}
                label="信息"
                onClick={() => setSidePanelTab('info')}
              />
              <SidePanelTabButton
                active={sidePanelTab === 'shortcuts'}
                label="快捷键"
                onClick={() => setSidePanelTab('shortcuts')}
              />
              <SidePanelTabButton
                active={sidePanelTab === 'rhythm'}
                label="节奏"
                onClick={() => setSidePanelTab('rhythm')}
              />
            </div>
            <div data-testid="english-course-helper-content" className="space-y-3">
              {sidePanelTab === 'shortcuts' ? (
                <div className="space-y-3">
                  <ShortcutSummary settings={practiceSettings} />
                  <div className="rounded-2xl border border-info/20 bg-info/5 px-4 py-3 text-sm text-info">
                    点击设置可以重新录制快捷键。默认使用带修饰键组合，避免和拼写输入冲突。
                  </div>
                </div>
              ) : sidePanelTab === 'rhythm' ? (
                <div className="space-y-2 text-sm leading-6 text-muted-foreground">
                  <p>默认节奏是「听一句停一句」，本句完整显示后会自动连播「本句 + 下一句」。</p>
                  <p>视频可随时收起，把屏幕留给拼写。</p>
                </div>
              ) : (
                <div className="space-y-2 text-sm leading-6 text-muted-foreground">
                  <p>输入时翻译区默认保留上一句译文；本句完整显示后会立即切到本句译文。</p>
                  <p>如果最终校验和本地显示不一致，系统会回退到该句重新拼写。</p>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <EnglishPracticeSettingsDialog
        open={settingsOpen}
        settings={practiceSettings}
        onOpenChange={setSettingsOpen}
        onSave={handleSavePracticeSettings}
      />

      <EnglishDictionaryFloat
        dictionaryPanel={dictionary.dictionaryPanel}
        dictionaryPanelRef={dictionary.dictionaryPanelRef}
        onClose={() => dictionary.setDictionaryPanel(null)}
        onHeaderPointerDown={dictionary.handleDictionaryHeaderPointerDown}
        onHeaderMouseDown={dictionary.handleDictionaryHeaderMouseDown}
        onTogglePin={dictionary.handleToggleDictionaryPin}
        playDictionaryPronunciation={dictionary.playDictionaryPronunciation}
      />
    </div>
  )
}
