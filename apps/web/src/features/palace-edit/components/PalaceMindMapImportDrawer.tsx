import {
  ArrowDown,
  ArrowLeft,
  ArrowRightToLine,
  PanelsTopLeft,
  ArrowUp,
  Check,
  Clock,
  Copy,
  FileText,
  ImagePlus,
  LoaderCircle,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react'
import { useEffect, useState, type ChangeEvent, type ClipboardEvent, type ReactNode } from 'react'
import type {
  BatchImportImageItem,
  ImportSourceKind,
  ImportSubjectOption,
  MindMapImportWorkflow,
} from '@/features/palace-edit/hooks/useMindMapImport'
import type { ImportHistoryItem } from '@/features/palace-edit/model/mindmap-import'
import type {
  MindMapImportSourceNode,
  MindMapImportSourceTree,
  PdfImportOptions,
  PdfPageSummary,
  SubjectDocumentSummary,
} from '@/shared/api/contracts'
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

interface PalaceMindMapImportDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'mindmap' | 'text'
  onModeChange: (mode: 'mindmap' | 'text') => void
  sourceKind: ImportSourceKind
  onSourceKindChange: (sourceKind: ImportSourceKind) => void
  onWorkflowChange: (workflow: MindMapImportWorkflow) => void
  loading: boolean
  applying: boolean
  undoing: boolean
  error: string
  sourceTree: MindMapImportSourceTree | null
  extractedText: string
  imagePreviewUrl: string
  batchImages: BatchImportImageItem[]
  structureImageId: string | null
  batchStatus: 'idle' | 'ready' | 'loading' | 'success' | 'error'
  batchMeta: { structureImageIndex: number; imageCount: number } | null
  subjectOptions: ImportSubjectOption[]
  selectedSubjectId: number | null
  onSelectedSubjectIdChange: (subjectId: number | null) => void
  subjectDocuments: SubjectDocumentSummary[]
  subjectDocumentsLoading: boolean
  selectedSubjectDocumentId: number | null
  onSelectedSubjectDocumentIdChange: (documentId: number | null) => void
  pdfPageMeta: PdfPageSummary[]
  pdfPagesLoading: boolean
  selectedPdfPages: number[]
  pdfPageInput: string
  onPdfPageInputChange: (value: string) => void
  pdfSelectionError: string
  structurePage: number | null
  onStructurePageChange: (pageNumber: number | null) => void
  pdfPreviewPage: number | null
  onPdfPreviewPageChange: (pageNumber: number | null) => void
  analyzedPdfPages: number[]
  rangePrompt: string
  onRangePromptChange: (value: string) => void
  pdfImportOptions: PdfImportOptions
  onPdfImportOptionChange: (key: keyof PdfImportOptions, value: boolean) => void
  importWarnings: string[]
  importCanApply: boolean
  importMatchMode: 'strict_match' | 'approximate_match'
  onTogglePdfPage: (pageNumber: number) => void
  onPdfStart: () => void
  targetNodeLabel: string
  canAppend: boolean
  canUndoLastImport: boolean
  history: ImportHistoryItem[]
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onBatchStart: () => void
  onBatchDeleteImage: (id: string) => void
  onBatchMoveImage: (id: string, direction: 'up' | 'down') => void
  onBatchSetStructureImage: (id: string) => void
  onApplyReplace: () => void
  onApplyAppend: () => void
  onUndoLastImport: () => void
  onSelectHistory: (item: ImportHistoryItem) => void
  onDeleteHistory: (id: string) => void
  className?: string
  overlayClassName?: string
}

function SourceTreeNode({
  node,
  depth = 0,
}: {
  node: MindMapImportSourceNode
  depth?: number
}) {
  return (
    <div className="space-y-2">
      <div
        className="rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-sm whitespace-pre-wrap break-words"
        style={{ marginLeft: depth * 14 }}
      >
        {node.rich_text_html ? (
          <div
            className="mindmap-import-richtext whitespace-pre-wrap break-words [&_u]:underline [&_u]:decoration-solid [&_[data-underline-style='wavy']]:underline [&_[data-underline-style='wavy']]:decoration-wavy"
            dangerouslySetInnerHTML={{ __html: node.rich_text_html }}
          />
        ) : (
          node.text
        )}
      </div>
      {node.children?.length ? (
        <div className="space-y-2">
          {node.children.map((child, index) => (
            <SourceTreeNode key={`${child.text}-${index}`} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function PalaceMindMapImportDrawer({
  open,
  onOpenChange,
  mode,
  onModeChange,
  sourceKind,
  onSourceKindChange,
  onWorkflowChange,
  loading,
  applying,
  undoing,
  error,
  sourceTree,
  extractedText,
  imagePreviewUrl,
  batchImages,
  structureImageId,
  batchStatus,
  batchMeta,
  subjectOptions,
  selectedSubjectId,
  onSelectedSubjectIdChange,
  subjectDocuments,
  subjectDocumentsLoading,
  selectedSubjectDocumentId,
  onSelectedSubjectDocumentIdChange,
  pdfPageMeta,
  pdfPagesLoading,
  selectedPdfPages,
  pdfPageInput,
  onPdfPageInputChange,
  pdfSelectionError,
  structurePage,
  onStructurePageChange,
  pdfPreviewPage,
  onPdfPreviewPageChange,
  analyzedPdfPages,
  rangePrompt,
  onRangePromptChange,
  pdfImportOptions,
  onPdfImportOptionChange,
  importWarnings,
  importCanApply,
  importMatchMode,
  onTogglePdfPage,
  onPdfStart,
  targetNodeLabel,
  canAppend,
  canUndoLastImport,
  history,
  onPaste,
  onFileChange,
  onBatchStart,
  onBatchDeleteImage,
  onBatchMoveImage,
  onBatchSetStructureImage,
  onApplyReplace,
  onApplyAppend,
  onUndoLastImport,
  onSelectHistory,
  onDeleteHistory,
  className,
  overlayClassName,
}: PalaceMindMapImportDrawerProps) {
  const nodeCount = sourceTree ? countNodes(sourceTree.children) : 0
  const [view, setView] = useState<'import' | 'history'>('import')
  const [copied, setCopied] = useState(false)
  const [layoutMode, setLayoutMode] = useState<'floating' | 'sidebar'>('floating')

  useEffect(() => {
    if (open) {
      setView('import')
    }
  }, [open])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopyText = async () => {
    if (!extractedText) return
    await navigator.clipboard.writeText(extractedText)
    setCopied(true)
  }

  const selectedDocument = subjectDocuments.find((item) => item.id === selectedSubjectDocumentId) ?? null
  const sourceTitle =
    sourceKind === 'subject-pdf'
      ? mode === 'mindmap'
        ? '学科 PDF 转脑图'
        : '学科 PDF 转文字'
      : mode === 'mindmap'
        ? '图片转脑图'
        : '图片转文字'

  const canStartPdfImport =
    sourceKind === 'subject-pdf' &&
    selectedSubjectDocumentId != null &&
    selectedPdfPages.length > 0 &&
    !pdfSelectionError &&
    (mode === 'text' || structurePage != null)

  const previewPage =
    pdfPageMeta.find((page) => page.page_number === pdfPreviewPage) ??
    pdfPageMeta.find((page) => page.page_number === structurePage) ??
    pdfPageMeta.find((page) => selectedPdfPages.includes(page.page_number)) ??
    pdfPageMeta[0] ??
    null

  const resolvedPreviewImageUrl = sourceKind === 'subject-pdf' ? previewPage?.preview_url || '' : imagePreviewUrl

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false} className={overlayClassName}>
      <DialogContent
        className={cn(
          layoutMode === 'sidebar'
            ? 'ml-auto mr-0 h-[calc(100vh-32px)] max-w-[620px] rounded-none rounded-l-3xl border-l bg-card/98 p-0 shadow-[0_24px_80px_rgba(15,23,42,0.28)]'
            : 'h-[min(92vh,980px)] max-w-[min(92vw,1440px)] rounded-[28px] border bg-card/98 p-0 shadow-[0_24px_80px_rgba(15,23,42,0.28)]',
          'overflow-y-auto overscroll-contain',
          className,
        )}
      >
        <DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {view === 'history' ? (
                  <Button variant="ghost" size="sm" onClick={() => setView('import')}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    返回导入
                  </Button>
                ) : (
                  <>
                    <DialogTitle>{sourceTitle}</DialogTitle>
                    <Badge variant="secondary">Qwen3-VL-Flash</Badge>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-xl border border-border/70 bg-background/70 p-1">
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center rounded-lg px-3 py-1.5 text-sm transition-colors',
                      mode === 'mindmap'
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => onModeChange('mindmap')}
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    转脑图
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center rounded-lg px-3 py-1.5 text-sm transition-colors',
                      mode === 'text'
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => onModeChange('text')}
                  >
                    <Type className="mr-2 h-4 w-4" />
                    转文字
                  </button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLayoutMode((current) => (current === 'floating' ? 'sidebar' : 'floating'))}
                  title={layoutMode === 'floating' ? '切换为右侧边栏' : '切换为中间悬浮窗'}
                >
                  {layoutMode === 'floating' ? (
                    <>
                      <ArrowRightToLine className="mr-2 h-4 w-4" />
                      侧边栏
                    </>
                  ) : (
                    <>
                      <PanelsTopLeft className="mr-2 h-4 w-4" />
                      悬浮窗
                    </>
                  )}
                </Button>
                {mode === 'mindmap' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setView((current) => (current === 'history' ? 'import' : 'history'))}
                  >
                    <Clock className="mr-2 h-4 w-4" />
                    历史记录
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {view === 'history'
                ? '这里集中查看、恢复和删除当前页面实体的导入历史草稿。'
                : sourceKind === 'subject-pdf'
                  ? '选择学科资料库中的 PDF，指定页码范围并补充自然语言提示，只把所选页面交给 AI 识别。'
                  : sourceKind === 'image-batch'
                    ? '先上传结构图和正文图，整理顺序后手动开始识别，再预览合成脑图草稿。'
                    : mode === 'mindmap'
                      ? '粘贴一张结构图，先生成脑图草稿，再决定覆盖当前脑图或追加到选中节点。'
                      : '识别出的文字会一直保留在右侧，方便你回到导图里多次复制。'}
            </p>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col" onPaste={onPaste} tabIndex={0}>
          {view === 'history' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="border-b px-6 py-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4" />
                  导入历史记录
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  共 {history.length} 条。点击一条会回到导入页并载入这份草稿。
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {history.length > 0 ? (
                  <div className="space-y-2">
                    {history.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => {
                              onSelectHistory(item)
                              setView('import')
                            }}
                          >
                            <div className="truncate text-sm font-medium">{item.title || '未命名'}</div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{item.nodeCount} 节点</span>
                              {item.importMode === 'batch' ? <Badge variant="secondary">多图</Badge> : null}
                              {item.importMode === 'pdf' ? <Badge variant="secondary">PDF</Badge> : null}
                              {item.imageCount ? <span>{item.imageCount} 页/图</span> : null}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {new Date(item.createdAt).toLocaleString()}
                            </div>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onDeleteHistory(item.id)}
                            title="删除此记录"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[260px] items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/60 text-sm text-muted-foreground">
                    还没有历史记录。先完成一次识别，历史会自动保存在这里。
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="min-h-0 flex flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div className="shrink-0 border-b px-6 py-4">
                    <div className="grid gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <SourceKindButton
                      active={sourceKind === 'image-single'}
                      onClick={() => {
                        onSourceKindChange('image-single')
                        onWorkflowChange('single')
                      }}
                      icon={<ImagePlus className="h-4 w-4" />}
                      label="单图"
                    />
                    {mode === 'mindmap' ? (
                      <SourceKindButton
                        active={sourceKind === 'image-batch'}
                        onClick={() => {
                          onSourceKindChange('image-batch')
                          onWorkflowChange('batch')
                        }}
                        icon={<Sparkles className="h-4 w-4" />}
                        label="多图"
                      />
                    ) : null}
                    <SourceKindButton
                      active={sourceKind === 'subject-pdf'}
                      onClick={() => onSourceKindChange('subject-pdf')}
                      icon={<FileText className="h-4 w-4" />}
                      label="学科 PDF"
                    />
                  </div>

                  {sourceKind !== 'subject-pdf' ? (
                    <>
                      <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/70 px-4 py-5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                        <ImagePlus className="mr-2 h-4 w-4" />
                        {sourceKind === 'image-batch' ? '批量选择图片或直接在这里粘贴' : '选择图片或直接在这里粘贴'}
                        <input
                          type="file"
                          accept="image/*"
                          multiple={sourceKind === 'image-batch'}
                          className="hidden"
                          onChange={onFileChange}
                        />
                      </label>

                      {sourceKind === 'image-batch' ? (
                        <div className="rounded-2xl border border-border/70 bg-background/60 p-3">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium">图片队列</div>
                              <div className="text-xs text-muted-foreground">
                                默认第 1 张为结构图，你也可以手动切换。删除或排序后需要重新点开始识别。
                              </div>
                            </div>
                            <Button
                              size="sm"
                              onClick={onBatchStart}
                              disabled={batchImages.length === 0 || loading || applying || undoing}
                            >
                              {loading ? '识别中…' : '开始识别'}
                            </Button>
                          </div>

                          {batchImages.length > 0 ? (
                            <div className="max-h-[280px] overflow-y-auto pr-1">
                              <div className="space-y-2">
                                {batchImages.map((item, index) => {
                                  const isStructure = (structureImageId || batchImages[0]?.id || null) === item.id
                                  return (
                                    <div
                                      key={item.id}
                                      className={cn(
                                        'flex items-center gap-3 rounded-2xl border px-3 py-3',
                                        isStructure
                                          ? 'border-foreground/30 bg-foreground/[0.04]'
                                          : 'border-border/70 bg-background/70',
                                      )}
                                    >
                                      <img
                                        src={item.previewUrl}
                                        alt={item.name}
                                        className="h-14 w-14 rounded-xl border border-border/70 bg-white object-cover"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-medium">{item.name || `图片 ${index + 1}`}</div>
                                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                          <span>第 {index + 1} 张</span>
                                          {isStructure ? <Badge variant="secondary">结构图</Badge> : null}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <Button
                                          type="button"
                                          variant={isStructure ? 'default' : 'outline'}
                                          size="sm"
                                          onClick={() => onBatchSetStructureImage(item.id)}
                                          disabled={loading || applying || undoing}
                                        >
                                          {isStructure ? '当前结构图' : '设为结构图'}
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => onBatchMoveImage(item.id, 'up')}
                                          disabled={index === 0 || loading || applying || undoing}
                                          title="上移"
                                        >
                                          <ArrowUp className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => onBatchMoveImage(item.id, 'down')}
                                          disabled={index === batchImages.length - 1 || loading || applying || undoing}
                                          title="下移"
                                        >
                                          <ArrowDown className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => onBatchDeleteImage(item.id)}
                                          disabled={loading || applying || undoing}
                                          title="删除图片"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className="flex h-24 items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/50 text-sm text-muted-foreground">
                              还没有图片，先上传结构图和正文图。
                            </div>
                          )}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="rounded-2xl border border-border/70 bg-background/60 p-3">
                      <div className="grid gap-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="grid gap-1 text-sm">
                            <span className="font-medium">学科</span>
                            <select
                              className="rounded-xl border border-border/70 bg-white px-3 py-2 text-sm"
                              value={selectedSubjectId ?? ''}
                              onChange={(event) =>
                                onSelectedSubjectIdChange(event.target.value ? Number(event.target.value) : null)
                              }
                            >
                              <option value="">请选择学科</option>
                              {subjectOptions.map((subject) => (
                                <option key={subject.id} value={subject.id}>
                                  {subject.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-1 text-sm">
                            <span className="font-medium">PDF 资料</span>
                            <select
                              className="rounded-xl border border-border/70 bg-white px-3 py-2 text-sm"
                              value={selectedSubjectDocumentId ?? ''}
                              onChange={(event) =>
                                onSelectedSubjectDocumentIdChange(event.target.value ? Number(event.target.value) : null)
                              }
                              disabled={!selectedSubjectId || subjectDocumentsLoading}
                            >
                              <option value="">
                                {subjectDocumentsLoading ? '资料加载中…' : subjectDocuments.length > 0 ? '请选择资料' : '暂无 PDF 资料'}
                              </option>
                              {subjectDocuments.map((document) => (
                                <option key={document.id} value={document.id}>
                                  {document.original_name} ({document.page_count} 页)
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
                          <label className="grid gap-1 text-sm">
                            <span className="font-medium">页码范围</span>
                            <input
                              value={pdfPageInput}
                              onChange={(event) => onPdfPageInputChange(event.target.value)}
                              placeholder="例如：1,3-5"
                              className="rounded-xl border border-border/70 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                          {mode === 'mindmap' ? (
                            <label className="grid gap-1 text-sm">
                              <span className="font-medium">结构页</span>
                              <select
                                className="rounded-xl border border-border/70 bg-white px-3 py-2 text-sm"
                                value={structurePage ?? ''}
                                onChange={(event) =>
                                  onStructurePageChange(event.target.value ? Number(event.target.value) : null)
                                }
                                disabled={selectedPdfPages.length === 0}
                              >
                                <option value="">请选择</option>
                                {selectedPdfPages.map((page) => (
                                  <option key={page} value={page}>
                                    第 {page} 页
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                        </div>

                        <label className="grid gap-1 text-sm">
                          <span className="font-medium">自然语言提示</span>
                          <textarea
                            value={rangePrompt}
                            onChange={(event) => onRangePromptChange(event.target.value)}
                            placeholder="例如：第一节 东方文明古国的教育"
                            className="min-h-[84px] rounded-xl border border-border/70 bg-white px-3 py-2 text-sm"
                          />
                        </label>

                        {mode === 'mindmap' ? (
                          <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
                            <div className="mb-2 text-sm font-medium">导入策略</div>
                            <div className="grid gap-2 text-sm">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={pdfImportOptions.strict_restore}
                                  onChange={(event) => onPdfImportOptionChange('strict_restore', event.target.checked)}
                                />
                                <span>严格还原 PDF 自带脑图结构</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={pdfImportOptions.quote_original_text_only}
                                  onChange={(event) => onPdfImportOptionChange('quote_original_text_only', event.target.checked)}
                                />
                                <span>补充内容必须使用原话</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={pdfImportOptions.mount_on_original_leaf_only}
                                  onChange={(event) => onPdfImportOptionChange('mount_on_original_leaf_only', event.target.checked)}
                                />
                                <span>只允许挂到最小原始节点下</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={pdfImportOptions.preserve_emphasis_marks}
                                  onChange={(event) => onPdfImportOptionChange('preserve_emphasis_marks', event.target.checked)}
                                />
                                <span>保留下划线/波浪线</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={pdfImportOptions.semantic_split_long_paragraphs}
                                  onChange={(event) => onPdfImportOptionChange('semantic_split_long_paragraphs', event.target.checked)}
                                />
                                <span>超长段落按语义拆成并列卡片</span>
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={pdfImportOptions.preserve_line_breaks}
                                  onChange={(event) => onPdfImportOptionChange('preserve_line_breaks', event.target.checked)}
                                />
                                <span>默认保留原始分行</span>
                              </label>
                            </div>
                            {pdfImportOptions.strict_restore ? (
                              <div className="mt-2 text-xs text-muted-foreground">
                                严格模式下原结构不会被自动优化；如果只得到近似稿，将只允许预览，不允许覆盖或追加。
                              </div>
                            ) : null}
                            <div className="mt-2 text-xs text-muted-foreground">
                              “语义拆分”适合把教材里过长的自然段拆成多个并列知识卡片；“保留分行”默认开启，避免多行内容被压成一整块。
                            </div>
                          </div>
                        ) : null}

                        {pdfSelectionError ? (
                          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                            {pdfSelectionError}
                          </div>
                        ) : null}

                        {importWarnings.length > 0 ? (
                          <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            <div className="mb-1 font-medium">
                              {importMatchMode === 'approximate_match' ? '当前结果是近似草稿' : '导入提示'}
                            </div>
                            <div className="space-y-1">
                              {importWarnings.map((warning, index) => (
                                <div key={`${warning}-${index}`}>{warning}</div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-muted-foreground">
                            {selectedDocument
                              ? `当前资料：${selectedDocument.original_name}，已选 ${selectedPdfPages.length} 页。`
                              : '先选择一份学科 PDF 资料，再指定页码范围。'}
                          </div>
                          <Button size="sm" onClick={onPdfStart} disabled={!canStartPdfImport || loading || applying || undoing}>
                            {loading ? '识别中…' : mode === 'mindmap' ? '开始识别' : '开始提取'}
                          </Button>
                        </div>

                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {loading ? (
                      <>
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        {sourceKind === 'subject-pdf'
                          ? mode === 'mindmap'
                            ? '正在按页码范围识别 PDF，并生成脑图草稿…'
                            : '正在按页码范围提取 PDF 文字…'
                          : sourceKind === 'image-batch'
                            ? '正在综合结构图和正文图片，生成章节脑图草稿…'
                            : mode === 'mindmap'
                              ? '正在识别图片结构并生成脑图草稿…'
                              : '正在提取图片文字…'}
                      </>
                    ) : sourceTree ? (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        已生成草稿，共 {nodeCount} 个节点
                        {sourceKind === 'image-batch' && batchMeta ? `，共使用 ${batchMeta.imageCount} 张图片` : ''}
                        {sourceKind === 'subject-pdf' ? `，共使用 ${selectedPdfPages.length} 页 PDF` : ''}
                        {importMatchMode === 'approximate_match' ? '，当前为近似稿预览' : ''}
                      </>
                    ) : extractedText ? (
                      <>
                        <Type className="h-3.5 w-3.5" />
                        已提取文字，可直接多次复制后回到导图粘贴
                      </>
                    ) : sourceKind === 'subject-pdf' ? (
                      '适合基于学科 PDF 的指定页码范围识别，可搭配自然语言提示聚焦本次内容。'
                    ) : sourceKind === 'image-batch' ? (
                      '适合 1 张章节结构图 + 多张教材正文图，先整理顺序，再手动开始识别。'
                    ) : (
                      '支持教材结构图、手写整理图、打印版脑图截图。'
                    )}
                  </div>

                  {error ? (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {error}
                    </div>
                  ) : null}

                  {sourceKind === 'image-batch' && batchStatus === 'success' && batchMeta ? (
                    <div className="text-xs text-muted-foreground">
                      本次识别使用了 {batchMeta.imageCount} 张图片，结构图为第 {batchMeta.structureImageIndex + 1} 张。
                    </div>
                  ) : null}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 px-6 py-5">
                    <div className="grid gap-5">
                      <section className="space-y-3">
                    <div className="text-sm font-medium">
                      {sourceKind === 'subject-pdf'
                        ? '当前识别页预览'
                        : sourceKind === 'image-batch'
                          ? '结构图预览'
                          : '原图预览'}
                    </div>
                    <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/70">
                      {resolvedPreviewImageUrl ? (
                        <img
                          src={resolvedPreviewImageUrl}
                          alt="待识别内容预览"
                          className="max-h-[340px] w-full object-contain bg-white"
                        />
                      ) : (
                        <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                          {sourceKind === 'subject-pdf'
                            ? '识别完成后，这里会显示当前结构页或识别页预览。'
                            : sourceKind === 'image-batch'
                              ? '识别完成后，这里会显示本次使用的结构图。'
                              : '还没有图片，先粘贴或选择一张图片。'}
                        </div>
                      )}
                    </div>
                      </section>

                      <section className="space-y-3">
                    {mode === 'mindmap' ? (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">结构预览</div>
                          <div className="flex items-center gap-2">
                            {sourceKind === 'image-batch' && batchMeta ? (
                              <Badge variant="secondary">{batchMeta.imageCount} 张图</Badge>
                            ) : null}
                            {sourceKind === 'subject-pdf' && selectedPdfPages.length > 0 ? (
                              <Badge variant="secondary">{selectedPdfPages.length} 页 PDF</Badge>
                            ) : null}
                            {sourceTree?.title ? <Badge variant="outline">{sourceTree.title}</Badge> : null}
                          </div>
                        </div>
                        <div
                          className={cn(
                            'rounded-2xl border border-border/70 bg-background/70 p-3',
                            !sourceTree && 'flex h-[260px] items-center justify-center text-sm text-muted-foreground',
                          )}
                        >
                          {sourceTree ? (
                            <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
                              {sourceTree.children.length > 0 ? (
                                sourceTree.children.map((node, index) => (
                                  <SourceTreeNode key={`${node.text}-${index}`} node={node} />
                                ))
                              ) : (
                                <div className="text-sm text-muted-foreground">识别结果里还没有分支节点。</div>
                              )}
                            </div>
                          ) : sourceKind === 'subject-pdf' ? (
                            '完成 PDF 范围识别后，这里会显示轻量树形预览。'
                          ) : sourceKind === 'image-batch' ? (
                            '点击开始识别后，这里会显示多图合成后的轻量树形预览。'
                          ) : (
                            '识别完成后，这里会显示轻量树形预览。'
                          )}
                        </div>
                        {sourceTree && !importCanApply ? (
                          <div className="text-xs text-amber-700">
                            当前结果仅供预览，不可直接覆盖或追加到正式脑图。
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">文字结果</div>
                          <Button variant="outline" size="sm" onClick={() => void handleCopyText()} disabled={!extractedText}>
                            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                            {copied ? '已复制' : '复制全部'}
                          </Button>
                        </div>
                        <div
                          className={cn(
                            'rounded-2xl border border-border/70 bg-background/70 p-3',
                            !extractedText && 'flex h-[260px] items-center justify-center text-sm text-muted-foreground',
                          )}
                        >
                          {extractedText ? (
                            <textarea
                              value={extractedText}
                              readOnly
                              className="min-h-[320px] w-full resize-y rounded-xl border border-border/70 bg-white px-3 py-3 text-sm leading-6 text-foreground outline-none"
                            />
                          ) : (
                            '识别完成后，这里会保留纯文字结果，你可以反复复制不同片段到导图里。'
                          )}
                        </div>
                      </>
                    )}
                      </section>
                    </div>
                  </div>

                  <div className="shrink-0 border-t px-6 py-4">
                    {mode === 'mindmap' ? (
                      <>
                        <div className="mb-3 text-xs text-muted-foreground">
                          追加目标：{targetNodeLabel || '请先在脑图中选中一个节点'}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Button
                            variant="outline"
                            onClick={onUndoLastImport}
                            disabled={!canUndoLastImport || loading || applying || undoing}
                          >
                            {undoing ? '撤销中…' : '撤销最近一次导入'}
                          </Button>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading || applying || undoing}>
                              关闭窗口
                            </Button>
                            <Button
                              variant="outline"
                              onClick={onApplyAppend}
                              disabled={!sourceTree || !importCanApply || !canAppend || loading || applying || undoing}
                            >
                              {applying ? '应用中…' : '追加到选中节点'}
                            </Button>
                            <Button onClick={onApplyReplace} disabled={!sourceTree || !importCanApply || loading || applying || undoing}>
                              {applying ? '应用中…' : '覆盖当前脑图'}
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">
                          文字会保留在这里，复制后可直接回到脑图里继续编辑，不会自动关闭。
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
                            关闭窗口
                          </Button>
                          <Button variant="outline" onClick={() => void handleCopyText()} disabled={!extractedText}>
                            {copied ? '已复制' : '复制全部'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {sourceKind === 'subject-pdf' ? (
                  <aside
                    className={cn(
                      'shrink-0 border-l bg-background/55',
                      layoutMode === 'sidebar'
                        ? 'hidden w-[300px] lg:flex lg:flex-col'
                        : 'hidden w-[360px] xl:flex xl:flex-col',
                    )}
                  >
                    <div className="border-b px-5 py-4">
                      <div className="text-sm font-medium">PDF 缩略图</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        绿色表示已经分析过。点击卡片可预览，勾选由“已选”控制。
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                      {pdfPagesLoading ? (
                        <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
                          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                          正在加载页面…
                        </div>
                      ) : pdfPageMeta.length > 0 ? (
                        <div className="grid grid-cols-2 gap-3">
                          {pdfPageMeta.map((page) => {
                            const selected = selectedPdfPages.includes(page.page_number)
                            const isStructure = structurePage === page.page_number
                            const isPreview = pdfPreviewPage === page.page_number
                            const analyzed = analyzedPdfPages.includes(page.page_number)
                            return (
                              <button
                                key={page.page_number}
                                type="button"
                                onClick={() => onTogglePdfPage(page.page_number)}
                                className={cn(
                                  'rounded-2xl border p-2 text-left transition-colors',
                                  analyzed
                                    ? 'border-emerald-400/70 bg-emerald-50'
                                    : isPreview
                                      ? 'border-foreground/30 bg-foreground/[0.04]'
                                      : 'border-border/70 bg-white',
                                )}
                              >
                                <div
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onPdfPreviewPageChange(page.page_number)
                                  }}
                                  className="block w-full cursor-pointer"
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      onPdfPreviewPageChange(page.page_number)
                                    }
                                  }}
                                >
                                  <img
                                    src={page.thumbnail_url}
                                    alt={`PDF 第 ${page.page_number} 页`}
                                    className="h-40 w-full rounded-xl border border-border/60 bg-white object-cover"
                                  />
                                </div>
                                <div className="mt-2 flex items-start justify-between gap-2">
                                  <div className="space-y-1 text-xs">
                                    <div>第 {page.page_number} 页</div>
                                    <div className="flex flex-wrap items-center gap-1">
                                      {selected ? <Badge variant="secondary">已选</Badge> : null}
                                      {mode === 'mindmap' && isStructure ? <Badge variant="outline">结构页</Badge> : null}
                                      {analyzed ? <Badge variant="secondary" className="bg-emerald-600 text-white hover:bg-emerald-600">已分析</Badge> : null}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
                          还没有可显示的页面。先选择一份 PDF 资料。
                        </div>
                      )}
                    </div>
                  </aside>
                ) : null}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SourceKindButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
        active
          ? 'border-foreground/20 bg-foreground text-background'
          : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground',
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

function countNodes(nodes: MindMapImportSourceNode[]) {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children || []), 0)
}
