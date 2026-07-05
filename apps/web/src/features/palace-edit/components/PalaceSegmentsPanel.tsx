import { useMemo, useState } from 'react'
import { CalendarClock, Edit3, GitMerge, Plus, ScanSearch, Trash2 } from 'lucide-react'
import type { PalaceSegmentSummary } from '@/shared/api/contracts'
import { formatDuration } from '@/entities/session/model'
import {
  formatSegmentDateTime,
  getSegmentDisplayName,
} from '@/features/palace-segments/model/segment-display'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { cn } from '@/shared/lib/utils'

const SEGMENT_COLORS = ['#14b8a6', '#f97316', '#3b82f6', '#eab308', '#ec4899', '#8b5cf6']

interface PalaceSegmentsPanelProps {
  segments: PalaceSegmentSummary[]
  selectedNodeCount: number
  activeSegmentId: number | null
  segmentDialogOpen: boolean
  segmentName: string
  setSegmentName: (value: string) => void
  segmentColor: string
  setSegmentColor: (value: string) => void
  segmentCreatedAt: string
  setSegmentCreatedAt: (value: string) => void
  editingSegmentId: number | null
  segmentSaving: boolean
  segmentMergingId: number | null
  segmentError: string
  isSegmentRangeMode: boolean
  rangeTargetSegmentId: number | 'new' | null
  onOpenDialog: () => void
  onOpenEdit: (segment: PalaceSegmentSummary) => void
  onOpenChange: (open: boolean) => void
  onSave: () => void | Promise<void>
  onDelete: (segmentId: number) => void | Promise<void>
  onAdjustRange: (segment: PalaceSegmentSummary) => void
  onMerge: (sourceSegmentId: number, targetSegmentId: number) => void | Promise<void>
}

function SegmentMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'warning'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px]',
        tone === 'warning'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-border/70 bg-background/80 text-muted-foreground',
      )}
    >
      {label} {value}
    </span>
  )
}

export function PalaceSegmentsPanel({
  segments,
  selectedNodeCount,
  activeSegmentId,
  segmentDialogOpen,
  segmentName,
  setSegmentName,
  segmentColor,
  setSegmentColor,
  segmentCreatedAt,
  setSegmentCreatedAt,
  editingSegmentId,
  segmentSaving,
  segmentMergingId,
  segmentError,
  isSegmentRangeMode,
  rangeTargetSegmentId,
  onOpenDialog,
  onOpenEdit,
  onOpenChange,
  onSave,
  onDelete,
  onAdjustRange,
  onMerge,
}: PalaceSegmentsPanelProps) {
  const [mergeSourceId, setMergeSourceId] = useState<number | null>(null)

  const mergeTargets = useMemo(
    () => segments.filter((segment) => segment.id !== mergeSourceId),
    [mergeSourceId, segments],
  )

  return (
    <>
      <Card className="border-border/70 bg-card/92">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">学习组</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={onOpenDialog}>
            <Plus className="mr-2 size-4" />
            用当前选中创建
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-dashed border-border/80 bg-background/60 px-3 py-2 text-sm text-muted-foreground">
            当前选中 {selectedNodeCount} 个知识点
          </div>

          {segments.length > 0 ? (
            <div className="space-y-2.5">
              {segments.map((segment, index) => (
                <div
                  key={segment.id}
                  className={cn(
                    'rounded-lg border px-3 py-3',
                    activeSegmentId === segment.id
                      ? 'border-primary bg-muted'
                      : 'border-border/70 bg-background/70',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: segment.color }}
                        />
                        <span className="truncate font-medium">
                          {getSegmentDisplayName(segment, index)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarClock className="h-3.5 w-3.5" />
                          {formatSegmentDateTime(segment.created_at)}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <SegmentMetric label="知识点" value={`${segment.node_count}`} />
                        {segment.is_virtual_default ? (
                          <SegmentMetric label="" value="未划分剩余内容" />
                        ) : null}
                        <SegmentMetric
                          label="预计"
                          value={formatDuration(segment.estimated_review_seconds)}
                        />
                        <SegmentMetric
                          label="进度"
                          value={`${segment.review_stage_completed}/${segment.review_stage_total}`}
                        />
                        {segment.next_review_at ? (
                          <SegmentMetric
                            label="下次"
                            value={formatSegmentDateTime(segment.next_review_at)}
                          />
                        ) : null}
                        {segment.is_empty ? (
                          <SegmentMetric label="" value="待补充内容" tone="warning" />
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      {segment.is_virtual_default ? null : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => onOpenEdit(segment)}
                        >
                          <Edit3 className="mr-2 size-4" />
                          时间
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          isSegmentRangeMode && rangeTargetSegmentId === segment.id
                            ? 'default'
                            : 'outline'
                        }
                        className="h-8"
                        onClick={() => onAdjustRange(segment)}
                      >
                        <ScanSearch className="mr-2 size-4" />
                        调整范围
                      </Button>
                      {segments.length > 1 && !segment.is_virtual_default ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => setMergeSourceId(segment.id)}
                          disabled={segmentMergingId === segment.id}
                        >
                          <GitMerge className="mr-2 size-4" />
                          {segmentMergingId === segment.id ? '合并中…' : '合并到…'}
                        </Button>
                      ) : null}
                      {segment.is_virtual_default ? null : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-destructive hover:text-destructive"
                          onClick={() => void onDelete(segment.id)}
                        >
                          <Trash2 className="mr-2 size-4" />
                          删除学习组
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/80 bg-background/60 p-4 text-sm text-muted-foreground">
              还没有学习组。先在脑图里选中一组知识点，再创建一个学习组。
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={segmentDialogOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{editingSegmentId ? '编辑学习组' : '创建学习组'}</DialogTitle>
              <DialogClose onClick={() => onOpenChange(false)} />
            </div>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="segment-created-at">创建时间</Label>
              <Input
                id="segment-created-at"
                type="datetime-local"
                value={segmentCreatedAt}
                onChange={(event) => setSegmentCreatedAt(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="segment-name">名称</Label>
              <Input
                id="segment-name"
                value={segmentName}
                onChange={(event) => setSegmentName(event.target.value)}
                placeholder="例如：第二学习组"
              />
            </div>
            <div className="space-y-2">
              <Label>颜色</Label>
              <div className="flex flex-wrap gap-2">
                {SEGMENT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      'size-8 rounded-full border-2',
                      segmentColor === color ? 'border-slate-950' : 'border-transparent',
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setSegmentColor(color)}
                    aria-label={`选择颜色 ${color}`}
                  />
                ))}
              </div>
            </div>
            {segmentError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {segmentError}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={segmentSaving}
              >
                取消
              </Button>
              <Button type="button" onClick={() => void onSave()} disabled={segmentSaving}>
                {segmentSaving ? '保存中…' : '保存学习组'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeSourceId != null} onOpenChange={(open) => !open && setMergeSourceId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>合并学习组</DialogTitle>
              <DialogClose onClick={() => setMergeSourceId(null)} />
            </div>
          </DialogHeader>
          <div className="space-y-3 px-6 py-5">
            <p className="text-sm text-muted-foreground">
              选择一个目标学习组，当前学习组的知识点会并入目标学习组，原学习组会被删除，但脑图内容不会删除。
            </p>
            <div className="space-y-2">
              {mergeTargets.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-background/80 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                  onClick={() => {
                    if (mergeSourceId == null) return
                    void onMerge(mergeSourceId, segment.id)
                    setMergeSourceId(null)
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: segment.color }}
                    />
                    <span className="truncate text-sm font-medium">{segment.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{segment.node_count} 知识点</span>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
