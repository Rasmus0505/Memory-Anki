import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAiRunConfigDialog } from '@/features/ai-config/useAiRunConfigDialog'
import { PalaceQuizGenerationPanel } from '@/features/palace-quiz/components/PalaceQuizGenerationPanel'
import { PalaceQuizManagePanel } from '@/features/palace-quiz/components/PalaceQuizManagePanel'
import { PalaceQuizPracticePanel } from '@/features/palace-quiz/components/PalaceQuizPracticePanel'
import { PalaceQuizRangeDialog } from '@/features/palace-quiz/components/PalaceQuizRangeDialog'
import { usePalaceQuizGeneration } from '@/features/palace-quiz/hooks/usePalaceQuizGeneration'
import { usePalaceQuizManagement } from '@/features/palace-quiz/hooks/usePalaceQuizManagement'
import { usePalaceQuizPractice } from '@/features/palace-quiz/hooks/usePalaceQuizPractice'
import { usePalaceQuizQuestionBrowser } from '@/features/palace-quiz/hooks/usePalaceQuizQuestionBrowser'
import { usePalaceQuizResources } from '@/features/palace-quiz/hooks/usePalaceQuizResources'
import { readInitialTab, type PalaceQuizTabKey } from '@/features/palace-quiz/model/palaceQuizPage'
import { useRouteResidency } from '@/app/router/RouteResidency'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'

export default function PalaceQuizPage() {
  const { isActive, becameActiveAt } = useRouteResidency()
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const palaceId = id ? Number(id) : null
  const [activeTab, setActiveTab] = useState<PalaceQuizTabKey>(() => readInitialTab(searchParams))
  const { promptForAiOptions, promptForScenarioAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const { palace, questions, loading, error, setQuestions, refreshQuestions } =
    usePalaceQuizResources(palaceId)
  const miniPalaces = palace?.mini_palaces || []
  const timer = useTimedSession({
    kind: 'quiz',
    title: palace?.title ? `${palace.title} · 配套习题` : '宫殿配套习题',
    palaceId,
    automationScene: 'quiz',
    sourceKind: palaceId != null ? 'palace' : null,
    persistKey: palaceId ? `palace_quiz:${palaceId}` : null,
  })
  useGlobalTimerRegistration({
    scene: 'quiz',
    title: palace?.title ? `${palace.title} · 配套习题` : '宫殿配套习题',
    timer,
    isRouteActive: isActive,
    becameActiveAt,
  })
  const timerRef = useRef(timer)
  const hardUnloadRef = useRef(false)

  const registerQuizActivity = (source: string) => {
    timer.registerActivity('practice_interaction', { source })
  }

  const emitQuizFeedback = (
    event: Parameters<typeof dispatchGlobalFeedback>[0],
    options?: Parameters<typeof dispatchGlobalFeedback>[1],
  ) => {
    dispatchGlobalFeedback(event, options)
  }

  const browser = usePalaceQuizQuestionBrowser({
    questions,
    miniPalaceIds: miniPalaces.map((item) => item.id),
  })
  const practice = usePalaceQuizPractice({
    setQuestions,
    promptForAiOptions,
    registerQuizActivity,
    emitQuizFeedback,
  })
  const management = usePalaceQuizManagement({
    palaceId,
    questions,
    visibleQuestionIds: browser.visibleQuestionIds,
    filteredQuestions: browser.filteredQuestions,
    refreshQuestions,
    removeQuestionStates: practice.removeQuestionStates,
    registerQuizActivity,
    emitQuizFeedback,
  })
  const generation = usePalaceQuizGeneration({
    palaceId,
    palace,
    refreshQuestions,
    promptForAiOptions,
    promptForScenarioAiOptions,
    registerQuizActivity,
    emitQuizFeedback,
  })

  useEffect(() => {
    const nextTab = readInitialTab(searchParams)
    setActiveTab((current) => (current === nextTab ? current : nextTab))
  }, [searchParams])

  useEffect(() => {
    const currentTab = searchParams.get('tab')
    if (currentTab === activeTab) return
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('tab', activeTab)
      return next
    }, { replace: true })
  }, [activeTab, searchParams, setSearchParams])

  useEffect(() => {
    timer.setSceneActive?.(isActive, { source: isActive ? 'route_active' : 'route_inactive' })
  }, [isActive, timer])

  useEffect(() => {
    timerRef.current = timer
  }, [timer])

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
      if (hardUnloadRef.current) return
    }
  }, [])

  useEffect(() => {
    if (!palaceId) return
    if (!isActive) return
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig(), 'quiz')) return
    timer.start({ source: 'page_enter' })
  }, [isActive, palaceId, timer])

  const pageTabs: Array<{ key: PalaceQuizTabKey; label: string }> = [
    { key: 'practice', label: '做题' },
    { key: 'manage', label: '管理' },
    { key: 'generate', label: 'AI生成' },
  ]

  const handleScopeChange = (
    scope: typeof browser.questionScope,
    label: string,
  ) => {
    emitQuizFeedback('quiz_nav_scope_change', { label, audioScope: 'global' })
    browser.setQuestionScope(scope)
  }

  const handleViewModeChange = (viewMode: typeof browser.viewMode, label: string) => {
    registerQuizActivity(viewMode === 'single' ? 'view_mode_single' : 'view_mode_list')
    emitQuizFeedback('quiz_nav_view_switch', { label, audioScope: 'global' })
    browser.setViewMode(viewMode)
  }

  const handleQuestionNavigate = (direction: 'prev' | 'next') => {
    registerQuizActivity(direction === 'prev' ? 'question_prev' : 'question_next')
    emitQuizFeedback(
      direction === 'prev' ? 'quiz_nav_question_prev' : 'quiz_nav_question_next',
      { label: direction === 'prev' ? '上一题' : '下一题', audioScope: 'local' },
    )
    browser.setCurrentQuestionIndex((current) =>
      direction === 'prev'
        ? Math.max(current - 1, 0)
        : Math.min(current + 1, browser.filteredQuestions.length - 1),
    )
  }

  const handleOpenQuestionEditor = (question: (typeof questions)[number]) => {
    const opened = management.handleEditQuestion(question)
    if (opened) {
      setActiveTab('manage')
    }
  }

  const handleSaveGenerationPreview = async () => {
    await generation.handleSaveGenerationPreview()
    setActiveTab('practice')
  }

  if (!palaceId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        宫殿不存在。
      </div>
    )
  }

  return (
    <div
      className="space-y-5"
      onClickCapture={() => registerQuizActivity('page_click')}
      onKeyDownCapture={() => registerQuizActivity('page_keydown')}
      onChangeCapture={() => registerQuizActivity('page_change')}
    >
      {aiRunConfigDialog}
      <PageIntro
        eyebrow="宫殿做题"
        title={palace?.title ? `${palace.title} · 配套习题` : '宫殿配套习题'}
        description="这里把宫殿级题库、手动管理和 AI 预览生成放在一起。选择题即时判题并累计统计，简答题提交后显示参考答案与解析。"
        actions={
          <>
            <Link to="/palaces">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" />
                返回记忆宫殿
              </Button>
            </Link>
            <Badge variant="secondary">{questions.length} 题</Badge>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {pageTabs.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            variant={activeTab === tab.key ? 'default' : 'outline'}
            onClick={() => {
              registerQuizActivity(`tab_${tab.key}`)
              emitQuizFeedback('quiz_nav_tab_switch', { label: tab.label, audioScope: 'global' })
              setActiveTab(tab.key)
            }}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          正在加载题库...
        </div>
      ) : null}

      {!loading && activeTab === 'practice' ? (
        <PalaceQuizPracticePanel
          questions={questions}
          miniPalaces={miniPalaces}
          questionScope={browser.questionScope}
          setQuestionScope={browser.setQuestionScope}
          rootQuestionCount={browser.rootQuestionCount}
          viewMode={browser.viewMode}
          setViewMode={browser.setViewMode}
          filteredQuestions={browser.filteredQuestions}
          currentQuestion={browser.currentQuestion}
          currentQuestionIndex={browser.currentQuestionIndex}
          setCurrentQuestionIndex={browser.setCurrentQuestionIndex}
          questionStates={practice.questionStates}
          onChoiceSelect={practice.handleChoiceSelect}
          onStateChange={practice.updateQuestionState}
          onShortAnswerSubmit={practice.handleShortAnswerSubmit}
          onShortAnswerFeedback={practice.handleShortAnswerFeedback}
          onReset={practice.handleResetQuestionState}
          onEdit={handleOpenQuestionEditor}
          onScopeFeedback={handleScopeChange}
          onViewFeedback={handleViewModeChange}
          onNavigateFeedback={handleQuestionNavigate}
        />
      ) : null}

      {!loading && activeTab === 'manage' ? (
        <PalaceQuizManagePanel
          questions={questions}
          miniPalaces={miniPalaces}
          questionScope={browser.questionScope}
          onScopeChange={handleScopeChange}
          filteredQuestions={browser.filteredQuestions}
          selectedQuestionIds={management.selectedQuestionIds}
          allVisibleQuestionsSelected={management.allVisibleQuestionsSelected}
          manageBulkDeleting={management.manageBulkDeleting}
          manageDeletingId={management.manageDeletingId}
          editingQuestionId={management.editingQuestionId}
          manageSaving={management.manageSaving}
          questionForm={management.questionForm}
          setQuestionForm={management.setQuestionForm}
          onToggleQuestionSelection={management.handleToggleQuestionSelection}
          onToggleSelectAllVisibleQuestions={management.handleToggleSelectAllVisibleQuestions}
          onClearSelection={() => management.setSelectedQuestionIds([])}
          onBatchDeleteQuestions={management.handleBatchDeleteQuestions}
          onStartCreateQuestion={management.handleStartCreateQuestion}
          onEditQuestion={handleOpenQuestionEditor}
          onDeleteQuestion={management.handleDeleteQuestion}
          onSaveQuestion={management.handleSaveQuestion}
          onResetForm={management.resetEditingState}
        />
      ) : null}

      {!loading && activeTab === 'generate' ? (
        <PalaceQuizGenerationPanel
          hasMiniPalaces={miniPalaces.length > 0}
          rootQuestionCount={browser.rootQuestionCount}
          miniPalaces={miniPalaces}
          classificationLoading={generation.classificationLoading}
          classificationResult={generation.classificationResult}
          generationSourceKind={generation.generationSourceKind}
          setGenerationSourceKind={(value) => {
            generation.setGenerationSourceKind(value)
            generation.setGenerationError('')
            if (value === 'image-single') {
              generation.setGenerationFiles((current) => current.slice(0, 1))
            }
          }}
          generationFiles={generation.generationFiles}
          generationPdfSources={generation.generationPdfSources}
          generationEnableSecondaryReview={generation.generationEnableSecondaryReview}
          setGenerationEnableSecondaryReview={generation.setGenerationEnableSecondaryReview}
          generationClassifyByMiniPalace={generation.generationClassifyByMiniPalace}
          setGenerationClassifyByMiniPalace={generation.setGenerationClassifyByMiniPalace}
          generationError={generation.generationError}
          generationLoading={generation.generationLoading}
          generationSaving={generation.generationSaving}
          generationPreview={generation.generationPreview}
          generationHistory={generation.generationHistory}
          historyRegeneratingId={generation.historyRegeneratingId}
          generationStreamStatus={generation.generationStreamStatus}
          generationStreamStepLabel={generation.generationStreamStepLabel}
          generationStreamPreviewText={generation.generationStreamPreviewText}
          selectedChapterSummary={generation.selectedChapterSummary}
          selectedChapterHasChildren={generation.selectedChapterHasChildren}
          subjectsLoading={generation.subjectsLoading}
          subjectOptions={generation.subjectOptions}
          pdfController={generation.pdfController}
          subjectPdfUploadInputRef={generation.subjectPdfUploadInputRef}
          generationStreamContentRef={generation.generationStreamContentRef}
          getGenerationPreviewSaveCount={generation.getGenerationPreviewSaveCount}
          formatResolvedAiSteps={generation.formatResolvedAiSteps}
          onOpenRangeDialog={generation.handleOpenRangeDialog}
          onGeneratePreview={generation.handleGeneratePreview}
          onGenerationStreamScroll={generation.handleGenerationStreamScroll}
          onImageFileChange={generation.handleImageFileChange}
          onUploadSubjectPdf={generation.handleUploadSubjectPdf}
          onAddCurrentPdfSource={generation.handleAddCurrentPdfSource}
          onRemovePdfSource={generation.handleRemovePdfSource}
          onPdfSourceRoleHintChange={generation.handlePdfSourceRoleHintChange}
          onSaveGenerationPreview={handleSaveGenerationPreview}
          onRegenerateFromHistory={generation.handleRegenerateFromHistory}
          onDeleteGenerationHistory={generation.handleDeleteGenerationHistory}
          onApplyHistoryConfig={generation.applyHistoryConfig}
          onClassifyExistingQuestions={generation.handleClassifyExistingQuestions}
        />
      ) : null}

      <PalaceQuizRangeDialog
        open={generation.rangeDialogOpen}
        onOpenChange={generation.setRangeDialogOpen}
        pendingChapterId={generation.pendingChapterId}
        pendingChapterSummary={generation.pendingChapterSummary}
        chapterTreesLoading={generation.chapterTreesLoading}
        chapterTrees={generation.chapterTrees}
        allowedChapterIds={generation.allowedChapterIds}
        onSelect={generation.setPendingChapterId}
        onConfirm={generation.handleConfirmRangeSelection}
      />
    </div>
  )
}
