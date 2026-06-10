import type { PalaceImportResultsModel } from '@/features/palace-edit/components/palace-import-drawer/types'
import { SourceTreeNode } from '@/features/palace-edit/components/palace-import-drawer/source-tree'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/shared/lib/utils'

interface PalaceImportResultsPanelProps {
  model: PalaceImportResultsModel
}

export function PalaceImportResultsPanel({
  model,
}: PalaceImportResultsPanelProps) {
  const {
    batchMeta,
    extractedText,
    hasStreamProgress,
    importWarnings,
    loading,
    mode,
    onStreamPreviewScroll,
    pdfImportMode,
    pdfModeLabel,
    pdfOcrStatusLabel,
    pdfPageSummary,
    previewFrameVersion,
    previewMindMapState,
    previewSectionRef,
    rawModelPreviewText,
    resolvedPreviewImageUrl,
    selectedPdfPages,
    sourceKind,
    sourceTree,
    streamPreviewContentRef,
    streamStepLabel,
    structurePage,
  } = model
  const isStructuredPdfMode = pdfImportMode === 'structured_merge'

  return (
    <div data-testid="mindmap-import-results" className="px-6 py-5">
      <div className="grid gap-5">
        {sourceKind === 'subject-pdf' && mode === 'mindmap' ? (
          <section
            data-testid="mindmap-import-pdf-summary"
            className="rounded-2xl border border-border/70 bg-background/70 p-4 text-sm"
          >
            <div className="mb-2 font-medium">本次 PDF 识别摘要</div>
            <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
              <div>页码：{pdfPageSummary}</div>
              <div>模式：{pdfModeLabel}</div>
              <div>结构页：{isStructuredPdfMode && structurePage ? `第 ${structurePage} 页` : '无'}</div>
              <div>OCR grounding：{pdfOcrStatusLabel}</div>
            </div>
            {importWarnings.length > 0 ? (
              <div className="mt-3 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-amber-900">
                {importWarnings.join('；')}
              </div>
            ) : null}
          </section>
        ) : null}

        <section ref={previewSectionRef} className="space-y-3">
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
                  ? '识别完成后，这里会显示当前识别页预览。'
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
                    'rounded-2xl border border-border/70 bg-background/70 p-3',
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
                  {sourceKind === 'subject-pdf' && !isStructuredPdfMode ? '脑图预览' : '结构预览'}
                </div>
                <div className="flex items-center gap-2">
                  {sourceKind === 'image-batch' && batchMeta ? (
                    <Badge variant="secondary">
                      {batchMeta.imageCount} 张图{batchMeta.structureImageIndex != null ? ' / 结构补全' : ' / 直接生成'}
                    </Badge>
                  ) : null}
                  {sourceKind === 'subject-pdf' && selectedPdfPages.length > 0 ? (
                    <Badge variant="secondary">{selectedPdfPages.length} 页 PDF</Badge>
                  ) : null}
                  {sourceTree?.title ? <Badge variant="outline">{sourceTree.title}</Badge> : null}
                </div>
              </div>
              <div
                className={cn(
                  'rounded-2xl border border-border/70 bg-background/70',
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
                      className="h-full w-full rounded-[inherit] bg-white"
                    />
                  </div>
                ) : sourceTree ? (
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
                  '完成 PDF 范围识别后，这里会显示脑图预览。'
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
                  'flex min-h-[320px] flex-col rounded-2xl border border-border/70 bg-background/70 p-3',
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
