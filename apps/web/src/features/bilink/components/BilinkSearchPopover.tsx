import { Search, Link2 } from 'lucide-react'
import type { BilinkSearchResult } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'

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

interface GroupedNodeBranch {
  key: string
  title: string
  path: string[]
  children: GroupedNodeBranch[]
  results: BilinkSearchResult[]
}

interface GroupedPalaceResults {
  palaceId: number
  palaceTitle: string
  palaceResult: BilinkSearchResult | null
  topLevelNodes: BilinkSearchResult[]
  nestedBranches: GroupedNodeBranch[]
}

function resultLevel(result: BilinkSearchResult) {
  return Math.max(1, (result.node_path?.length ?? 2) - 1)
}

function sortResults(results: BilinkSearchResult[]) {
  return [...results].sort((left, right) => {
    const leftDepth = left.node_path?.length ?? 0
    const rightDepth = right.node_path?.length ?? 0
    if (leftDepth !== rightDepth) return leftDepth - rightDepth
    return (left.node_path?.join('/') ?? resultLabel(left)).localeCompare(
      right.node_path?.join('/') ?? resultLabel(right),
      'zh-CN',
    )
  })
}

function sortBranches(branches: GroupedNodeBranch[]): GroupedNodeBranch[] {
  return [...branches]
    .map((branch) => ({
      ...branch,
      children: sortBranches(branch.children),
      results: sortResults(branch.results),
    }))
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
}

function countBranchResults(branches: GroupedNodeBranch[]): number {
  return branches.reduce(
    (count, branch) => count + branch.results.length + countBranchResults(branch.children),
    0,
  )
}

function buildGroupedResults(results: BilinkSearchResult[]) {
  const groups = new Map<
    number,
    GroupedPalaceResults & {
      nestedBranchMap: Map<string, GroupedNodeBranch>
    }
  >()

  results.forEach((result) => {
    const existing = groups.get(result.palace_id) ?? {
      palaceId: result.palace_id,
      palaceTitle: result.palace_title,
      palaceResult: null,
      topLevelNodes: [],
      nestedBranches: [],
      nestedBranchMap: new Map<string, GroupedNodeBranch>(),
    }

    if (result.type === 'palace') {
      existing.palaceResult = result
    } else {
      const ancestorPath = result.node_path?.slice(1, -1) ?? []
      if (ancestorPath.length === 0) {
        existing.topLevelNodes.push(result)
      } else {
        let branchKey = ''
        let branchChildren = existing.nestedBranches
        ancestorPath.forEach((segment, index) => {
          branchKey = branchKey ? `${branchKey}/${segment}` : segment
          let branch = existing.nestedBranchMap.get(branchKey)
          if (!branch) {
            branch = {
              key: branchKey,
              title: segment,
              path: ancestorPath.slice(0, index + 1),
              children: [],
              results: [],
            }
            existing.nestedBranchMap.set(branchKey, branch)
            branchChildren.push(branch)
          }
          branchChildren = branch.children
          if (index === ancestorPath.length - 1) {
            branch.results.push(result)
          }
        })
      }
    }

    groups.set(result.palace_id, existing)
  })

  return Array.from(groups.values())
    .map(({ nestedBranchMap: _nestedBranchMap, ...group }) => ({
      ...group,
      topLevelNodes: sortResults(group.topLevelNodes),
      nestedBranches: sortBranches(group.nestedBranches),
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
    const level = resultLevel(result)
    const shortPath = result.node_path?.slice(1, -1) ?? []
    return (
      <div
        key={`${result.type}-${result.palace_id}-${result.node_uid ?? 'palace'}`}
        className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                L{level}
              </span>
              <span className="truncate">{resultLabel(result)}</span>
            </div>
            {shortPath.length > 0 ? (
              <div className="mt-1 text-xs text-slate-500">
                {shortPath.join(' / ')}
              </div>
            ) : (
              <div className="mt-1 text-xs text-slate-400">顶层节点</div>
            )}
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

  const renderBranch = (branch: GroupedNodeBranch, depth: number) => (
    <div
      key={branch.key}
      className="rounded-2xl border border-dashed border-slate-200/90 bg-slate-50/60 p-3"
      style={{ marginLeft: `${Math.min(depth, 4) * 14}px` }}
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
        <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-700">
          路径
        </span>
        <span>{branch.title}</span>
      </div>

      <div className="mt-2 space-y-2">
        {branch.results.map((result) => renderNodeResult(result))}
        {branch.children.map((child) => renderBranch(child, depth + 1))}
      </div>
    </div>
  )

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
                        <span className="truncate">{group.palaceTitle}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {group.topLevelNodes.length + group.nestedBranches.length > 0
                          ? `${group.topLevelNodes.length + countBranchResults(group.nestedBranches)} 个层级命中`
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

                  {group.topLevelNodes.length > 0 || group.nestedBranches.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {group.topLevelNodes.map((result) => renderNodeResult(result))}
                      {group.nestedBranches.map((branch) => renderBranch(branch, 0))}
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
