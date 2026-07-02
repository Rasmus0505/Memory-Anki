import { Type, Workflow } from 'lucide-react'
import type { ChapterOption } from '@/features/palace-edit/hooks/usePalaceEditPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'

interface PalaceBindingPanelProps {
  titleMode: 'sync' | 'manual'
  manualTitle: string
  groupingMode: 'auto' | 'manual'
  manualGroupChapterId: number | null
  chapterOptions: ChapterOption[]
  primaryChapterName?: string | null
  resolvedParentChapterName?: string | null
  bindingStatus: 'ok' | 'missing' | 'top_level' | 'unbound'
  onTitleModeChange: (mode: 'sync' | 'manual') => void
  onManualTitleChange: (value: string) => void
  onGroupingModeChange: (mode: 'auto' | 'manual') => void
  onManualGroupChapterChange: (chapterId: number | null) => void
}

export function PalaceBindingPanel({
  titleMode,
  manualTitle,
  groupingMode,
  manualGroupChapterId,
  chapterOptions,
  primaryChapterName,
  resolvedParentChapterName,
  bindingStatus,
  onTitleModeChange,
  onManualTitleChange,
  onGroupingModeChange,
  onManualGroupChapterChange,
}: PalaceBindingPanelProps) {
  return (
    <Card className="border-border/70 bg-card/92">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="size-4" />
          绑定规则
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>宫殿名</Label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onTitleModeChange('sync')}
              className={`rounded-md border px-3 py-2 text-sm ${titleMode === 'sync' ? 'border-primary bg-primary/10' : 'border-input'}`}
            >
              跟随主节点
            </button>
            <button
              type="button"
              onClick={() => onTitleModeChange('manual')}
              className={`rounded-md border px-3 py-2 text-sm ${titleMode === 'manual' ? 'border-primary bg-primary/10' : 'border-input'}`}
            >
              手动名称
            </button>
          </div>
          {titleMode === 'manual' ? (
            <Input
              value={manualTitle}
              onChange={(event) => onManualTitleChange(event.target.value)}
              placeholder="输入手动宫殿名"
            />
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>列表收纳</Label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onGroupingModeChange('auto')}
              className={`rounded-md border px-3 py-2 text-sm ${groupingMode === 'auto' ? 'border-primary bg-primary/10' : 'border-input'}`}
            >
              跟随父章节
            </button>
            <button
              type="button"
              onClick={() => onGroupingModeChange('manual')}
              className={`rounded-md border px-3 py-2 text-sm ${groupingMode === 'manual' ? 'border-primary bg-primary/10' : 'border-input'}`}
            >
              手动指定
            </button>
          </div>
          {groupingMode === 'manual' ? (
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={manualGroupChapterId ?? ''}
              onChange={(event) => onManualGroupChapterChange(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">未指定收纳章节</option>
              {chapterOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {`${'　'.repeat(option.depth)}${option.name}`}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-sm text-muted-foreground">
              当前自动收纳：{resolvedParentChapterName || '未绑定章节'}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <Type className="size-4" />
            当前绑定状态
          </div>
          <div className="mt-1">
            {bindingStatus === 'ok' && `名称来源：${primaryChapterName || '自动选择的关联章节'}；列表分类：${resolvedParentChapterName || primaryChapterName || '自动选择的章节'}`}
            {bindingStatus === 'top_level' && `名称来源：${primaryChapterName || '顶层章节'}；列表分类：${primaryChapterName || '顶层章节'}`}
            {bindingStatus === 'missing' && '主节点已失效，需重新绑定'}
            {bindingStatus === 'unbound' && '尚未关联章节'}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
