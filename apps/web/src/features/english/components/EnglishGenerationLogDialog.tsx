import type { EnglishGenerationLogResponse } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

interface EnglishGenerationLogDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  loading: boolean
  error: string
  log: EnglishGenerationLogResponse | null
}

export function EnglishGenerationLogDialog({
  open,
  onOpenChange,
  title,
  loading,
  error,
  log,
}: EnglishGenerationLogDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(90vh,940px)] max-w-[min(94vw,1220px)] overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>{title}</DialogTitle>
            <DialogClose onClick={() => onOpenChange(false)} />
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="py-12 text-sm text-muted-foreground">正在加载生成日志...</div>
          ) : error ? (
            <div className="py-12 text-sm text-destructive">{error}</div>
          ) : !log ? (
            <div className="py-12 text-sm text-muted-foreground">暂时没有可显示的生成日志。</div>
          ) : (
            <div className="space-y-4">
              {log.task ? (
                <div className="rounded-2xl border border-border/70 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={log.task.status === 'failed' ? 'destructive' : 'secondary'}>
                      {log.task.status}
                    </Badge>
                    <div className="text-sm font-medium">{log.task.sourceFilename || '英语生成任务'}</div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {log.task.stage ? `阶段：${log.task.stage}` : ''}
                    {log.task.createdAt ? ` · 创建于 ${new Date(log.task.createdAt).toLocaleString()}` : ''}
                    {typeof log.task.courseId === 'number' ? ` · 课程 ID ${log.task.courseId}` : ''}
                  </div>
                  <div className="mt-3 rounded-xl bg-secondary/60 px-3 py-2 text-sm">
                    {log.task.message || '无状态描述'}
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-border/70 p-4">
                <div className="text-sm font-medium">阶段时间线</div>
                {log.events.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {log.events.map((event) => (
                      <div key={event.id} className="rounded-xl border border-border/70 bg-background/70 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{event.stage || 'unknown'}</Badge>
                          <Badge variant="secondary">{event.kind || 'info'}</Badge>
                          <div className="text-xs text-muted-foreground">
                            {event.timestamp ? new Date(event.timestamp).toLocaleString() : ''}
                          </div>
                        </div>
                        <div className="mt-2 text-sm">{event.message}</div>
                        {Object.keys(event.data || {}).length > 0 ? (
                          <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 px-3 py-2 text-xs text-slate-100">
                            {JSON.stringify(event.data, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-muted-foreground">这次生成没有写入阶段事件。</div>
                )}
              </div>

              <div className="rounded-2xl border border-border/70 p-4">
                <div className="text-sm font-medium">关联 AI 调用</div>
                {log.aiLogs.length > 0 ? (
                  <div className="mt-3 space-y-4">
                    {log.aiLogs.map((item) => (
                      <div key={item.id} className="rounded-xl border border-border/70 bg-background/70 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={item.status === 'error' ? 'destructive' : 'secondary'}>
                            {item.status}
                          </Badge>
                          <div className="text-sm font-medium">{item.operation}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.model ? `${item.model}` : ''}
                            {item.created_at ? ` · ${new Date(item.created_at).toLocaleString()}` : ''}
                          </div>
                        </div>
                        {item.prompt_text ? (
                          <div className="mt-3 space-y-2">
                            <div className="text-xs font-medium text-muted-foreground">Prompt</div>
                            <pre className="overflow-x-auto rounded-xl bg-slate-950 px-3 py-2 text-xs text-slate-100">
                              {item.prompt_text}
                            </pre>
                          </div>
                        ) : null}
                        {item.response_text ? (
                          <div className="mt-3 space-y-2">
                            <div className="text-xs font-medium text-muted-foreground">原始返回</div>
                            <pre className="overflow-x-auto rounded-xl bg-slate-950 px-3 py-2 text-xs text-slate-100">
                              {item.response_text}
                            </pre>
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-muted-foreground">请求 JSON</div>
                            <pre className="overflow-x-auto rounded-xl bg-slate-950 px-3 py-2 text-xs text-slate-100">
                              {JSON.stringify(item.request_payload, null, 2)}
                            </pre>
                          </div>
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-muted-foreground">返回 JSON</div>
                            <pre className="overflow-x-auto rounded-xl bg-slate-950 px-3 py-2 text-xs text-slate-100">
                              {JSON.stringify(item.response_payload, null, 2)}
                            </pre>
                          </div>
                        </div>
                        {Object.keys(item.error_payload || {}).length > 0 ? (
                          <div className="mt-3 space-y-2">
                            <div className="text-xs font-medium text-destructive">错误信息</div>
                            <pre className="overflow-x-auto rounded-xl bg-rose-950 px-3 py-2 text-xs text-rose-100">
                              {JSON.stringify(item.error_payload, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-muted-foreground">这次生成没有关联到 AI 调用日志。</div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
