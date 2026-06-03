import { Search, Link2 } from 'lucide-react'
import type { BilinkSearchResult } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import { sanitizeBilinkText } from '@/features/bilink/model/bilink-text'

interface BilinkSearchPopoverProps {
  open: boolean
  position: { left: number; top: number } | null
  mode: 'inline' | 'toolbar'
  query: string
  loading: boolean
  error: string
  results: BilinkSearchResult[]
  onQueryChange: (value: string) => void
  onClose: () => void
  onSelect: (result: BilinkSearchResult) => void
  onPreview?: (result: BilinkSearchResult) => void
}

function resultLabel(result: BilinkSearchResult) {
  return result.type === 'node'
    ? result.node_text || result.palace_title
    : result.palace_title
}

interface GroupedPalaceResults {
  palaceId: number
  palaceTitle: string
  palaceResult: BilinkSearchResult | null
  nodeResults: BilinkSearchResult[]
}

function sortResults(results: BilinkSearchResult[]) {
  return [...results].sort((left, right) => {
    const leftDepth = left.node_path?.length ?? 0
    const rightDepth = right.node_path?.length ?? 0
    if (leftDepth !== rightDepth) return leftDepth - rightDepth
    return sanitizeBilinkText(left.node_path?.join('/') ?? resultLabel(left)).localeCompare(
      sanitizeBilinkText(right.node_path?.join('/') ?? resultLabel(right)),
      'zh-CN',
    )
  })
}

function buildGroupedResults(results: BilinkSearchResult[]) {
  const groups = new Map<number, GroupedPalaceResults>()

  results.forEach((result) => {
    const existing = groups.get(result.palace_id) ?? {
      palaceId: result.palace_id,
      palaceTitle: result.palace_title,
      palaceResult: null,
      nodeResults: [],
    }

    if (result.type === 'palace') {
      existing.palaceResult = result
    } else {
      existing.nodeResults.push(result)
    }

    groups.set(result.palace_id, existing)
  })

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      nodeResults: sortResults(group.nodeResults),
    }))
    .sort((left, right) => left.palaceTitle.localeCompare(right.palaceTitle, 'zh-CN'))
}

export function BilinkSearchPopover({
  open,
  position,
  mode,
  query,
  loading,
  error,
  results,
  onQueryChange,
  onClose,
  onSelect,
  onPreview,
}: BilinkSearchPopoverProps) {
  if (!open) return null

  const groupedResults = buildGroupedResults(results)

  const renderNodeResult = (result: BilinkSearchResult) => {
    const displayText = sanitizeBilinkText(resultLabel(result)) || '未命名节点'
    return (
      <div
        key={`${result.type}-${result.palace_id}-${result.node_uid ?? 'palace'}`}
        className="rounded-xl border border-slate-200 bg-white/90 px-3 py-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
              {displayText}
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            {onPreview ? (
              <Button type="button" size="sm" variant="outline" onClick={() => onPreview(result)}>
                预览
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={() => onSelect(result)}>
              <Link2 className="h-4 w-4" />
              {mode === 'inline' ? '插入链接' : '查看'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const style =
    mode === 'inline' && position
      ? {
          left: `${position.left}px`,
          top: `${position.top}px`,
        }
      : undefined

  return (
    <div
      className={cn(
        'z-[120]',
        mode === 'inline'
          ? 'pointer-events-auto absolute'
          : 'pointer-events-auto absolute inset-x-0 top-0 flex justify-center px-4 pt-3',
      )}
      style={style}
    >
      <Card className="w-[min(640px,calc(100vw-2rem))] border-slate-200 bg-white/98 shadow-2xl">
        <CardHeader className="space-y-2 pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">
              {mode === 'inline' ? '插入双向链接' : '全局搜索'}
            </CardTitle>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="pl-9"
              placeholder={mode === 'inline' ? '搜索宫殿或节点，回车快速插入首项' : '搜索宫殿或节点'}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pb-4">
          {loading ? (
            <div className="rounded-xl border border-dashed border-border/80 px-3 py-6 text-center text-sm text-muted-foreground">
              正在搜索...
            </div>
          ) : null}

          {!loading && error ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {!loading && !error && query.trim() && results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 px-3 py-6 text-center text-sm text-muted-foreground">
              没有找到匹配结果。
            </div>
          ) : null}

          {!loading && results.length > 0 ? (
            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {groupedResults.map((group) => (
                <div
                  key={group.palaceId}
                  className="rounded-2xl border border-border/70 bg-background/60 p-3"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                          宫殿
                        </span>
                        <span className="truncate">{sanitizeBilinkText(group.palaceTitle) || '未命名宫殿'}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {group.nodeResults.length > 0
                          ? `${group.nodeResults.length} 条内容命中`
                          : '宫殿标题匹配'}
                      </div>
                    </div>

                    {group.palaceResult ? (
                      <div className="flex shrink-0 gap-2">
                        {onPreview ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onPreview(group.palaceResult as BilinkSearchResult)}
                          >
                            预览
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => onSelect(group.palaceResult as BilinkSearchResult)}
                        >
                          <Link2 className="h-4 w-4" />
                          {mode === 'inline' ? '插入宫殿' : '查看宫殿'}
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {group.nodeResults.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {group.nodeResults.map((result) => renderNodeResult(result))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
