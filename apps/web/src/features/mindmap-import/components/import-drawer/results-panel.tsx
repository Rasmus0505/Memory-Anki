import type { MindMapImportResultsModel } from '@/features/mindmap-import/components/import-drawer/types'
import { SourceTreeNode } from '@/features/mindmap-import/components/import-drawer/source-tree'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/shared/lib/utils'

interface MindMapImportResultsPanelProps {
  model: MindMapImportResultsModel
}

export function MindMapImportResultsPanel({
  model,
}: MindMapImportResultsPanelProps) {
  const {
    batchMeta,
    extractedText,
    hasStreamProgress,
    loading,
    mode,
    onStreamPreviewScroll,
    previewFrameVersion,
    previewMindMapState,
    previewSectionRef,
    rawModelPreviewText,
    reviewPreview,
    resolvedPreviewImageUrl,
    sourceKind,
    sourceTree,
    streamPreviewContentRef,
    streamStepLabel,
  } = model

  return (
    <div data-testid="mindmap-import-results" className="px-6 py-5">
      <div className="grid gap-5">
        <section ref={previewSectionRef} className="space-y-3">
          <div className="text-sm font-medium">
            {sourceKind === 'image-batch' ? '结构图预览' : '原图预览'}
          </div>
          <div className="overflow-hidden rounded-lg border border-border/70 bg-background/70">
            {resolvedPreviewImageUrl ? (
              <img
                src={resolvedPreviewImageUrl}
                alt="待识别内容预览"
                className="max-h-[340px] w-full object-contain bg-white"
              />
            ) : (
              <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                {sourceKind === 'image-batch'
                  ? '识别完成后，这里会显示本次使用的结构图。'
                  : '还没有图片，先粘贴或选择一张图片。'}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          {mode === 'mindmap' ? (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">实时模型输出</div>
                  {loading && hasStreamProgress ? (
                    <Badge variant="secondary">{streamStepLabel || '识别进行中'}</Badge>
                  ) : null}
                </div>
                <div
                  data-testid="mindmap-import-stream-preview"
                  className={cn(
                    'rounded-lg border border-border/70 bg-background/70 p-3',
                    !rawModelPreviewText && 'flex min-h-[180px] items-center justify-center text-sm text-muted-foreground',
                  )}
                >
                  {rawModelPreviewText ? (
                    <pre
                      ref={streamPreviewContentRef}
                      data-testid="mindmap-import-stream-preview-content"
                      onScroll={onStreamPreviewScroll}
                      className="max-h-[220px] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground"
                    >
                      {rawModelPreviewText}
                    </pre>
                  ) : (
                    '开始识别后，这里会持续显示模型原始输出，方便确认系统仍在处理中。'
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">
                  结构预览
                </div>
                <div className="flex items-center gap-2">
                  {sourceKind === 'image-batch' && batchMeta ? (
                    <Badge variant="secondary">
                      {batchMeta.imageCount} 张图{batchMeta.structureImageIndex != null ? ' / 结构补全' : ' / 直接生成'}
                    </Badge>
                  ) : null}
                  {sourceTree?.title ? <Badge variant="outline">{sourceTree.title}</Badge> : null}
                </div>
              </div>
              {reviewPreview ? (
                <div className="grid gap-2 rounded-lg border border-border/70 bg-background/75 p-3 text-sm md:grid-cols-3">
                  <div>
                    <div className="text-xs text-muted-foreground">知识点</div>
                    <div className="font-semibold text-foreground">{reviewPreview.node_count} 个</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">预计每次复习</div>
                    <div className="font-semibold text-foreground">
                      {reviewPreview.estimated_review_time ||
                        `${Math.max(1, Math.round(reviewPreview.estimated_review_seconds / 60))} 分钟`}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">建议学习组</div>
                    <div className="font-semibold text-foreground">{reviewPreview.suggested_segment_count} 组</div>
                  </div>
                  {reviewPreview.suggested_segments.length > 0 ? (
                    <div className="md:col-span-3">
                      <div className="mb-1 text-xs text-muted-foreground">学习组建议</div>
                      <div className="flex flex-wrap gap-1.5">
                        {reviewPreview.suggested_segments.slice(0, 5).map((segment, index) => (
                          <Badge key={`${segment.title}-${index}`} variant="secondary">
                            {segment.title} · {segment.node_count}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {reviewPreview.warnings.length > 0 ? (
                    <div className="md:col-span-3 text-xs text-warning">
                      {reviewPreview.warnings.join('；')}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div
                className={cn(
                  'rounded-lg border border-border/70 bg-background/70',
                  !sourceTree && 'flex h-[260px] items-center justify-center text-sm text-muted-foreground',
                )}
              >
                {previewMindMapState ? (
                  <div className="h-[360px] overflow-hidden rounded-[inherit]" data-testid="mindmap-import-preview-frame">
                    <MindMapFrame
                      key={`mindmap-import-preview-${previewFrameVersion}`}
                      editorState={previewMindMapState}
                      readonly
                      syncOnPropChange
                      forceSyncKey={`preview:${previewFrameVersion}`}
                      preserveViewOnSync={false}
                      onEditorStateChange={() => {}}
                      className="h-full w-full rounded-[inherit] bg-background"
                    />
                  </div>
                ) : sourceTree ? (
                  <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
                    {sourceTree.children.length > 0 ? (
                      sourceTree.children.map((node, index) => (
                        <SourceTreeNode key={`${node.text}-${index}`} node={node} />
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">识别结果里还没有分支知识点。</div>
                    )}
                  </div>
                ) : sourceKind === 'image-batch' ? (
                  '点击开始识别后，这里会显示多图转脑图结果。'
                ) : (
                  '识别完成后，这里会显示脑图预览。'
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium">文字结果</div>
              <div
                className={cn(
                  'flex min-h-[320px] flex-col rounded-lg border border-border/70 bg-background/70 p-3',
                  !extractedText && 'flex h-[260px] items-center justify-center text-sm text-muted-foreground',
                )}
              >
                {extractedText ? (
                  <textarea
                    value={extractedText}
                    readOnly
                    className="h-full min-h-[320px] w-full flex-1 resize-none overflow-y-auto rounded-xl border border-border/70 bg-white px-3 py-3 text-sm leading-6 text-foreground outline-none"
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
  )
}
