import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Copy, Trash2, X } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  clearAppLogs,
  formatAppLogEntry,
  formatAppLogs,
  readAppLogs,
  removeAppLog,
  subscribeAppLogs,
  type AppLogEntry,
} from '@/shared/logs/model/appLogs'
import { cn } from '@/shared/lib/utils'

interface AppLogDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
}

function buildDiagnosticsText(log: AppLogEntry) {
  const lines = [
    `feature=${log.feature || 'unknown'}`,
    `stage=${log.stage || 'unknown'}`,
  ]
  if (log.requestId) lines.push(`request_id=${log.requestId}`)
  if (log.jobId) lines.push(`job_id=${log.jobId}`)
  const meta = log.meta || {}
  for (const key of ['errorCode', 'palaceId', 'entityKey', 'applyMode', 'sourceKind', 'mode', 'selectedPages', 'structurePage', 'beforeNodeCount', 'afterNodeCount']) {
    if (key in meta) {
      lines.push(`${key}=${JSON.stringify(meta[key])}`)
    }
  }
  if (log.errorMessage) lines.push(`error=${log.errorMessage}`)
  return lines.join('\n')
}

export function AppLogDrawer({ open, onOpenChange }: AppLogDrawerProps) {
  const [logs, setLogs] = useState<AppLogEntry[]>(() => readAppLogs())
  const [copiedId, setCopiedId] = useState<string>('')
  const [copiedAll, setCopiedAll] = useState(false)

  useEffect(() => subscribeAppLogs(() => setLogs(readAppLogs())), [])

  useEffect(() => {
    if (!copiedId && !copiedAll) return
    const timer = window.setTimeout(() => {
      setCopiedId('')
      setCopiedAll(false)
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [copiedAll, copiedId])

  const groupedCounts = useMemo(
    () => ({
      total: logs.length,
      ai: logs.filter((log) => log.kind === 'ai_call').length,
      app: logs.filter((log) => log.kind === 'app_error').length,
    }),
    [logs],
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        aria-label="关闭日志侧边栏遮罩"
        className="absolute inset-0 bg-slate-950/30"
        onClick={() => onOpenChange(false)}
      />
      <aside
        className={cn(
          'absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col border-l border-border/70 bg-background shadow-2xl',
        )}
      >
        <div className="border-b border-border/70 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              <div className="text-sm font-semibold">调用与错误日志</div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">总计 {groupedCounts.total}</Badge>
            <Badge variant="secondary">AI 调用 {groupedCounts.ai}</Badge>
            <Badge variant="secondary">网站错误 {groupedCounts.app}</Badge>
            <span>日志默认保留 7 天，支持手动删除。</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={logs.length === 0}
              onClick={async () => {
                await copyText(formatAppLogs(logs))
                setCopiedAll(true)
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              {copiedAll ? '已复制全部' : '复制全部'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={logs.length === 0}
              onClick={() => {
                clearAppLogs()
                setLogs([])
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              清空日志
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {logs.length === 0 ? (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/60 text-sm text-muted-foreground">
              暂时还没有日志记录。
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-border/70 bg-background/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={log.kind === 'ai_call' ? 'secondary' : 'outline'}>
                          {log.kind === 'ai_call' ? 'AI 调用' : '网站错误'}
                        </Badge>
                        <div className="text-sm font-medium">{log.feature || '未命名事件'}</div>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString()}
                        {log.stage ? ` · ${log.stage}` : ''}
                        {log.requestId ? ` · req:${log.requestId}` : ''}
                        {log.jobId ? ` · ${log.jobId}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="复制该条日志"
                        onClick={async () => {
                          await copyText(formatAppLogEntry(log))
                          setCopiedId(log.id)
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="复制诊断信息"
                        onClick={async () => {
                          await copyText(buildDiagnosticsText(log))
                          setCopiedId(log.id)
                        }}
                      >
                        诊断
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="删除该条日志"
                        onClick={() => removeAppLog(log.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    {log.route ? <div className="text-muted-foreground">页面：{log.route}</div> : null}
                    {log.requestId ? <div>请求 ID：<span className="font-mono text-xs">{log.requestId}</span></div> : null}
                    {log.jobId ? <div>任务 ID：<span className="font-mono text-xs">{log.jobId}</span></div> : null}
                    {log.requestSummary ? <div>请求：{log.requestSummary}</div> : null}
                    {log.responseSummary ? <div>返回：{log.responseSummary}</div> : null}
                    {log.errorMessage ? <div className="text-destructive">错误：{log.errorMessage}</div> : null}
                    {Object.keys(log.meta || {}).length > 0 ? (
                      <pre className="overflow-x-auto rounded-xl bg-slate-950 px-3 py-2 text-xs text-slate-100">
                        {JSON.stringify(log.meta, null, 2)}
                      </pre>
                    ) : null}
                    {copiedId === log.id ? <div className="text-xs text-emerald-600">已复制</div> : null}
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
