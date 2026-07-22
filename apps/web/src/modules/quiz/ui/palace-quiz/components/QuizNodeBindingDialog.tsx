import { useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import type { MindMapDocumentInput } from '@/modules/content/public'
import {
  applyPalaceQuizNodeBindingsApi,
  previewPalaceQuizNodeBindingsApi,
} from '@/modules/quiz/domain/quiz-entity/api'
import type { QuizNodeBindingEdge, QuizNodeBindingMergeMode, QuizNodeBindingPreview } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { toast } from '@/shared/feedback/toast'
import { QuizNodeBindingManualPanel } from './QuizNodeBindingManualPanel'

type BindingTab = 'ai' | 'manual'

export function QuizNodeBindingDialog({
  open,
  onOpenChange,
  palaceId,
  editorDoc = null,
  onApplied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  palaceId: number | null
  editorDoc?: MindMapDocumentInput
  onApplied?: (items: QuizNodeBindingEdge[]) => void
}) {
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const [tab, setTab] = useState<BindingTab>('ai')
  const [mergeMode, setMergeMode] = useState<QuizNodeBindingMergeMode>('replace_all')
  const [running, setRunning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [preview, setPreview] = useState<QuizNodeBindingPreview | null>(null)
  const [rejectedKeys, setRejectedKeys] = useState<Set<string>>(() => new Set())

  const acceptedEdges = useMemo(() => {
    if (!preview) return []
    return preview.bindings.filter((edge) => {
      const key = `${edge.question_id}:${edge.node_uid}`
      return !rejectedKeys.has(key)
    })
  }, [preview, rejectedKeys])

  const reset = () => {
    setPreview(null)
    setRejectedKeys(new Set())
    setRunning(false)
    setApplying(false)
    setTab('ai')
  }

  const handleClose = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleAnalyze = async () => {
    if (!palaceId) return
    const operationId = crypto.randomUUID()
    const aiOptions = await promptForAiOptions({
      scenarioKey: 'quiz_node_binding',
      entrypointKey: 'palace.quiz-node-binding',
      title: '题库结合 · AI 配置',
      description: '将把当前宫殿思维导图与题库发给 AI，分析每道题对应哪些知识点卡片。确认后生成预览，不会立刻写入。',
    })
    if (!aiOptions) return
    setRunning(true)
    setPreview(null)
    setRejectedKeys(new Set())
    try {
      const result = await previewPalaceQuizNodeBindingsApi(palaceId, {
        merge_mode: mergeMode,
        operation_id: operationId,
        ai_options: aiOptions,
      })
      setPreview(result)
      toast.success(`分析完成：预览 ${result.preview_edge_count} 条绑定（${result.batch_count} 批）`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '题库结合分析失败。')
    } finally {
      setRunning(false)
    }
  }

  const toggleEdge = (edge: QuizNodeBindingEdge) => {
    const key = `${edge.question_id}:${edge.node_uid}`
    setRejectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleApply = async () => {
    if (!palaceId || !preview) return
    setApplying(true)
    try {
      const result = await applyPalaceQuizNodeBindingsApi(palaceId, {
        merge_mode: preview.merge_mode,
        operation_id: preview.operation_id,
        bindings: preview.bindings,
        accepted_edges: acceptedEdges,
      })
      onApplied?.(result.items)
      toast.success(`已保存 ${result.item_count} 条知识点绑定。`)
      handleClose(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存绑定失败。')
    } finally {
      setApplying(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>题库结合</DialogTitle>
            <DialogDescription>
              把题库题目绑定到思维导图知识点卡片。AI 批量分析，或在「手改绑定」里逐条纠正。
            </DialogDescription>
          </DialogHeader>

          <div className="inline-flex rounded-lg border border-border/70 bg-background p-1">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'ai' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
              onClick={() => setTab('ai')}
            >
              AI 分析
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'manual' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
              onClick={() => setTab('manual')}
            >
              手改绑定
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto pr-1" style={{ maxHeight: '55vh' }}>
            {tab === 'manual' ? (
              palaceId ? (
                <QuizNodeBindingManualPanel
                  palaceId={palaceId}
                  editorDoc={editorDoc}
                  onChanged={onApplied}
                />
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">请先打开有效宫殿。</div>
              )
            ) : (
              <>
                <div className="space-y-2">
                  <div className="text-sm font-medium">重跑策略</div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={mergeMode === 'replace_all' ? 'default' : 'outline'}
                      onClick={() => setMergeMode('replace_all')}
                      disabled={running || applying}
                    >
                      全量替换 AI 绑定
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={mergeMode === 'fill_unbound' ? 'default' : 'outline'}
                      onClick={() => setMergeMode('fill_unbound')}
                      disabled={running || applying}
                    >
                      只补未绑定题目
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    全量替换会清除本宫殿已有 AI 绑定后写入本次结果（手动绑定保留）；只补未绑定会保留已有绑定，仅处理尚未绑定的题。
                  </p>
                </div>

                {!preview ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {running ? (
                      <div className="inline-flex items-center gap-2">
                        <LoaderCircle className="size-4 animate-spin" />
                        正在分批分析题库与导图，请稍候…
                      </div>
                    ) : (
                      '选择策略后开始分析。大题库会自动分批调用 AI，完成后在此预览。'
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>题目 {preview.question_count}</span>
                      <span>节点 {preview.mindmap_node_count}</span>
                      <span>批次数 {preview.batch_count}</span>
                      <span>预览边 {preview.preview_edge_count}</span>
                      <span>接受 {acceptedEdges.length}</span>
                      <span>未绑定题 {preview.unbound_question_ids.length}</span>
                    </div>
                    {preview.warnings.length ? (
                      <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                        {preview.warnings.slice(0, 5).join('；')}
                        {preview.warnings.length > 5 ? ` 等 ${preview.warnings.length} 条提示` : ''}
                      </div>
                    ) : null}
                    <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                      {preview.bindings.length === 0 ? (
                        <div className="p-3 text-sm text-muted-foreground">没有可写入的绑定边。</div>
                      ) : (
                        preview.bindings.map((edge) => {
                          const key = `${edge.question_id}:${edge.node_uid}`
                          const rejected = rejectedKeys.has(key)
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => toggleEdge(edge)}
                              className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                                rejected ? 'bg-muted/50 text-muted-foreground line-through' : 'hover:bg-muted'
                              }`}
                            >
                              <span className="shrink-0 font-mono text-xs">Q{edge.question_id}</span>
                              <span className="shrink-0 font-mono text-xs text-muted-foreground">→ {edge.node_uid}</span>
                              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                                {edge.reason || edge.source || ''}
                              </span>
                              <span className="shrink-0 text-xs">{rejected ? '已拒绝' : '接受'}</span>
                            </button>
                          )
                        })
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">点击某行可切换接受/拒绝（预览手改）。更细的长期修正请用「手改绑定」。</p>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={running || applying}>
              {tab === 'manual' ? '关闭' : '取消'}
            </Button>
            {tab === 'ai' ? (
              !preview ? (
                <Button type="button" onClick={() => void handleAnalyze()} disabled={!palaceId || running}>
                  {running ? (
                    <>
                      <LoaderCircle className="mr-2 size-4 animate-spin" />
                      分析中
                    </>
                  ) : (
                    '开始分析'
                  )}
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => void handleAnalyze()} disabled={running || applying}>
                    重新分析
                  </Button>
                  <Button type="button" onClick={() => void handleApply()} disabled={applying || acceptedEdges.length === 0}>
                    {applying ? (
                      <>
                        <LoaderCircle className="mr-2 size-4 animate-spin" />
                        保存中
                      </>
                    ) : (
                      `确认写入（${acceptedEdges.length}）`
                    )}
                  </Button>
                </>
              )
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {aiRunConfigDialog}
    </>
  )
}
