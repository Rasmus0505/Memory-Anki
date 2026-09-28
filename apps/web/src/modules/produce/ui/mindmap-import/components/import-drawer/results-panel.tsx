import type { MindMapImportResultsModel } from '@/modules/produce/ui/mindmap-import/components/import-drawer/types'
import { SourceTreeNode } from '@/modules/produce/ui/mindmap-import/components/import-drawer/source-tree'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/shared/lib/utils'

interface MindMapImportResultsPanelProps {
  model: MindMapImportResultsModel
}

export function MindMapImportResultsPanel({
  model,
}: MindMapImportResultsPanelProps) {
  const {
    previewFrameVersion,
    previewMindMapState,
    previewSectionRef,
    renderMindMapPreview,
    sourceTree,
  } = model

  return (
    <div data-testid="mindmap-import-results" className="px-6 py-5">
      <section ref={previewSectionRef} className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">结构预览</div>
          {sourceTree?.title ? <Badge variant="outline">{sourceTree.title}</Badge> : null}
        </div>
        <div
          className={cn(
            'rounded-lg border border-border/70 bg-background/70',
            !sourceTree && 'flex h-[260px] items-center justify-center text-sm text-muted-foreground',
          )}
        >
          {previewMindMapState ? (
            <div className="h-[360px] overflow-hidden rounded-[inherit]" data-testid="mindmap-import-preview-frame">
              {renderMindMapPreview(previewMindMapState, previewFrameVersion)}
            </div>
          ) : sourceTree ? (
            <div className="max-h-[320px] space-y-3 overflow-y-auto p-3 pr-1">
              {sourceTree.children.length > 0 ? (
                sourceTree.children.map((node, index) => (
                  <SourceTreeNode key={`${node.text}-${index}`} node={node} />
                ))
              ) : (
                <div className="text-sm text-muted-foreground">解析结果里还没有分支知识点。</div>
              )}
            </div>
          ) : (
            '解析完成后，这里会显示脑图预览。'
          )}
        </div>
      </section>
    </div>
  )
}
