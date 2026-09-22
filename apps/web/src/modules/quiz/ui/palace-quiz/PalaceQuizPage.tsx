import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import { PalaceQuizManagePanel } from '@/modules/quiz/ui/palace-quiz/components/PalaceQuizManagePanel'
import {
  PalaceMemoryLookupDialog,
  collectMemoryLookupFocusNodeUids,
  pickMemoryLookupBinding,
  resolveMemoryLookupPalaceId,
} from '@/widgets/palace-memory-lookup'
import {
  QuizKnowledgeDigressionDialog,
  QuizKnowledgeEdgePicker,
} from '@/widgets/quiz-knowledge-digression'
import { PalaceQuizPracticePanel } from '@/modules/quiz/ui/palace-quiz/components/PalaceQuizPracticePanel'
import {
  listQuestionNodeBindingsApi,
  resetPalaceQuizQuestionAttemptsApi,
} from '@/modules/quiz/domain/quiz-entity/api'
import {
  beginQuizQuestionMarkRequest,
  isCurrentQuizQuestionMarkRequest,
  submitQuizQuestionMark,
} from '@/modules/quiz/domain/quiz-entity'
import type { PalaceQuizQuestion, QuizNodeBindingEdge } from '@/shared/api/contracts'
import { usePalaceQuizManagement } from '@/modules/quiz/ui/palace-quiz/hooks/usePalaceQuizManagement'
import { usePalaceQuizPractice } from '@/modules/quiz/ui/palace-quiz/hooks/usePalaceQuizPractice'
import { usePalaceQuizQuestionBrowser } from '@/modules/quiz/ui/palace-quiz/hooks/usePalaceQuizQuestionBrowser'
import { usePalaceQuizResources } from '@/modules/quiz/ui/palace-quiz/hooks/usePalaceQuizResources'
import { readInitialTab, type PalaceQuizTabKey } from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { toast } from '@/shared/feedback/toast'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'
import { useLiveStudySurfaceMirror } from '@/modules/session/public'
import {
  applyPalaceQuizLiveView,
  decodePalaceQuizLiveView,
  palaceQuizSameInteraction,
  type PalaceQuizLiveView,
} from '@/modules/quiz/ui/palace-quiz/model/palaceQuizLiveView'

export default function PalaceQuizPage() {
  const { isActive, becameActiveAt, fullPath } = useRouteResidency()
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const parsedPalaceId = id ? Number(id) : null
  const palaceId =
    parsedPalaceId != null && Number.isFinite(parsedPalaceId) && parsedPalaceId > 0
      ? parsedPalaceId
      : null
  const [activeTab, setActiveTab] = useState<PalaceQuizTabKey>(() => readInitialTab(searchParams))
  const [memoryLookupOpen, setMemoryLookupOpen] = useState(false)
  const [lookupFocusNodeUids, setLookupFocusNodeUids] = useState<string[]>([])
  const [lookupPalaceIdOverride, setLookupPalaceIdOverride] = useState<number | null>(null)
  const [resetAttemptsDialogOpen, setResetAttemptsDialogOpen] = useState(false)
  const [resetAttemptsLoading, setResetAttemptsLoading] = useState(false)
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false)
  const [knowledgePickerEdges, setKnowledgePickerEdges] = useState<QuizNodeBindingEdge[]>([])
  const [knowledgeDigressionOpen, setKnowledgeDigressionOpen] = useState(false)
  const [knowledgeDigressionEdge, setKnowledgeDigressionEdge] = useState<QuizNodeBindingEdge | null>(
    null,
  )
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const { palace, questions, loading, error, setQuestions, refreshQuestions } =
    usePalaceQuizResources(palaceId)
  const miniPalaces = palace?.segments || []
  const timer = useTimedSession({
    sessionKey:
      palaceId != null && Number.isFinite(palaceId)
        ? `palace:${palaceId}`
        : `palace:pending:${id ?? 'none'}`,
    kind: 'quiz',
    title: palace?.title ? `${palace.title} · 配套习题` : '宫殿配套习题',
    palaceId,
    automationScene: 'quiz',
    sourceKind: palaceId != null ? 'palace' : null,
    persistKey: palaceId ? `palace_quiz:${palaceId}` : null,
    persistCompletionRecord: false,
  })
  useGlobalTimerRegistration({
    scene: 'quiz',
    title: palace?.title ? `${palace.title} · 配套习题` : '宫殿配套习题',
    timer,
    isRouteActive: isActive,
    becameActiveAt,
    routePath: fullPath,
  })
  const timerRef = useRef(timer)
  const hardUnloadRef = useRef(false)

  // Child quiz hooks retain this callback for API compatibility; timer state is
  // now driven only by explicit start/pause/resume and system visibility events.
  const registerQuizActivity = useCallback((_source: string) => undefined, [])

  const emitQuizFeedback = (
    event: Parameters<typeof dispatchGlobalFeedback>[0],
    options?: Parameters<typeof dispatchGlobalFeedback>[1],
  ) => {
    dispatchGlobalFeedback(event, options)
  }

  const browser = usePalaceQuizQuestionBrowser({
    questions,
    segmentIds: miniPalaces.map((item) => item.id),
  })
  const practice = usePalaceQuizPractice({
    palaceId,
    setQuestions,
    promptForAiOptions,
    registerQuizActivity,
    emitQuizFeedback,
  })
  const management = usePalaceQuizManagement({
    palaceId,
    questions,
    visibleQuestionIds: browser.visibleQuestionIds,
    refreshQuestions,
    removeQuestionStates: practice.removeQuestionStates,
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
    if (!palaceId || !palace) return
    if (!isActive) return
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig())) return
    timer.start({ source: 'page_enter' })
  }, [isActive, palace, palaceId, timer])

  useEffect(() => {
    const currentQuestion = browser.currentQuestion
    if (!memoryLookupOpen || !currentQuestion) {
      if (!memoryLookupOpen) {
        setLookupFocusNodeUids([])
        setLookupPalaceIdOverride(null)
      }
      return
    }
    const fallbackPalaceId = currentQuestion.palace_id ?? palaceId
    let cancelled = false
    void listQuestionNodeBindingsApi(currentQuestion.id)
      .then((response) => {
        if (cancelled) return
        const items = response.items || []
        const binding = pickMemoryLookupBinding(items, fallbackPalaceId)
        setLookupFocusNodeUids(collectMemoryLookupFocusNodeUids(items, fallbackPalaceId))
        setLookupPalaceIdOverride(resolveMemoryLookupPalaceId(binding, fallbackPalaceId))
      })
      .catch(() => {
        if (cancelled) return
        setLookupFocusNodeUids([])
        setLookupPalaceIdOverride(fallbackPalaceId)
      })
    return () => {
      cancelled = true
    }
  }, [browser.currentQuestion, memoryLookupOpen, palaceId])

  const lookupPalaceId = lookupPalaceIdOverride ?? palaceId

  const quizLiveView = useMemo<PalaceQuizLiveView>(() => ({
    palaceId,
    tab: activeTab,
    viewMode: browser.viewMode,
    questionId: browser.currentQuestion?.id ?? null,
    questionIndex: browser.currentQuestionIndex,
    questionState: browser.currentQuestion
      ? {
          questionId: browser.currentQuestion.id,
          state: practice.questionStates[browser.currentQuestion.id] || {},
        }
      : null,
  }), [
    activeTab,
    browser.currentQuestion,
    browser.currentQuestionIndex,
    browser.viewMode,
    palaceId,
    practice.questionStates,
  ])
  const applyQuizLiveView = useCallback((remote: PalaceQuizLiveView) => {
    const questionIds = browser.filteredQuestions.map((question) => question.id)
    const next = applyPalaceQuizLiveView(
      {
        tab: activeTab,
        viewMode: browser.viewMode,
        questionIndex: browser.currentQuestionIndex,
        questionStates: practice.questionStates,
      },
      remote,
      questionIds,
    )
    if (!next.ready) return false
    setActiveTab(next.tab)
    browser.setViewMode(next.viewMode)
    browser.setCurrentQuestionIndex(next.questionIndex)
    practice.setQuestionStates(next.questionStates)
    return true
  }, [
    activeTab,
    browser,
    practice,
  ])
  useLiveStudySurfaceMirror({
    surface: 'palace_quiz',
    route: fullPath,
    view: quizLiveView,
    decode: decodePalaceQuizLiveView,
    apply: applyQuizLiveView,
    sameInteraction: palaceQuizSameInteraction,
    isActive,
    publishWhen: browser.filteredQuestions.length > 0,
  })

  const pageTabs: Array<{ key: PalaceQuizTabKey; label: string }> = [
    { key: 'practice', label: '做题' },
    { key: 'manage', label: '管理' },
  ]

  const handleScopeChange = (
    scope: typeof browser.questionScope,
    label: string,
  ) => {
    emitQuizFeedback('quiz_nav_scope_change', { label, audioScope: 'global' })
    browser.setQuestionScope(scope)
  }

  const handleViewModeChange = (viewMode: typeof browser.viewMode, label: string) => {
    emitQuizFeedback('quiz_nav_view_switch', { label, audioScope: 'global' })
    browser.setViewMode(viewMode)
  }

  const handleQuestionNavigate = (direction: 'prev' | 'next') => {
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

  const handleToggleMark = async (question: (typeof questions)[number], marked: boolean) => {
    const token = beginQuizQuestionMarkRequest(question.id)
    try {
      const { question: updated } = await submitQuizQuestionMark({
        questionId: question.id,
        marked,
      })
      if (!isCurrentQuizQuestionMarkRequest(question.id, token)) return
      setQuestions((current) =>
        current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
      )
    } catch (error) {
      if (!isCurrentQuizQuestionMarkRequest(question.id, token)) return
      toast.error(error instanceof Error ? error.message : '保存标记失败。')
    }
  }

  const handleOpenQuestionEditor = (question: (typeof questions)[number]) => {
    const opened = management.handleEditQuestion(question)
    if (opened) {
      setActiveTab('manage')
    }
  }

  const openKnowledgeEdge = (edge: QuizNodeBindingEdge) => {
    setKnowledgeDigressionEdge(edge)
    setKnowledgeDigressionOpen(true)
  }

  const handleViewKnowledge = async (question: PalaceQuizQuestion) => {
    try {
      const response = await listQuestionNodeBindingsApi(question.id)
      const edges = response.items || []
      if (edges.length === 0) {
        toast.message('该题还没有绑定知识点节点。可在宫殿编辑「题库结合」或手改绑定中关联。')
        return
      }
      if (edges.length === 1) {
        openKnowledgeEdge(edges[0])
        return
      }
      setKnowledgePickerEdges(edges)
      setKnowledgePickerOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载知识点绑定失败。')
    }
  }

  const handleResetVisibleAttempts = async () => {
    const questionIds = browser.filteredQuestions.map((question) => question.id)
    if (questionIds.length === 0) return
    setResetAttemptsLoading(true)
    try {
      const result = await resetPalaceQuizQuestionAttemptsApi(questionIds)
      practice.removeQuestionStates(questionIds)
      await refreshQuestions()
      toast.success(`已清空 ${result.reset_count} 道题的做题进度。`)
      emitQuizFeedback('quiz_answer_reset', { label: '清空进度', audioScope: 'global' })
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '清空做题进度失败。')
      emitQuizFeedback('quiz_error_persist_failed', { label: '清空失败', audioScope: 'global' })
    } finally {
      setResetAttemptsLoading(false)
      setResetAttemptsDialogOpen(false)
    }
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
    >
      {aiRunConfigDialog}
      <ConfirmDialog
        open={resetAttemptsDialogOpen}
        onOpenChange={setResetAttemptsDialogOpen}
        title="清空当前范围进度"
        description="只会清空当前筛选范围内题目的累计答对、答错和作答次数，不会删除题目。"
        tone="danger"
        confirmText={resetAttemptsLoading ? '清空中...' : '清空进度'}
        onConfirm={() => void handleResetVisibleAttempts()}
      />
      {palaceId ? (
        <PalaceMemoryLookupDialog
          open={memoryLookupOpen}
          onOpenChange={setMemoryLookupOpen}
          currentPalaceId={lookupPalaceId}
          followCurrentPalace
          focusNodeUid={lookupFocusNodeUids[0] ?? null}
          focusNodeUids={lookupFocusNodeUids}
        />
      ) : null}
      <QuizKnowledgeEdgePicker
        open={knowledgePickerOpen}
        onOpenChange={setKnowledgePickerOpen}
        edges={knowledgePickerEdges}
        onSelect={openKnowledgeEdge}
      />
      <QuizKnowledgeDigressionDialog
        open={knowledgeDigressionOpen}
        onOpenChange={setKnowledgeDigressionOpen}
        edge={knowledgeDigressionEdge}
      />
      <PageIntro
        eyebrow="宫殿做题"
        title={palace?.title ? `${palace.title} · 配套习题` : '宫殿配套习题'}
        description="这里做宫殿题库练习，也可以手动管理题目。选择题即时判题并累计统计，简答题提交后显示参考答案与解析。"
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMemoryLookupOpen(true)}
            >
              <BookOpen className="size-4" />
              查看记忆宫殿
            </Button>
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
              emitQuizFeedback('quiz_nav_tab_switch', { label: tab.label, audioScope: 'global' })
              setActiveTab(tab.key)
            }}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
          rootQuestionCount={browser.rootQuestionCount}
          viewMode={browser.viewMode}
          filteredQuestions={browser.filteredQuestions}
          currentQuestion={browser.currentQuestion}
          currentQuestionIndex={browser.currentQuestionIndex}
          questionStates={practice.questionStates}
          onChoiceSelect={practice.handleChoiceSelect}
          onStateChange={practice.updateQuestionState}
          onShortAnswerSubmit={practice.handleShortAnswerSubmit}
          onToggleMark={(question, marked) => void handleToggleMark(question, marked)}
          onReset={practice.handleResetQuestionState}
          onResetVisibleAttempts={() => setResetAttemptsDialogOpen(true)}
          onEdit={handleOpenQuestionEditor}
          onScopeFeedback={handleScopeChange}
          onViewFeedback={handleViewModeChange}
          onNavigateFeedback={handleQuestionNavigate}
          resetAttemptsLoading={resetAttemptsLoading}
          onViewKnowledge={(question) => {
            void handleViewKnowledge(question)
          }}
        />
      ) : null}

      {!loading && activeTab === 'manage' ? (
        <PalaceQuizManagePanel
          palaceId={palaceId}
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
    </div>
  )
}
