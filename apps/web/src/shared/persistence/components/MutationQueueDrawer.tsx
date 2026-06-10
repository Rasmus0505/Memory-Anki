import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCopy, RefreshCw, Trash2, X } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  confirmQueuedMutationOverwrite,
  discardQueuedMutation,
  replayQueuedMutations,
  type PersistedMutation,
} from '@/shared/persistence/mutationQueue'
import { useMutationQueueState } from '@/shared/persistence/useMutationQueue'
import { cn } from '@/shared/lib/utils'

interface MutationQueueDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatStatus(item: PersistedMutation) {
  if (item.status === 'pending') return '待同步'
  if (item.status === 'syncing') return '同步中'
  if (item.status === 'failed') return '失败待重试'
  if (item.status === 'conflict') return '冲突'
  return '需确认'
}

function getStatusVariant(item: PersistedMutation): 'secondary' | 'outline' | 'destructive' {
  if (item.status === 'conflict') return 'destructive'
  if (item.status === 'failed' || item.status === 'manual') return 'outline'
  return 'secondary'
}

function buildDiagnostics(item: PersistedMutation) {
  return [
    `id=${item.id}`,
    `mutation_id=${item.mutationId}`,
    `status=${item.status}`,
    `resource=${item.resourceKey}`,
    `method=${item.method}`,
    `url=${item.url}`,
    `attempts=${item.attemptCount}`,
    item.lastResponseStatus ? `last_status=${item.lastResponseStatus}` : '',
    item.errorMessage ? `error=${item.errorMessage}` : '',
    item.conflictMessage ? `conflict=${item.conflictMessage}` : '',
  ].filter(Boolean).join('\n')
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
}

export function MutationQueueDrawer({ open, onOpenChange }: MutationQueueDrawerProps) {
  const { items, summary } = useMutationQueueState()
  const [busyId, setBusyId] = useState('')
  const [copiedId, setCopiedId] = useState('')

  const title = useMemo(() => {
    if (summary.total === 0) return '数据同步正常'
    if (summary.conflict > 0) return `${summary.conflict} 项冲突待处理`
    if (summary.manual > 0) return `${summary.manual} 项需要确认`
    return `${summary.total} 项待同步`
  }, [summary.conflict, summary.manual, summary.total])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        aria-label="关闭同步侧边栏遮罩"
        className="absolute inset-0 bg-slate-950/30"
        onClick={() => onOpenChange(false)}
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col border-l border-border/70 bg-background shadow-2xl">
        <div className="border-b border-border/70 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">待同步 {summary.pending}</Badge>
                <Badge variant="secondary">同步中 {summary.syncing}</Badge>
                <Badge variant="outline">失败 {summary.failed}</Badge>
                <Badge variant={summary.conflict ? 'destructive' : 'outline'}>冲突 {summary.conflict}</Badge>
                <Badge variant="outline">需确认 {summary.manual}</Badge>
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={summary.total === 0}
              onClick={() => void replayQueuedMutations()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              重试自动项
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/60 text-sm text-muted-foreground">
              所有数据都已同步。
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-2xl border border-border/70 bg-background/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={getStatusVariant(item)}>{formatStatus(item)}</Badge>
                        <div className="text-sm font-medium">{item.description}</div>
                      </div>
                      <div className="mt-2 break-all text-xs text-muted-foreground">
                        {item.method} {item.url}
                      </div>
                    </div>
                    {item.replayMode === 'auto' && item.status !== 'conflict' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                    )}
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="text-muted-foreground">
                      创建：{new Date(item.createdAt).toLocaleString()} · 尝试 {item.attemptCount} 次
                    </div>
                    {item.errorMessage ? <div className="text-destructive">{item.errorMessage}</div> : null}
                    {item.conflictMessage ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2 text-destructive">
                        {item.conflictMessage}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyId === item.id}
                      onClick={async () => {
                        setBusyId(item.id)
                        try {
                          await replayQueuedMutations({ forceIds: [item.id] })
                        } finally {
                          setBusyId('')
                        }
                      }}
                    >
                      <RefreshCw className={cn('mr-2 h-4 w-4', busyId === item.id ? 'animate-spin' : '')} />
                      重试
                    </Button>
                    {item.status === 'conflict' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyId === item.id}
                        onClick={async () => {
                          const confirmed = window.confirm('确认用这条本地待同步内容覆盖服务端当前脑图吗？')
                          if (!confirmed) return
                          setBusyId(item.id)
                          try {
                            const updated = await confirmQueuedMutationOverwrite(item.id)
                            if (updated) {
                              await replayQueuedMutations({ forceIds: [item.id] })
                            }
                          } finally {
                            setBusyId('')
                          }
                        }}
                      >
                        确认覆盖
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await copyText(buildDiagnostics(item))
                        setCopiedId(item.id)
                      }}
                    >
                      <ClipboardCopy className="mr-2 h-4 w-4" />
                      {copiedId === item.id ? '已复制' : '诊断'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const confirmed = window.confirm('丢弃这条待同步记录后，里面的本地数据不会再自动保存到后端。确认丢弃吗？')
                        if (confirmed) {
                          await discardQueuedMutation(item.id)
                        }
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      丢弃
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

