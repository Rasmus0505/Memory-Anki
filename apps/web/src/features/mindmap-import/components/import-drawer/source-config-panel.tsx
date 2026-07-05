import {
  ArrowDown,
  ArrowUp,
  Check,
  ImagePlus,
  LoaderCircle,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { MindMapImportSourceConfigModel } from '@/features/mindmap-import/components/import-drawer/types'
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
    structureImageId,
    batchStatus,
    batchMeta,
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
  } = model

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
            icon={<ImagePlus className="size-4" />}
            label="单图"
          />
          {mode === 'mindmap' ? (
            <SourceKindButton
              active={sourceKind === 'image-batch'}
              onClick={() => {
                onSourceKindChange('image-batch')
                onWorkflowChange('batch')
              }}
              icon={<Sparkles className="size-4" />}
              label="多图"
            />
          ) : null}
        </div>

        <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-border/80 bg-background/70 px-4 py-5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ImagePlus className="mr-2 size-4" />
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
          <div className="rounded-lg border border-border/70 bg-background/60 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">图片队列</div>
                <div className="text-xs text-muted-foreground">
                  可选指定 1 张结构图走“结构补全”；不指定时会把全部图片按“直接生成”处理。删除或排序后需要重新点开始识别。
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
                    const isStructure = structureImageId === item.id
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border px-3 py-3',
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
                            {isStructure ? '取消结构图' : '设为结构图'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
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
                            onClick={() => onBatchDeleteImage(item.id)}
                            disabled={loading || applying || undoing}
                            title="删除图片"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
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
              已生成草稿，共 {nodeCount} 个知识点
              {sourceKind === 'image-batch' && batchMeta ? `，共使用 ${batchMeta.imageCount} 张图片` : ''}
            </>
          ) : extractedText ? (
            <>
              <Type className="h-3.5 w-3.5" />
              已提取文字，可直接多次复制后回到导图粘贴
            </>
          ) : sourceKind === 'image-batch' ? (
            '适合多张教材图统一转脑图；可选指定 1 张结构图走结构补全，不指定则直接生成。'
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
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {sourceKind === 'image-batch' && batchStatus === 'success' && batchMeta ? (
          <div className="text-xs text-muted-foreground">
            本次识别使用了 {batchMeta.imageCount} 张图片，
            {batchMeta.structureImageIndex != null
              ? `按结构补全处理，结构图为第 ${batchMeta.structureImageIndex + 1} 张。`
              : '按直接生成处理。'}
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
