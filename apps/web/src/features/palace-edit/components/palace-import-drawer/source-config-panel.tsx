import {
  ArrowDown,
  ArrowUp,
  Check,
  FileText,
  ImagePlus,
  LoaderCircle,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { PalaceImportSourceConfigModel } from '@/features/palace-edit/components/palace-import-drawer/types'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

interface PalaceImportSourceConfigPanelProps {
  model: PalaceImportSourceConfigModel
}

export function PalaceImportSourceConfigPanel({
  model,
}: PalaceImportSourceConfigPanelProps) {
  const {
    canStartPdfImport,
    hasCurrentJob,
    mode,
    nodeCount,
    normalizedStreamPhase,
    selectedPdfPageCount,
    sourceKind,
    streamStepLabel,
    usageLabel,
    onSourceKindChange,
    onWorkflowChange,
    onFileChange,
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
    pdfPageInput,
    onPdfPageInputChange,
    pdfSelectionError,
    pdfImportMode,
    onPdfImportModeChange,
    structurePage,
    rangePrompt,
    onRangePromptChange,
    pdfImportOptions,
    onPdfImportOptionChange,
    importWarnings,
    loading,
    applying,
    undoing,
    streamStatusMessage,
    currentJobStatus,
    currentJobStage,
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
    onBatchSetStructureImage,
    onPdfStart,
  } = model

  const selectedDocument = subjectDocuments.find((item) => item.id === selectedSubjectDocumentId) ?? null
  const isStructuredPdfMode = pdfImportMode === 'structured_merge'

  return (
    <div className="border-b px-6 py-4">
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
                      {subjectDocumentsLoading
                        ? '资料加载中…'
                        : subjectDocuments.length > 0
                          ? '请选择资料'
                          : '暂无 PDF 资料'}
                    </option>
                    {subjectDocuments.map((document) => (
                      <option key={document.id} value={document.id}>
                        {document.original_name} ({document.page_count} 页)
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">页码范围</span>
                  <input
                    value={pdfPageInput}
                    onChange={(event) => onPdfPageInputChange(event.target.value)}
                    placeholder="例如：1,3-5"
                    className="rounded-xl border border-border/70 bg-white px-3 py-2 text-sm"
                  />
                </label>
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
                  <div className="mb-3 text-sm font-medium">导入模式</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => onPdfImportModeChange('direct_generation')}
                      className={cn(
                        'rounded-2xl border px-3 py-3 text-left transition-colors',
                        !isStructuredPdfMode
                          ? 'border-foreground/30 bg-foreground/[0.04]'
                          : 'border-border/70 bg-white',
                      )}
                    >
                      <div className="text-sm font-medium">按范围直接生成</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        默认模式。会先综合所选页的正文与版面信息，再直接生成完整脑图，更适合 26、27、28
                        这种连续页内容。
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onPdfImportModeChange('structured_merge')}
                      className={cn(
                        'rounded-2xl border px-3 py-3 text-left transition-colors',
                        isStructuredPdfMode
                          ? 'border-foreground/30 bg-foreground/[0.04]'
                          : 'border-border/70 bg-white',
                      )}
                    >
                      <div className="text-sm font-medium">结构页补全模式</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        高级模式。先识别一页结构，再用其他页补全文本内容，适合原 PDF 已有清晰目录骨架时使用。
                      </div>
                    </button>
                  </div>
                  <div className="mb-2 mt-4 text-sm font-medium">导入策略</div>
                  <div className="grid gap-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={pdfImportOptions.quote_original_text_only}
                        onChange={(event) =>
                          onPdfImportOptionChange('quote_original_text_only', event.target.checked)
                        }
                      />
                      <span>补充内容必须使用原话</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={pdfImportOptions.preserve_emphasis_marks}
                        onChange={(event) =>
                          onPdfImportOptionChange('preserve_emphasis_marks', event.target.checked)
                        }
                      />
                      <span>保留下划线/波浪线</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={pdfImportOptions.semantic_split_long_paragraphs}
                        onChange={(event) =>
                          onPdfImportOptionChange('semantic_split_long_paragraphs', event.target.checked)
                        }
                      />
                      <span>超长段落按语义拆成并列卡片</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={pdfImportOptions.preserve_line_breaks}
                        onChange={(event) =>
                          onPdfImportOptionChange('preserve_line_breaks', event.target.checked)
                        }
                      />
                      <span>默认保留原始分行</span>
                    </label>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {isStructuredPdfMode
                      ? '将先识别结构页，再根据正文页补全脑图草稿；“语义拆分”适合把教材里过长的自然段拆成多个并列知识卡片。'
                      : '将直接围绕所选页范围生成脑图草稿；“语义拆分”适合把教材里过长的自然段拆成多个并列知识卡片。'}
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
                  <div className="mb-1 font-medium">导入提示</div>
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
                    ? `当前资料：${selectedDocument.original_name}，已选 ${selectedPdfPageCount} 页${isStructuredPdfMode && structurePage ? `，结构页为第 ${structurePage} 页。` : '。'}`
                    : '先选择一份学科 PDF 资料，再指定页码范围。'}
                </div>
                <Button size="sm" onClick={onPdfStart} disabled={!canStartPdfImport || loading || applying || undoing}>
                  {loading ? '识别中…' : mode === 'mindmap' ? '开始识别' : '开始提取'}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div
          data-testid="mindmap-import-stream-status"
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          {loading ? (
            <>
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              <span>
                {streamStatusMessage ||
                  (sourceKind === 'subject-pdf'
                    ? mode === 'mindmap'
                      ? '正在按页码范围识别 PDF，并生成脑图草稿…'
                      : '正在按页码范围提取 PDF 文字…'
                    : sourceKind === 'image-batch'
                      ? '正在综合结构图和正文图片，生成章节脑图草稿…'
                      : mode === 'mindmap'
                        ? '正在识别图片结构并生成脑图草稿…'
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
              已生成草稿，共 {nodeCount} 个节点
              {sourceKind === 'image-batch' && batchMeta ? `，共使用 ${batchMeta.imageCount} 张图片` : ''}
              {sourceKind === 'subject-pdf' ? `，共使用 ${selectedPdfPageCount} 页 PDF` : ''}
            </>
          ) : extractedText ? (
            <>
              <Type className="h-3.5 w-3.5" />
              已提取文字，可直接多次复制后回到导图粘贴
            </>
          ) : sourceKind === 'subject-pdf' ? (
            isStructuredPdfMode
              ? '适合先指定结构页，再基于 PDF 正文页补全脑图草稿，可搭配自然语言提示聚焦本次内容。'
              : '默认按所选页范围直接生成脑图草稿，会综合全部选中页的正文与版面信息，不只是识别第一页脑图。'
          ) : sourceKind === 'image-batch' ? (
            '适合 1 张章节结构图 + 多张教材正文图，先整理顺序，再手动开始识别。'
          ) : (
            '支持教材结构图、手写整理图、打印版脑图截图。'
          )}
        </div>

        {hasCurrentJob ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {currentJobStatus ? <Badge variant="outline">{currentJobStatus}</Badge> : null}
            {currentJobStage && currentJobStage !== 'completed' ? <Badge variant="secondary">{currentJobStage}</Badge> : null}
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

        {reusedExistingResult && currentJobUsage && currentJobUsage.total === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-700">
            <Check className="h-3.5 w-3.5" />
            当前结果来自历史草稿复用，未重复触发识别。
          </div>
        ) : null}
      </div>
    </div>
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
