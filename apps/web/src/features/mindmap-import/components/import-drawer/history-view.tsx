import { Clock, Trash2 } from 'lucide-react'
import type { MindMapImportHistoryViewModel } from '@/features/mindmap-import/components/import-drawer/types'
import { RotateCcw } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'

interface MindMapImportHistoryViewProps {
  model: MindMapImportHistoryViewModel
  onBackToImport: () => void
}

export function MindMapImportHistoryView({
  model,
  onBackToImport,
}: MindMapImportHistoryViewProps) {
  const { history, onSelectHistory, onDeleteHistory, onRerunHistory } = model

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock className="size-4" />
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
              <div key={item.id} className="rounded-lg border border-border/70 bg-background/70 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-h-11 min-w-0 flex-1 text-left"
                    onClick={() => {
                      onSelectHistory(item)
                      onBackToImport()
                    }}
                  >
                    <div className="truncate text-sm font-medium">{item.title || '未命名'}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{item.nodeCount} 个知识点</span>
                      {item.importMode === 'batch' ? <Badge variant="secondary">多图</Badge> : null}
                      {item.imageCount ? <span>{item.imageCount} 张图</span> : null}
                      {item.jobStatus ? (
                        <Badge variant="outline">{JOB_STATUS_LABELS[item.jobStatus] ?? item.jobStatus}</Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()}
                    </div>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11 sm:size-9 sm:min-h-9 sm:min-w-9"
                    onClick={() => onRerunHistory?.(item.jobId || item.id)}
                    title="复跑此记录"
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11 sm:size-9 sm:min-h-9 sm:min-w-9"
                    onClick={() => onDeleteHistory(item.id)}
                    title="删除此记录"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-[260px] items-center justify-center rounded-lg border border-dashed border-border/80 bg-background/60 text-sm text-muted-foreground">
            还没有历史记录。先完成一次识别，历史会自动保存在这里。
          </div>
        )}
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
