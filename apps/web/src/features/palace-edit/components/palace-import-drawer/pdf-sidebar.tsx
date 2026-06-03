import { LoaderCircle } from 'lucide-react'
import type { PalaceImportPdfSidebarModel } from '@/features/palace-edit/components/palace-import-drawer/types'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/shared/lib/utils'

interface PalaceImportPdfSidebarProps {
  model: PalaceImportPdfSidebarModel
  layoutMode: 'floating' | 'sidebar'
}

export function PalaceImportPdfSidebar({
  model,
  layoutMode,
}: PalaceImportPdfSidebarProps) {
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
          {isStructuredPdfMode
            ? ' 当前为结构页补全模式，可从已选页里指定结构页。'
            : ' 当前为按范围直接生成模式，不需要设置结构页。'}
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
              const isPreview = pdfPreviewPage === page.page_number
              const analyzed = analyzedPdfPages.includes(page.page_number)
              const isStructure = structurePage === page.page_number
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
                        {isStructuredPdfMode && isStructure ? <Badge variant="secondary">结构页</Badge> : null}
                        {analyzed ? (
                          <Badge variant="secondary" className="bg-emerald-600 text-white hover:bg-emerald-600">
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
