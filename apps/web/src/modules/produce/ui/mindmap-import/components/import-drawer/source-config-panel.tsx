import {
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardCopy,
  FileJson,
  FileText,
  ImagePlus,
  LoaderCircle,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { MindMapImportSourceConfigModel } from '@/modules/produce/ui/mindmap-import/components/import-drawer/types'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

interface MindMapImportSourceConfigPanelProps {
  model: MindMapImportSourceConfigModel
}

export function MindMapImportSourceConfigPanel({
  model,
}: MindMapImportSourceConfigPanelProps) {
  const {
    hasCurrentJob,
    mode,
    nodeCount,
    normalizedStreamPhase,
    sourceKind,
    streamStepLabel,
    usageLabel,
    onSourceKindChange,
    onWorkflowChange,
    onFileChange,
    batchImages,
    batchStatus,
    batchMeta,
    loading,
    applying,
    undoing,
    streamStatusMessage,
    currentJobStatus,
    currentJobStage,
    currentJobError,
    currentJobPauseRequested,
    canPauseJob,
    canResumeJob,
    onPauseJob,
    onResumeJob,
    sourceTree,
    extractedText,
    error,
    currentJobUsage,
    reusedExistingResult,
    onBatchStart,
    onBatchDeleteImage,
    onBatchMoveImage,
    pdfDocuments = [],
    selectedPdfDocumentId = '',
    onSelectedPdfDocumentIdChange = () => {},
    pdfPageSelection = '1',
    onPdfPageSelectionChange = () => {},
    pdfLibraryLoading = false,
    pdfOcrCoverage = null,
    onPdfUpload = () => {},
    onPdfDelete = () => {},
    onPdfStart = () => {},
    manualImportText = '',
    onManualImportTextChange = () => {},
    manualImportFileName = '',
    manualImportFormatPrompt = '',
    onManualImportParse = () => {},
    onManualImportFileChange = () => {},
  } = model
  const [promptCopied, setPromptCopied] = useState(false)
  const cachedPages = pdfOcrCoverage?.page_numbers ?? []
  const cachedPagesLabel =
    cachedPages.length === 0
      ? ''
      : cachedPages.length <= 12
        ? cachedPages.join('、')
        : `${cachedPages.slice(0, 12).join('、')}… 共 ${cachedPages.length} 页`
  const isManual = sourceKind === 'manual-json'
  const isPdf = sourceKind === 'pdf-document'
  const isImage = !isManual && !isPdf

  const handleCopyFormatPrompt = async () => {
    if (!manualImportFormatPrompt) return
    await navigator.clipboard.writeText(manualImportFormatPrompt)
    setPromptCopied(true)
    window.setTimeout(() => setPromptCopied(false), 1400)
  }

  return (
    <div className="border-b px-6 py-4">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <SourceKindButton
            active={isImage}
            onClick={() => {
              onSourceKindChange('image-batch')
              onWorkflowChange('batch')
            }}
            icon={<ImagePlus className="size-4" />}
            label="图片"
          />
          <SourceKindButton
            active={isPdf}
            onClick={() => onSourceKindChange('pdf-document')}
            icon={<FileText className="size-4" />}
            label="PDF"
          />
          {mode === 'mindmap' ? (
            <SourceKindButton
              active={isManual}
              onClick={() => onSourceKindChange('manual-json')}
              icon={<FileJson className="size-4" />}
              label="手动"
            />
          ) : null}
        </div>

        {isImage ? (
          <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-border/80 bg-background/70 px-4 py-5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ImagePlus className="mr-2 size-4" />
            选择一张或多张图片，或直接在这里粘贴
            <input type="file" accept="image/*" multiple className="hidden" onChange={onFileChange} />
          </label>
        ) : isManual ? (
          <div className="space-y-3 rounded-lg border border-border/70 bg-background/60 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">手动导入脑图</div>
                <div className="text-xs text-muted-foreground">
                  不走 AI 识别。可粘贴 JSON / 缩进大纲，或导入 .json / .txt / .md 文件，解析后应用为宫殿结构。
                </div>
              </div>
              <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm hover:bg-secondary">
                <FileJson className="mr-2 size-4" />
                选择文件
                <input
                  type="file"
                  accept=".json,.txt,.md,.markdown,application/json,text/plain,text/markdown"
                  className="hidden"
                  onChange={onManualImportFileChange}
                />
              </label>
            </div>

            {manualImportFileName ? (
              <div className="text-xs text-muted-foreground">
                当前文件：<span className="font-medium text-foreground">{manualImportFileName}</span>
              </div>
            ) : null}

            <div className="space-y-2 rounded-md border border-dashed border-border/70 bg-muted/15 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">格式整理提示词</div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopyFormatPrompt()}
                  disabled={!manualImportFormatPrompt}
                >
                  <ClipboardCopy className="mr-2 size-4" />
                  {promptCopied ? '已复制' : '复制提示词'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                若从外部复制的节点/JSON 格式有误，可复制此提示词到 ChatGPT 等工具，把内容整理成可导入 JSON 后再粘贴回来。
              </p>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-background/80 p-2 text-[11px] leading-relaxed text-muted-foreground">
                {manualImportFormatPrompt || '提示词加载中…'}
              </pre>
            </div>

            <label className="grid gap-1 text-sm">
              <span>粘贴 JSON 或大纲文本</span>
              <textarea
                className="min-h-[160px] rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
                value={manualImportText}
                onChange={(event) => onManualImportTextChange(event.target.value)}
                placeholder={`{\n  "title": "根节点标题",\n  "children": [\n    { "text": "节点文字", "children": [] }\n  ]\n}`}
                spellCheck={false}
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={onManualImportParse}
                disabled={!manualImportText.trim() || loading || applying || undoing}
              >
                解析为脑图草稿
              </Button>
              <span className="text-xs text-muted-foreground">
                支持：source-tree JSON、Memory Anki 导出 JSON、编辑器文档 JSON、Markdown/缩进大纲
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border border-border/70 bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">PDF 资料库</div>
                <div className="text-xs text-muted-foreground">上传后会持久化保存，可在不同宫殿中重复使用。</div>
              </div>
              <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm hover:bg-secondary">
                <FileText className="mr-2 size-4" />上传 PDF
                <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={onPdfUpload} />
              </label>
            </div>
            {pdfDocuments.length > 0 ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <select
                    className="min-h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                    value={selectedPdfDocumentId}
                    onChange={(event) => onSelectedPdfDocumentIdChange(event.target.value)}
                    aria-label="选择 PDF 资料"
                  >
                    {pdfDocuments.map((document) => (
                      <option key={document.id} value={document.id}>
                        {document.original_name}（{document.page_count} 页）
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="删除 PDF"
                    disabled={!selectedPdfDocumentId || loading}
                    onClick={() => onPdfDelete(selectedPdfDocumentId)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="grid flex-1 gap-1 text-sm">
                    <span>识别页码</span>
                    <input
                      className="min-h-10 rounded-md border bg-background px-3"
                      value={pdfPageSelection}
                      onChange={(event) => onPdfPageSelectionChange(event.target.value)}
                      placeholder="例如 1-5,8,10-12"
                    />
                  </label>
                  <Button onClick={onPdfStart} disabled={!selectedPdfDocumentId || !pdfPageSelection.trim() || loading}>
                    {loading ? '识别中…' : mode === 'mindmap' ? '开始转脑图' : '开始转文字'}
                  </Button>
                </div>
                {cachedPages.length > 0 ? (
                  <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">已缓存 OCR 页：</span>
                    {cachedPagesLabel}
                    <span className="mt-1 block">
                      再次识别这些页时会优先复用本地结果，无需重复调用模型。
                    </span>
                  </div>
                ) : selectedPdfDocumentId ? (
                  <div className="text-xs text-muted-foreground">
                    尚无本 PDF 的跨任务 OCR 缓存；首次识别成功后会自动保存页级结果。
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                {pdfLibraryLoading ? '正在加载 PDF 资料库…' : '还没有 PDF，先上传一份资料。'}
              </div>
            )}
          </div>
        )}

        {isImage ? (
          <div className="rounded-lg border border-border/70 bg-background/60 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">图片队列</div>
                <div className="text-xs text-muted-foreground">
                  先识别全部上传页文字，再按范围整理为脑图。删除或排序后需要重新点开始识别。
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
                  {batchImages.map((item, index) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-3"
                      >
                        <img
                          src={item.previewUrl}
                          alt={item.name || `导入图片 ${index + 1}`}
                          loading="lazy"
                          className="h-14 w-14 rounded-xl border border-border/70 bg-white object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{item.name || `图片 ${index + 1}`}</div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <span>第 {index + 1} 张</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="min-h-11 min-w-11 sm:size-9 sm:min-h-9 sm:min-w-9"
                            onClick={() => onBatchMoveImage(item.id, 'up')}
                            disabled={index === 0 || loading || applying || undoing}
                            title="上移"
                          >
                            <ArrowUp className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="min-h-11 min-w-11 sm:size-9 sm:min-h-9 sm:min-w-9"
                            onClick={() => onBatchMoveImage(item.id, 'down')}
                            disabled={index === batchImages.length - 1 || loading || applying || undoing}
                            title="下移"
                          >
                            <ArrowDown className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="min-h-11 min-w-11 sm:size-9 sm:min-h-9 sm:min-w-9"
                            onClick={() => onBatchDeleteImage(item.id)}
                            disabled={loading || applying || undoing}
                            title="删除图片"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border/80 bg-background/50 text-sm text-muted-foreground">
                还没有图片，先上传要识别的图片。
              </div>
            )}
          </div>
        ) : null}

        <div
          data-testid="mindmap-import-stream-status"
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          {loading ? (
            <>
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              <span>
                {streamStatusMessage ||
                  (sourceKind === 'image-batch'
                      ? '正在识别全部上传页文字并整理脑图…'
                      : mode === 'mindmap'
                        ? '正在识别页面文字并整理脑图…'
                        : '正在提取图片文字…')}
              </span>
              {streamStepLabel ? <Badge variant="outline">{streamStepLabel}</Badge> : null}
              {normalizedStreamPhase ? (
                <Badge variant="secondary" className="font-mono text-[11px]">
                  {normalizedStreamPhase}
                </Badge>
              ) : null}
            </>
          ) : sourceTree ? (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              已生成草稿，共 {nodeCount} 个知识点
              {sourceKind === 'image-batch' && batchMeta ? `，共使用 ${batchMeta.imageCount} 张图片` : ''}
              {isManual ? '（手动导入，未调用 AI）' : ''}
            </>
          ) : extractedText ? (
            <>
              <Type className="h-3.5 w-3.5" />
              已提取文字，可直接多次复制后回到导图粘贴
            </>
          ) : isManual ? (
            '粘贴或导入 JSON/大纲后，点击「解析为脑图草稿」，再覆盖或追加到宫殿。'
          ) : sourceKind === 'image-batch' ? (
            '适合多张教材图：先识别全部文字，再整理为脑图。'
          ) : (
            '支持教材页截图、手写整理图、打印版资料图。'
          )}
        </div>

        {hasCurrentJob ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {currentJobStatus ? (
              <Badge variant="outline">{JOB_STATUS_LABELS[currentJobStatus] ?? currentJobStatus}</Badge>
            ) : null}
            {currentJobStage && currentJobStage !== 'completed' ? (
              <Badge variant="secondary">{STAGE_LABELS[currentJobStage] ?? currentJobStage}</Badge>
            ) : null}
            {usageLabel ? <span>{usageLabel}</span> : null}
            {canPauseJob ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onPauseJob}
                disabled={currentJobPauseRequested || applying || undoing}
              >
                {currentJobPauseRequested ? '正在暂停…' : '暂停识别'}
              </Button>
            ) : null}
            {canResumeJob ? (
              <Button size="sm" variant="outline" onClick={onResumeJob} disabled={loading || applying || undoing}>
                继续识别
              </Button>
            ) : null}
          </div>
        ) : null}

        {currentJobError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <div className="font-medium text-destructive">
              识别失败（阶段：{STAGE_LABELS[currentJobError.stage] ?? currentJobError.stage}）
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{currentJobError.code}</Badge>
              <span>{currentJobError.retryable ? '可继续识别' : '需要调整后重试'}</span>
              {currentJobError.request_id ? <span>请求 ID：{currentJobError.request_id}</span> : null}
            </div>
            <p className="mt-2 text-destructive">{currentJobError.message}</p>
            {currentJobError.raw_snippet ? (
              <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-background/70 p-2 text-xs text-muted-foreground">
                {currentJobError.raw_snippet}
              </pre>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              已完成 {currentJobUsage?.total ?? 0} 次 AI 调用（识别 {currentJobUsage?.ocr ?? currentJobUsage?.text ?? 0} / 整理{' '}
              {currentJobUsage?.merge ?? 0}），继续识别只会重跑失败的阶段。
            </p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {sourceKind === 'image-batch' && batchStatus === 'success' && batchMeta ? (
          <div className="text-xs text-muted-foreground">
            本次识别使用了 {batchMeta.imageCount} 张图片，已按「识别全文 → 整理 JSON」处理。
          </div>
        ) : null}

        {reusedExistingResult && currentJobUsage && currentJobUsage.total === 0 ? (
          <div className="flex items-center gap-2 text-xs text-success">
            <Check className="h-3.5 w-3.5" />
            当前结果来自历史草稿复用，未重复触发识别。
          </div>
        ) : null}
      </div>
    </div>
  )
}

const JOB_STATUS_LABELS = {
  draft: '待识别',
  running: '识别中',
  paused: '已暂停',
  completed: '已完成',
  failed: '识别失败',
  interrupted: '已中断',
} as const

const STAGE_LABELS = {
  prepared: '准备',
  structure: '结构识别',
  ocr: '文字识别',
  merge: '合并',
  text: '文本提取',
  completed: '完成',
} as const

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
        'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
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
