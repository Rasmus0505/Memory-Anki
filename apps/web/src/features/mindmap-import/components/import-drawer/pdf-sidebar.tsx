import { LoaderCircle } from 'lucide-react'
import type { MindMapImportPdfSidebarModel } from '@/features/mindmap-import/components/import-drawer/types'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/shared/lib/utils'

interface MindMapImportPdfSidebarProps {
  model: MindMapImportPdfSidebarModel
  layoutMode: 'floating' | 'sidebar'
}

export function MindMapImportPdfSidebar({
  model,
  layoutMode,
}: MindMapImportPdfSidebarProps) {
  const {
    sourceKind,
    pdfPagesLoading,
    pdfPageMeta,
    selectedPdfPages,
    pdfPreviewPage,
    analyzedPdfPages,
    structurePage,
    pdfImportMode,
    onTogglePdfPage,
    onPdfPreviewPageChange,
    onStructurePageChange,
  } = model

  if (sourceKind !== 'subject-pdf') return null

  const isStructuredPdfMode = pdfImportMode === 'structured_merge'

  return (
    <aside
      data-testid="mindmap-import-pdf-sidebar"
      className={cn(
        'shrink-0 border-t bg-background/55 xl:border-t-0',
        layoutMode === 'sidebar'
          ? 'flex max-h-[42vh] w-full flex-col xl:max-h-none xl:w-[300px] xl:border-l'
          : 'flex max-h-[36vh] w-full flex-col border-t xl:max-h-none xl:w-[360px] xl:border-l xl:border-t-0',
      )}
    >
      <div className="border-b px-5 py-4">
        <div className="text-sm font-medium">PDF 缩略图</div>
        <div className="mt-1 text-xs text-muted-foreground">
          绿色表示已经分析过。点击卡片可预览，勾选由“已选”控制。
          {isStructuredPdfMode
            ? ' 当前为结构页补全模式，可从已选页里指定结构页。'
            : ' 当前为按范围直接生成模式，不需要设置结构页。'}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {pdfPagesLoading ? (
          <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            正在加载页面…
          </div>
        ) : pdfPageMeta.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
            {pdfPageMeta.map((page) => {
              const selected = selectedPdfPages.includes(page.page_number)
              const isPreview = pdfPreviewPage === page.page_number
              const analyzed = analyzedPdfPages.includes(page.page_number)
              const isStructure = structurePage === page.page_number
              return (
                <button
                  key={page.page_number}
                  type="button"
                  onClick={() => onTogglePdfPage(page.page_number)}
                  className={cn(
                    'rounded-lg border p-2 text-left transition-colors',
                    analyzed
                      ? 'border-success/70 bg-success/5'
                      : isPreview
                        ? 'border-foreground/30 bg-foreground/[0.04]'
                        : 'border-border/70 bg-background',
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
                      className="h-28 w-full rounded-xl border border-border/60 bg-white object-cover sm:h-32 xl:h-40"
                    />
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-2">
                    <div className="space-y-1 text-xs">
                      <div>第 {page.page_number} 页</div>
                      <div className="flex flex-wrap items-center gap-1">
                        {selected ? <Badge variant="secondary">已选</Badge> : null}
                        {isStructuredPdfMode && isStructure ? <Badge variant="secondary">结构页</Badge> : null}
                        {analyzed ? (
                          <Badge variant="secondary" className="bg-success text-success-foreground hover:bg-success">
                            已分析
                          </Badge>
                        ) : null}
                      </div>
                      {selected && isStructuredPdfMode ? (
                        <span
                          role="button"
                          tabIndex={0}
                          className="text-[11px] text-primary underline-offset-2 hover:underline"
                          onClick={(event) => {
                            event.stopPropagation()
                            onStructurePageChange(page.page_number)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              event.stopPropagation()
                              onStructurePageChange(page.page_number)
                            }
                          }}
                        >
                          {isStructure ? '当前结构页' : '设为结构页'}
                        </span>
                      ) : null}
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
  )
}
