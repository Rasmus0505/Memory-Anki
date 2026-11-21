import { useCallback, useMemo, useState, type ComponentType } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { PalaceQuizManagePanel } from '@/modules/quiz/ui/palace-quiz/components/PalaceQuizManagePanel'
import {
  PalaceMemoryLookupDialog,
  useQuestionLookupFocus,
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
import { useQuizSessionProgress } from '@/modules/quiz/domain/quiz-entity'
import type { PalaceQuizQuestion, QuizNodeBindingEdge } from '@/shared/api/contracts'
import { usePalaceQuizManagement } from '@/modules/quiz/ui/palace-quiz/hooks/usePalaceQuizManagement'
import { usePalaceQuizQuestionBrowser } from '@/modules/quiz/ui/palace-quiz/hooks/usePalaceQuizQuestionBrowser'
import { usePalaceQuizResources } from '@/modules/quiz/ui/palace-quiz/hooks/usePalaceQuizResources'
import { readInitialTab, type PalaceQuizTabKey } from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { PageHeader } from '@/shared/components/layout/PageHeader'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { toast } from '@/shared/feedback/toast'
import { useLiveStudySurfaceMirror } from '@/modules/session/public'
import {
  decodePalaceQuizLiveView,
  palaceQuizSameInteraction,
  type PalaceQuizLiveView,
} from '@/modules/quiz/ui/palace-quiz/model/palaceQuizLiveView'

export interface PalaceQuizAnswerWindowProps {
  open: boolean
  onClose: () => void
  palaceId: number
  questionIds: readonly number[]
  initialQuestionId?: number
  onQuestionNavigate: (questionId: number) => void
  onQuestionDeleted: (questionId: number) => void
}

const ignoreRemoteView = () => {}

export default function PalaceQuizPage({ AnswerWindow }: { AnswerWindow?: ComponentType<PalaceQuizAnswerWindowProps> }) {
  const { isActive, fullPath } = useRouteResidency()
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [answerLaunch, setAnswerLaunch] = useState<{ questionId?: number } | null>(null)
  const parsedPalaceId = id ? Number(id) : null
  const palaceId =
    parsedPalaceId != null && Number.isFinite(parsedPalaceId) && parsedPalaceId > 0
      ? parsedPalaceId
      : null
  const activeTab = readInitialTab(searchParams)
  const setActiveTab = (tab: PalaceQuizTabKey) => {
    setAnswerLaunch(null)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('tab', tab)
      return next
    }, { replace: true })
  }
  const [resetAttemptsDialogOpen, setResetAttemptsDialogOpen] = useState(false)
  const [resetAttemptsLoading, setResetAttemptsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [memoryLookupOpen, setMemoryLookupOpen] = useState(false)
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false)
  const [knowledgePickerEdges, setKnowledgePickerEdges] = useState<QuizNodeBindingEdge[]>([])
  const [knowledgeDigressionOpen, setKnowledgeDigressionOpen] = useState(false)
  const [knowledgeDigressionEdge, setKnowledgeDigressionEdge] = useState<QuizNodeBindingEdge | null>(null)
  const { palace, questions, loading, error, setQuestions, refreshQuestions } =
    usePalaceQuizResources(palaceId)
  const miniPalaces = palace?.segments || []

  const browser = usePalaceQuizQuestionBrowser({
    questions,
    segmentIds: miniPalaces.map((item) => item.id),
  })
  const quizSession = useQuizSessionProgress()
  const practiceQuestions = browser.filteredQuestions
  const selectQuestion = useCallback(browser.navigateToQuestion, [browser.navigateToQuestion])
  const launchAnswers = useCallback((questionId?: number) => {
    setAnswerLaunch({ questionId })
  }, [])
  const emitQuizFeedback = (
    event: Parameters<typeof dispatchGlobalFeedback>[0],
    options?: Parameters<typeof dispatchGlobalFeedback>[1],
  ) => {
    dispatchGlobalFeedback(event, options)
  }
  const management = usePalaceQuizManagement({
    palaceId,
    questions,
    visibleQuestionIds: browser.visibleQuestionIds,
    refreshQuestions,
    removeQuestionStates: quizSession.removeQuestionStates,
    emitQuizFeedback,
  })
  const { focusNodeUids: lookupFocusNodeUids, palaceIdOverride: lookupPalaceIdOverride, pending: lookupFocusPending } =
    useQuestionLookupFocus(browser.currentQuestion, true, palaceId)

  const lookupPalaceId = lookupPalaceIdOverride ?? palaceId

  const quizLiveView = useMemo<PalaceQuizLiveView>(() => ({
    palaceId,
    tab: activeTab,
    viewMode: 'single',
    questionId: browser.currentQuestion?.id ?? null,
    questionIndex: browser.currentQuestionIndex,
    questionState: browser.currentQuestion
      ? {
          questionId: browser.currentQuestion.id,
          state: quizSession.questionStates[browser.currentQuestion.id] || {},
        }
      : null,
  }), [
    activeTab,
    browser.currentQuestion,
    browser.currentQuestionIndex,
    palaceId,
    quizSession.questionStates,
  ])
  useLiveStudySurfaceMirror({
    surface: 'palace_quiz',
    route: fullPath,
    view: quizLiveView,
    decode: decodePalaceQuizLiveView,
    apply: ignoreRemoteView,
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

  const handleOpenQuestionEditor = (question: PalaceQuizQuestion) => {
    if (management.handleEditQuestion(question) && activeTab !== 'manage') setActiveTab('manage')
  }

  const openKnowledgeEdge = (edge: QuizNodeBindingEdge) => {
    setKnowledgeDigressionEdge(edge)
    setKnowledgeDigressionOpen(true)
  }

  const handleViewKnowledge = async (question: PalaceQuizQuestion) => {
    selectQuestion(question.id)
    try {
      const { items: edges } = await listQuestionNodeBindingsApi(question.id)
      if (!edges?.length) toast.message('该题还没有绑定知识点。')
      else if (edges.length === 1) openKnowledgeEdge(edges[0])
      else {
        setKnowledgePickerEdges(edges)
        setKnowledgePickerOpen(true)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载知识点绑定失败。')
    }
  }

  const handleResetVisibleAttempts = async () => {
    const questionIds = browser.visibleQuestionIds
    if (questionIds.length === 0 || resetAttemptsLoading) return
    setResetAttemptsLoading(true)
    try {
      const result = await resetPalaceQuizQuestionAttemptsApi(questionIds)
      quizSession.removeQuestionStates(questionIds)
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
      {AnswerWindow && answerLaunch && isActive && activeTab === 'practice' && !loading && browser.visibleQuestionIds.length > 0 ? (
        <AnswerWindow
          open
          onClose={() => {
            setAnswerLaunch(null)
            void refreshQuestions().catch(() => toast.error('刷新题库失败。'))
          }}
          palaceId={palaceId}
          questionIds={browser.visibleQuestionIds}
          initialQuestionId={answerLaunch.questionId}
          onQuestionNavigate={selectQuestion}
          onQuestionDeleted={(questionId) => {
            setQuestions((current) => current.filter((question) => question.id !== questionId))
          }}
        />
      ) : null}
      <ConfirmDialog
        open={resetAttemptsDialogOpen}
        onOpenChange={setResetAttemptsDialogOpen}
        title="清空当前范围进度"
        description="只清空筛选范围内的答对、答错和作答次数，不删除题目。"
        tone="danger"
        confirmText={resetAttemptsLoading ? '清空中...' : '清空进度'}
        onConfirm={() => void handleResetVisibleAttempts()}
      />
      {palaceId ? (
        <PalaceMemoryLookupDialog
          key={memoryLookupOpen ? `view-lookup-${browser.currentQuestion?.id ?? 'none'}` : 'view-lookup-closed'}
          open={memoryLookupOpen}
          onOpenChange={setMemoryLookupOpen}
          currentPalaceId={lookupPalaceId}
          followCurrentPalace
          focusNodeUid={lookupFocusNodeUids[0] ?? null}
          focusNodeUids={lookupFocusNodeUids}
          focusPending={lookupFocusPending}
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
      <PageHeader
        title={palace?.title ? `${palace.title} · 配套习题` : '宫殿配套习题'}
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
          onStartPractice={launchAnswers}
          questionScope={browser.questionScope}
          rootQuestionCount={browser.rootQuestionCount}
          filteredQuestions={practiceQuestions}
          search={search}
          onSearchChange={setSearch}
          onViewKnowledge={(question) => void handleViewKnowledge(question)}
          onScopeFeedback={handleScopeChange}
          resetAttemptsLoading={resetAttemptsLoading}
          onResetVisibleAttempts={() => setResetAttemptsDialogOpen(true)}
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
          onQuestionUpdated={(question) =>
            setQuestions((current) =>
              current.map((item) => (item.id === question.id ? question : item)),
            )
          }
          onImported={(items) => {
            quizSession.removeQuestionStates(items.map((item) => item.id))
            void refreshQuestions()
          }}
        />
      ) : null}
    </div>
  )
}
