import { ArrowRightLeft, Link2, Trash2 } from 'lucide-react'
import type { BilinkItem } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'

interface BilinkPanelProps {
  items: BilinkItem[]
  loading: boolean
  error: string
  onPreview: (item: BilinkItem) => void
  onDelete: (item: BilinkItem) => void
}

function targetLabel(item: BilinkItem) {
  if (item.direction === 'incoming') {
    return item.source_node_text || item.source_palace_title
  }
  return item.target_node_text || item.target_palace_title
}

function targetPath(item: BilinkItem) {
  if (item.direction === 'incoming') {
    return item.source_node_path
  }
  return item.target_node_path
}

function targetPalace(item: BilinkItem) {
  if (item.direction === 'incoming') {
    return item.source_palace_title
  }
  return item.target_palace_title
}

export function BilinkPanel({
  items,
  loading,
  error,
  onPreview,
  onDelete,
}: BilinkPanelProps) {
  return (
    <Card className="border-border/70 bg-card/92">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">双向链接</CardTitle>
        <span className="text-xs text-muted-foreground">{items.length} 条</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? <div className="text-sm text-muted-foreground">正在加载链接...</div> : null}
        {!loading && error ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 bg-background/60 p-4 text-sm text-muted-foreground">
            还没有跨宫殿链接。在节点编辑时输入 `@`，或用顶部搜索面板来创建。
          </div>
        ) : null}
        {!loading && items.length > 0 ? (
          <div className="space-y-2.5">
            {items.map((item) => (
              <div key={item.id} className="rounded-2xl border border-border/70 bg-background/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[11px]',
                          item.direction === 'incoming'
                            ? 'bg-sky-50 text-sky-700'
                            : 'bg-amber-50 text-amber-700',
                        )}
                      >
                        {item.direction === 'incoming' ? '被引用' : '引用'}
                      </span>
                      <span className="truncate">{targetLabel(item)}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{targetPalace(item)}</div>
                    {targetPath(item)?.length ? (
                      <div className="mt-2 text-xs text-slate-500">{targetPath(item)?.join(' / ')}</div>
                    ) : null}
                    {item.text ? (
                      <div className="mt-2 text-xs text-slate-600">显示文本：{item.text}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => onPreview(item)}>
                      <Link2 className="h-4 w-4" />
                      预览
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => onDelete(item)}>
                      <Trash2 className="h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
