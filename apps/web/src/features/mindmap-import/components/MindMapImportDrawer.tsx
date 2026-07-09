import {
  ArrowLeft,
  ArrowRightToLine,
  Clock,
  PanelsTopLeft,
  Sparkles,
  Type,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  MindMapImportFooter,
} from '@/features/mindmap-import/components/import-drawer/footer'
import {
  MindMapImportHistoryView,
} from '@/features/mindmap-import/components/import-drawer/history-view'
import {
  MindMapImportResultsPanel,
} from '@/features/mindmap-import/components/import-drawer/results-panel'
import {
  MindMapImportSourceConfigPanel,
} from '@/features/mindmap-import/components/import-drawer/source-config-panel'
import { countSourceTreeNodes } from '@/features/mindmap-import/components/import-drawer/source-tree'
import type {
  MindMapImportFooterModel,
  MindMapImportHistoryViewModel,
  MindMapImportResultsModel,
  MindMapImportSourceConfigModel,
  MindMapImportDrawerProps,
} from '@/features/mindmap-import/components/import-drawer/types'
import {
  normalizePreviewConfig,
  normalizePreviewEditorDoc,
} from '@/shared/lib/mindmapPreview'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { cn } from '@/shared/lib/utils'
import { requestOpenAiLogDetail } from '@/shared/logs/model/appLogs'

export function MindMapImportDrawer(props: MindMapImportDrawerProps) {
  const {
    open,
    onOpenChange,
    mode,
    onModeChange,
    sourceKind,
    previewEditorDoc,
    extractedText,
    imagePreviewUrl,
    streamPhase,
    streamStatusMessage,
    streamStep,
    streamTotalSteps,
    streamPreviewText,
    loading,
    sourceTree,
    currentJobId,
    currentJobUsage,
    currentJobResolvedAi,
    reusedExistingResult,
    className,
    overlayClassName,
  } = props

  const [view, setView] = useState<'import' | 'history'>('import')
  const [copied, setCopied] = useState(false)
  const [layoutMode, setLayoutMode] = useState<'floating' | 'sidebar'>('floating')
  const [previewFrameVersion, setPreviewFrameVersion] = useState(0)
  const previewSectionRef = useRef<HTMLElement | null>(null)
  const streamPreviewContentRef = useRef<HTMLPreElement | null>(null)
  const lastAutoScrollKeyRef = useRef('')
  const shouldAutoFollowStreamRef = useRef(true)

  const nodeCount = sourceTree ? countSourceTreeNodes(sourceTree.children) : 0
  const hasPreviewEditorDoc = Boolean(previewEditorDoc)
  const previewMindMapState = hasPreviewEditorDoc
    ? ({
        editor_doc: normalizePreviewEditorDoc(previewEditorDoc),
        editor_config: {
          ...normalizePreviewConfig(null),
          layout: 'mindMap',
        },
        editor_local_config: {},
        lang: 'zh',
      } satisfies MindMapEditorState)
    : null
  const rawModelPreviewText = streamPreviewText.trim()
  const hasCurrentJob = Boolean(currentJobId)
  const hasStreamProgress = Boolean(streamStatusMessage)
  const streamStepLabel =
    streamStep != null && streamTotalSteps != null ? `第 ${streamStep}/${streamTotalSteps} 步` : ''
  const normalizedStreamPhase = streamPhase ? streamPhase.replaceAll('_', ' ') : ''
  const usageLabel =
    currentJobUsage && currentJobUsage.total > 0
      ? `本次累计识别调用 ${currentJobUsage.total} 次`
      : reusedExistingResult
        ? '已复用已有草稿，未重复识别'
        : ''
  const resolvedPreviewImageUrl = imagePreviewUrl
  const sourceTitle = mode === 'mindmap' ? '图片转脑图' : '图片转文字'
  const resolvedModelBadgeLabel = currentJobResolvedAi?.model_label || '等待实际调用模型'

  const historyViewModel: MindMapImportHistoryViewModel = {
    history: props.history,
    onDeleteHistory: props.onDeleteHistory,
    onSelectHistory: props.onSelectHistory,
  }
  const sourceConfigModel: MindMapImportSourceConfigModel = {
    applying: props.applying,
    batchImages: props.batchImages,
    batchMeta: props.batchMeta,
    batchStatus: props.batchStatus,
    canPauseJob: props.canPauseJob,
    canResumeJob: props.canResumeJob,
    currentJobPauseRequested: props.currentJobPauseRequested,
    currentJobStage: props.currentJobStage,
    currentJobStatus: props.currentJobStatus,
    currentJobError: props.currentJobError,
    currentJobUsage: props.currentJobUsage,
    error: props.error,
    extractedText: props.extractedText,
    hasCurrentJob,
    loading: props.loading,
    mode: props.mode,
    nodeCount,
    normalizedStreamPhase,
    onBatchDeleteImage: props.onBatchDeleteImage,
    onBatchMoveImage: props.onBatchMoveImage,
    onBatchSetStructureImage: props.onBatchSetStructureImage,
    onBatchStart: props.onBatchStart,
    onFileChange: props.onFileChange,
    onPauseJob: props.onPauseJob,
    onResumeJob: props.onResumeJob,
    onSourceKindChange: props.onSourceKindChange,
    onWorkflowChange: props.onWorkflowChange,
    reusedExistingResult: props.reusedExistingResult,
    sourceKind: props.sourceKind,
    sourceTree: props.sourceTree,
    streamStatusMessage: props.streamStatusMessage,
    streamStepLabel,
    structureImageId: props.structureImageId,
    undoing: props.undoing,
    usageLabel,
  }
  const resultsModel: MindMapImportResultsModel = {
    batchMeta: props.batchMeta,
    extractedText: props.extractedText,
    hasStreamProgress,
    loading: props.loading,
    mode: props.mode,
    onStreamPreviewScroll: handleStreamPreviewScroll,
    previewFrameVersion,
    previewMindMapState,
    previewSectionRef,
    rawModelPreviewText,
    reviewPreview: props.reviewPreview,
    resolvedPreviewImageUrl,
    sourceKind: props.sourceKind,
    sourceTree: props.sourceTree,
    streamPreviewContentRef,
    streamStepLabel,
  }
  const footerModel: MindMapImportFooterModel = {
    applying: props.applying,
    canAppend: props.canAppend,
    canUndoLastImport: props.canUndoLastImport,
    extractedText: props.extractedText,
    loading: props.loading,
    mode: props.mode,
    onApplyAppend: props.onApplyAppend,
    onApplyReplace: props.onApplyReplace,
    onClose: () => onOpenChange(false),
    onUndoLastImport: props.onUndoLastImport,
    sourceTree: props.sourceTree,
    targetNodeLabel: props.targetNodeLabel,
    undoing: props.undoing,
  }
  useEffect(() => {
    if (!open) return
    setView('import')
    shouldAutoFollowStreamRef.current = true
  }, [open])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!open || mode !== 'mindmap' || !hasPreviewEditorDoc) return
    setPreviewFrameVersion((current) => current + 1)
  }, [open, mode, hasPreviewEditorDoc, previewEditorDoc])

  useEffect(() => {
    if (!open || view !== 'import' || loading) return
    const hasResult = mode === 'mindmap' ? Boolean(sourceTree) : Boolean(extractedText)
    if (!hasResult) return
    const autoScrollKey =
      mode === 'mindmap'
        ? `mindmap:${sourceKind}:${sourceTree?.title ?? ''}:${nodeCount}`
        : `text:${sourceKind}:${extractedText.length}`
    if (autoScrollKey === lastAutoScrollKeyRef.current) return
    const timer = window.setTimeout(() => {
      const previewSection = previewSectionRef.current
      if (!previewSection) return
      lastAutoScrollKeyRef.current = autoScrollKey
      previewSection.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, view, loading, mode, sourceKind, sourceTree, extractedText, nodeCount])

  useEffect(() => {
    if (!open || view !== 'import' || mode !== 'mindmap' || !loading || !rawModelPreviewText) return
    const content = streamPreviewContentRef.current
    if (content && shouldAutoFollowStreamRef.current) {
      content.scrollTop = content.scrollHeight
    }
  }, [loading, mode, open, rawModelPreviewText, view])

  function handleStreamPreviewScroll() {
    const content = streamPreviewContentRef.current
    if (!content) return
    const remaining = content.scrollHeight - content.scrollTop - content.clientHeight
    shouldAutoFollowStreamRef.current = remaining <= 32
  }

  const handleCopyText = async () => {
    if (!extractedText) return
    await navigator.clipboard.writeText(extractedText)
    setCopied(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false} className={overlayClassName}>
      <DialogContent
        data-testid="mindmap-import-dialog-content"
        layout={layoutMode === 'sidebar' ? 'unstyled' : 'centered'}
        className={cn(
          layoutMode === 'sidebar'
            ? 'ml-auto mr-0 h-[calc(100vh-32px)] max-w-[620px] rounded-none rounded-l-3xl border-l bg-card/98 p-0 shadow-floating'
            : 'h-[min(92vh,980px)] max-w-[min(92vw,1440px)] rounded-lg border bg-card/98 p-0 shadow-floating',
          'overflow-hidden overscroll-contain',
          className,
        )}
      >
        <DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {view === 'history' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 sm:h-8 sm:min-h-8"
                    onClick={() => setView('import')}
                  >
                    <ArrowLeft className="mr-2 size-4" />
                    返回导入
                  </Button>
                ) : (
                  <>
                    <DialogTitle>{sourceTitle}</DialogTitle>
                    <Badge variant="secondary">{resolvedModelBadgeLabel}</Badge>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-xl border border-border/70 bg-background/70 p-1">
                  <button
                    type="button"
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-lg px-3 py-1.5 text-sm transition-colors sm:min-h-8',
                      mode === 'mindmap'
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => onModeChange('mindmap')}
                  >
                    <Sparkles className="mr-2 size-4" />
                    转脑图
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-lg px-3 py-1.5 text-sm transition-colors sm:min-h-8',
                      mode === 'text'
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => onModeChange('text')}
                  >
                    <Type className="mr-2 size-4" />
                    转文字
                  </button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:h-8 sm:min-h-8"
                  onClick={() => setLayoutMode((current) => (current === 'floating' ? 'sidebar' : 'floating'))}
                  title={layoutMode === 'floating' ? '切换为右侧边栏' : '切换为中间悬浮窗'}
                >
                  {layoutMode === 'floating' ? (
                    <>
                      <ArrowRightToLine className="mr-2 size-4" />
                      侧边栏
                    </>
                  ) : (
                    <>
                      <PanelsTopLeft className="mr-2 size-4" />
                      悬浮窗
                    </>
                  )}
                </Button>
                {mode === 'mindmap' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:h-8 sm:min-h-8"
                    onClick={() => setView((current) => (current === 'history' ? 'import' : 'history'))}
                  >
                    <Clock className="mr-2 size-4" />
                    历史记录
                    </Button>
                  ) : null}
                {currentJobId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:h-8 sm:min-h-8"
                    onClick={() =>
                      requestOpenAiLogDetail({
                        jobId: currentJobId,
                        title: sourceTitle,
                      })
                    }
                  >
                    查看AI详情
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {view === 'history'
                ? '这里集中查看、恢复和删除当前页面实体的导入历史草稿。'
                : sourceKind === 'image-batch'
                    ? '先上传结构图和正文图，整理顺序后手动开始识别，再预览合成脑图草稿。'
                    : mode === 'mindmap'
                      ? '粘贴一张结构图，先生成脑图草稿，再决定覆盖当前脑图或追加到选中知识点。'
                      : '识别出的文字会一直保留在右侧，方便你回到导图里多次复制。'}
            </p>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col" onPaste={props.onPaste} tabIndex={0}>
          {view === 'history' ? (
            <MindMapImportHistoryView model={historyViewModel} onBackToImport={() => setView('import')} />
          ) : (
            <div className="min-h-0 flex flex-1 flex-col xl:flex-row">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div data-testid="mindmap-import-scroll-panel" className="min-h-0 flex-1 overflow-y-auto">
                  <MindMapImportSourceConfigPanel model={sourceConfigModel} />
                  <MindMapImportResultsPanel model={resultsModel} />
                </div>

                <MindMapImportFooter model={footerModel} copied={copied} onCopyText={handleCopyText} />
              </div>

            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
