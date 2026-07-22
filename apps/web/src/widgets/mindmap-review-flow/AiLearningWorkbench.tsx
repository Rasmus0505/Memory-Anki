import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, Check, ChevronRight, CircleHelp, LoaderCircle, Maximize2, MessageSquareMore, RefreshCw, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { buildAiContextEnvelope, deleteAiLearningRunApi, executeAiLearningRunApi, listAiLearningRunsApi, previewAiLearningRunApi, setAiLearningRunApplicationApi, setAiLearningRunFeedbackApi, type AiContextEnvelope, type AiContextScope, type AiLearningRun, type AiLearningTaskKey, type AiRunDraft, type AiRunPreview } from '@/modules/settings/public'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Textarea } from '@/shared/components/ui/textarea'
import { cn } from '@/shared/lib/utils'
import { AiLearningRunResult } from './AiLearningRunResult'
import { runTrackedAiTask } from '@/shared/background-tasks/runTrackedAiTask'

const TASKS: Array<{ key: AiLearningTaskKey; label: string; prompt: string }> = [
  { key: 'ask', label: '自由提问', prompt: '' }, { key: 'explain', label: '讲解', prompt: '请解释这部分内容，并给出一个直观例子。' }, { key: 'quiz', label: '即时出题', prompt: '请围绕这部分内容生成 3 道练习题草稿。' }, { key: 'correct', label: '纠错补全', prompt: '请检查错误、缺口和不清晰表述，给出待确认建议。' },
]
const SCOPES: Array<{ key: AiContextScope; label: string }> = [{ key: 'node', label: '当前节点' }, { key: 'ancestors', label: '祖先路径' }, { key: 'subtree', label: '当前子树' }, { key: 'review', label: '本次复习' }, { key: 'full', label: '完整导图' }, { key: 'manual', label: '手动选择' }]
function uuid() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}` }
interface Props { open: boolean; onOpenChange: (open: boolean) => void; title: string; palaceId: number | null; reviewSessionId?: number | null; editorState: MindMapEditorState; sourceRevision: string; activeNodeUid?: string | null; reviewNodeUids: string[]; redNodeUids: string[]; ratings?: Map<string, number>; fullscreen: boolean }
export function AiLearningWorkbench(props: Props) {
  const [fullscreenHost, setFullscreenHost] = useState<Element | null>(null);
  const [task, setTask] = useState<AiLearningTaskKey>('ask'); const [includeMindmap, setIncludeMindmap] = useState(true); const [scope, setScope] = useState<AiContextScope>('subtree'); const [includeNotes, setIncludeNotes] = useState(true); const [includeAncestors, setIncludeAncestors] = useState(true); const [manualUids, setManualUids] = useState<string[]>([]); const [frozen, setFrozen] = useState<AiContextEnvelope | null>(null); const [prompt, setPrompt] = useState(''); const [preview, setPreview] = useState<AiRunPreview | null>(null); const [runs, setRuns] = useState<AiLearningRun[]>([]); const [loading, setLoading] = useState(false); const [maximized, setMaximized] = useState(false); const [advanced, setAdvanced] = useState(false); const [threadId, setThreadId] = useState<string | undefined>(); const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const buildContext = useCallback(() => buildAiContextEnvelope({ editorState: props.editorState, title: props.title, sourceEntityId: String(props.palaceId ?? props.reviewSessionId ?? 'review'), sourceRevision: props.sourceRevision, scope, activeNodeUid: props.activeNodeUid, manualNodeUids: manualUids, reviewNodeUids: props.reviewNodeUids, includeNotes, includeAncestors, redNodeUids: props.redNodeUids, ratings: props.ratings }), [includeAncestors, includeNotes, manualUids, props.activeNodeUid, props.editorState, props.palaceId, props.ratings, props.redNodeUids, props.reviewNodeUids, props.reviewSessionId, props.sourceRevision, props.title, scope])
  useEffect(() => { if(!props.open) { setFrozen(null); return }; setFrozen(current => current ?? buildContext()) }, [buildContext, props.open])
  useEffect(() => { const update = () => setFullscreenHost(document.fullscreenElement); update(); document.addEventListener('fullscreenchange', update); return () => document.removeEventListener('fullscreenchange', update) }, [])
  useEffect(() => { if(!props.open || !props.reviewSessionId) return; void listAiLearningRunsApi({ reviewSessionId: props.reviewSessionId }).then(result => { setRuns(result.items); setThreadId(result.items.at(-1)?.thread_id) }) }, [props.open, props.reviewSessionId])
  const selectedNodes = useMemo(() => new Set(manualUids), [manualUids])
  const manualCatalog = useMemo(() => buildAiContextEnvelope({ editorState: props.editorState, title: props.title, sourceEntityId: String(props.palaceId ?? props.reviewSessionId ?? 'review'), sourceRevision: props.sourceRevision, scope: 'full', reviewNodeUids: props.reviewNodeUids, includeNotes, includeAncestors: false, redNodeUids: props.redNodeUids, ratings: props.ratings }).nodes, [includeNotes, props.editorState, props.palaceId, props.ratings, props.redNodeUids, props.reviewNodeUids, props.reviewSessionId, props.sourceRevision, props.title])
  const draft = (context: AiContextEnvelope, userPrompt: string): AiRunDraft => ({ task_key: task, context, user_prompt: userPrompt, scenario_key: 'review_ai_learning', entrypoint_key: 'review.ai-learning-workbench', context_selections: [{ kind: 'mindmap', enabled: includeMindmap, source_entity_id: context.source_entity_id, source_revision: context.source_revision, label: '当前思维导图', content: includeMindmap ? context.summary : '' }], output_type: task === 'quiz' ? 'quiz_draft' : task === 'correct' ? 'change_suggestions' : 'text', owner_id: `review:${props.reviewSessionId ?? props.palaceId ?? 'local'}`, operation_id: uuid(), thread_id: threadId, parent_run_id: runs.at(-1)?.id, review_session_id: props.reviewSessionId ?? undefined, palace_id: props.palaceId ?? undefined })
  const refreshContext = () => { const next = buildContext(); setFrozen(next); setPreview(null) }
  const handlePreview = async () => { if(!frozen) return; setLoading(true); try { setPreview((await previewAiLearningRunApi(draft(frozen, prompt))).preview) } finally { setLoading(false) } }
  const handleRun = async () => {
    if (!frozen) return
    const aiOptions = await promptForAiOptions({
      scenarioKey: 'review_ai_learning',
      entrypointKey: 'review.ai-learning-workbench',
      title: '确认 AI 学习运行',
      description: '选择模型并可修改本次系统提示词。上下文已在工作台中冻结并预览。',
    })
    if (!aiOptions) return
    setLoading(true)
    try {
      const payload = draft(frozen, prompt)
      payload.ai_options = aiOptions
      const result = await runTrackedAiTask({
        id: `review-ai-learning-${payload.operation_id}`,
        section: 'review',
        title: '复习 AI 学习 · 进行中',
        navigateTarget: '/review',
        initialDetail: '准备运行…',
        steps: [
          { id: 'prepare', label: '准备请求' },
          { id: 'generate', label: '模型生成' },
          { id: 'apply', label: '写入记录' },
        ],
        run: async (controller) => {
          controller.setStep('prepare', '正在提交学习请求…')
          controller.setStep('generate', '模型正在生成…')
          const response = await executeAiLearningRunApi(payload)
          controller.setStep('apply', '正在写入学习记录…')
          return response
        },
      })
      setRuns((current) => [...current, result.item])
      setThreadId(result.item.thread_id)
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }
  const setFeedback = async (run: AiLearningRun, feedback: AiLearningRun['feedback']) => { const result = await setAiLearningRunFeedbackApi(run.id, feedback); setRuns(current => current.map(item => item.id === run.id ? result.item : item)) }
  const acceptRun = async (run: AiLearningRun) => { const result = await setAiLearningRunApplicationApi(run.id, 'accepted'); setRuns(current => current.map(item => item.id === run.id ? result.item : item)) }
  const deleteRun = async (run: AiLearningRun) => { await deleteAiLearningRunApi(run.id); setRuns(current => current.filter(item => item.id !== run.id)) }
  const rerun = (run: AiLearningRun) => { setTask(run.task_key); setPrompt(run.user_prompt); setScope(run.context.scope); setIncludeNotes(run.context.include_notes); setIncludeAncestors(run.context.include_ancestors); setIncludeMindmap(run.context_selections.find(item => item.kind === 'mindmap')?.enabled ?? true); setFrozen(run.context); setPreview(null) }
  if(!props.open) return aiRunConfigDialog
  const workbench = <aside className={cn('z-[110] flex min-h-0 flex-col border-l border-border bg-background shadow-2xl', props.fullscreen ? 'absolute inset-y-0 right-0 w-[min(42rem,48vw)]' : 'w-[min(38rem,44vw)]', maximized && 'absolute inset-3 w-auto rounded-xl border')} onKeyDown={event => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b p-3"><div><div className="flex items-center gap-2 font-semibold"><Bot className="size-4"/>AI 学习工作台</div><div className="text-xs text-muted-foreground">上下文冻结后再预览、选模型并发送</div></div><div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => setMaximized(value => !value)}><Maximize2 className="size-4"/></Button><Button size="icon" variant="ghost" onClick={() => props.onOpenChange(false)}><X className="size-4"/></Button></div></div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <section className="space-y-2"><div className="text-xs font-semibold uppercase text-muted-foreground">任务</div><div className="grid grid-cols-2 gap-2">{TASKS.map(item => <Button key={item.key} variant={task === item.key ? 'default' : 'outline'} onClick={() => { setTask(item.key); if(!prompt.trim()) setPrompt(item.prompt); setPreview(null) }}>{item.label}</Button>)}</div></section>
        <section className="space-y-3 rounded-xl border p-3"><div className="flex items-center justify-between"><div><div className="font-medium">发送上下文</div><div className="text-xs text-muted-foreground">{frozen?.summary ?? '尚未冻结'}</div></div><Button size="sm" variant="outline" onClick={refreshContext}><RefreshCw className="mr-1 size-3"/>更新为当前焦点</Button></div><div className="flex flex-wrap gap-2">{SCOPES.map(item => <Button size="sm" key={item.key} variant={scope === item.key ? 'secondary' : 'ghost'} onClick={() => { setScope(item.key); setPreview(null) }}>{item.label}</Button>)}</div><div className="flex gap-4 text-sm"><label><input type="checkbox" checked={includeMindmap} onChange={event => { setIncludeMindmap(event.target.checked); setPreview(null) }}/> 加入思维导图内容</label><label><input type="checkbox" checked={includeNotes} onChange={event => setIncludeNotes(event.target.checked)}/> 包含笔记</label><label><input type="checkbox" checked={includeAncestors} onChange={event => setIncludeAncestors(event.target.checked)}/> 包含祖先</label></div>{scope === 'manual' ? <div className="max-h-44 space-y-1 overflow-auto rounded border p-2">{manualCatalog.map(node => <label key={node.uid} className="flex gap-2 text-sm"><input type="checkbox" checked={selectedNodes.has(node.uid)} onChange={() => setManualUids(current => current.includes(node.uid) ? current.filter(uid => uid !== node.uid) : [...current, node.uid])}/><span>{node.title || node.uid}</span></label>)}</div> : null}<div className="flex flex-wrap gap-1">{frozen?.node_uids.slice(0, 12).map(uid => <Badge key={uid} variant="outline">{uid}</Badge>)}{(frozen?.node_uids.length ?? 0) > 12 ? <Badge>+{frozen!.node_uids.length - 12}</Badge> : null}</div></section>
        <section className="space-y-2"><div className="text-xs font-semibold uppercase text-muted-foreground">问题或补充要求</div><Textarea rows={4} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="例如：我不理解它与上一节点的关系，请用类比解释。"/><div className="flex gap-2"><Button variant="outline" disabled={loading || !frozen} onClick={() => void handlePreview()}>{loading ? <LoaderCircle className="mr-2 size-4 animate-spin"/> : <CircleHelp className="mr-2 size-4"/>}预览实际发送内容</Button><Button disabled={loading || !frozen} onClick={() => void handleRun()}><Sparkles className="mr-2 size-4"/>选择模型并运行</Button></div></section>
        {preview ? <section className="space-y-2 rounded-xl border bg-muted/25 p-3"><div className="flex justify-between"><div className="font-medium">发送预览</div><Badge variant={preview.estimated_tokens > 24000 ? 'destructive' : 'secondary'}>约 {preview.estimated_tokens} tokens</Badge></div>{preview.warnings.map(item => <div key={item} className="text-sm text-warning">{item}</div>)}<Button size="sm" variant="ghost" onClick={() => setAdvanced(value => !value)}>{advanced ? '隐藏高级请求' : '查看高级请求'}<ChevronRight className="ml-1 size-3"/></Button><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background p-3 text-xs">{advanced ? JSON.stringify(preview.messages, null, 2) : preview.context_text}</pre></section> : null}
        <section className="space-y-3"><div className="flex items-center justify-between"><div className="text-xs font-semibold uppercase text-muted-foreground">本次学习记录</div><Button size="sm" variant="ghost" onClick={() => { setThreadId(undefined); setRuns([]) }}>新建线程</Button></div>{runs.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">还没有 AI 学习记录。</div> : runs.map(run => <article key={run.id} className="space-y-2 rounded-xl border p-3"><div className="flex justify-between"><Badge variant="outline">{TASKS.find(item => item.key === run.task_key)?.label}</Badge><span className="text-xs text-muted-foreground">{run.model_meta.model_label ?? run.model_meta.model_key}</span></div><div className="text-sm font-medium">{run.user_prompt}</div>{run.status === 'failed' ? <div className="text-sm text-destructive">{run.error}</div> : <AiLearningRunResult run={run} palaceId={props.palaceId} onRunChange={(nextRun) => setRuns(current => current.map(item => item.id === nextRun.id ? nextRun : item))} />}<div className="flex flex-wrap gap-1"><Button size="sm" variant={run.feedback === 'helpful' ? 'secondary' : 'ghost'} onClick={() => void setFeedback(run, 'helpful')}><ThumbsUp className="mr-1 size-3"/>有帮助</Button><Button size="sm" variant={run.feedback === 'unclear' ? 'secondary' : 'ghost'} onClick={() => void setFeedback(run, 'unclear')}><ThumbsDown className="mr-1 size-3"/>仍不理解</Button><Button size="sm" variant="ghost" onClick={() => { setTask('ask'); setPrompt('请继续解释，并针对我仍然不理解的部分换一种方法。') }}><MessageSquareMore className="mr-1 size-3"/>继续追问</Button><Button size="sm" variant="ghost" onClick={() => { setTask('quiz'); setPrompt('请围绕上一条回答生成练习题草稿。') }}><Check className="mr-1 size-3"/>围绕回答出题</Button><Button size="sm" variant={run.application_status === 'accepted' ? 'secondary' : 'ghost'} disabled={run.status !== 'completed'} onClick={() => void acceptRun(run)}><Check className="mr-1 size-3"/>接受结果</Button><Button size="sm" variant="ghost" onClick={() => rerun(run)}><RotateCcw className="mr-1 size-3"/>加载复跑</Button><Button size="sm" variant="ghost" onClick={() => void deleteRun(run)}><Trash2 className="mr-1 size-3"/>删除</Button></div></article>)}</section>
      </div>
    </aside>
  return <>{fullscreenHost ? createPortal(workbench, fullscreenHost) : workbench}{aiRunConfigDialog}</>
}




