import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Brain, FileText, ImagePlus, Library, LoaderCircle, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import type { AiRuntimeOptions, QuizMatchingItem, QuizSourceRole } from '@/shared/api/contracts'
import { batchCreateChapterQuizQuestionsApi, batchCreatePalaceQuizQuestionsApi } from '@/entities/quiz/api'
import { buildGeneratedQuestionsForChapterSave } from '@/features/palace-quiz/quizGenerationController'
import { PreviewQuestionCard } from '@/features/palace-quiz/components/palaceQuizCards'
import { useQuizGenerationWorkspace } from '@/features/palace-quiz/hooks/useQuizGenerationWorkspace'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import { toast } from '@/shared/feedback/toast'

interface Props {
  palaceId: number
  palace: { title: string; editor_doc?: Record<string, unknown> | string | null } | null
  selectedChapterId: number | null
  selectedChapterSummary: string
  onOpenRangeDialog: () => Promise<void>
  promptForAiOptions: (options: { scenarioKey: string; entrypointKey: string; title: string }) => Promise<AiRuntimeOptions | null>
  onSaved: () => Promise<void>
}

const roleLabel = (role: QuizSourceRole) => role === 'question' ? '题目来源' : '答案来源'

export function QuizGenerationWorkspace(props: Props) {
  const workspace = useQuizGenerationWorkspace(props)
  const [text, setText] = useState<Record<QuizSourceRole, string>>({ question: '', answer: '' })
  const [pdfChoice, setPdfChoice] = useState<Record<QuizSourceRole, string>>({ question: '', answer: '' })
  const [pageExpression, setPageExpression] = useState<Record<QuizSourceRole, string>>({ question: '', answer: '' })
  const [matching, setMatching] = useState<QuizMatchingItem[]>([])
  const [saveMode, setSaveMode] = useState<'append' | 'overwrite'>('append')
  const [extraPrompt, setExtraPrompt] = useState('')
  const [enableSecondaryReview, setEnableSecondaryReview] = useState(false)
  const [classifyByMiniPalace, setClassifyByMiniPalace] = useState(false)
  const [selectedMatchIds, setSelectedMatchIds] = useState<string[]>([])

  useEffect(() => { setMatching(workspace.job?.matching_items || []) }, [workspace.job?.matching_items])
  useEffect(() => {
    setExtraPrompt(workspace.job?.extra_prompt || '')
    setEnableSecondaryReview(Boolean(workspace.job?.options.enable_secondary_review))
    setClassifyByMiniPalace(Boolean(workspace.job?.options.classify_by_mini_palace))
  }, [workspace.job?.id, workspace.job?.extra_prompt, workspace.job?.options])
  const questionSources = workspace.job?.sources.filter((item) => item.role === 'question') || []
  const answerSources = workspace.job?.sources.filter((item) => item.role === 'answer') || []
  const activeQuestions = matching.filter((item) => !item.ignored)
  const sourceCount = questionSources.length + answerSources.length
  const busy = workspace.loading

  const updateMatch = (id: string, patch: Partial<QuizMatchingItem>) => setMatching((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  const moveMatch = (index: number, direction: -1 | 1) => setMatching((current) => {
    const next = [...current]; const target = index + direction
    if (target < 0 || target >= next.length) return current
    ;[next[index], next[target]] = [next[target], next[index]]; return next
  })
  const duplicateMatch = (item: QuizMatchingItem) => setMatching((current) => [...current, { ...item, id: crypto.randomUUID(), question: { ...item.question }, question_text: `${item.question_text}（拆分副本）` }])
  const mergeSelected = () => {
    const selected = matching.filter((item) => item.ignored)
    if (selected.length < 2) { toast.error('请先将至少两个条目标记为忽略，再执行合并。'); return }
    const base = selected[0]
    const merged = { ...base, id: crypto.randomUUID(), ignored: false, status: 'matched' as const, question_text: selected.map((item) => item.question_text).join('\n'), answer_text: selected.map((item) => item.answer_text).join('\n') }
    setMatching((current) => [...current.filter((item) => !selected.some((value) => value.id === item.id)), merged])
  }
  const swapAnswerWithNext = (index: number) => setMatching((current) => {
    if (current.length < 2) return current
    const nextIndex = (index + 1) % current.length
    const next = [...current]
    const answerText = next[index].answer_text
    next[index] = { ...next[index], answer_text: next[nextIndex].answer_text }
    next[nextIndex] = { ...next[nextIndex], answer_text: answerText }
    return next
  })

  const addText = async (role: QuizSourceRole) => { if (!text[role].trim()) return; await workspace.addText(role, text[role]); setText((current) => ({ ...current, [role]: '' })) }
  const addPdf = async (role: QuizSourceRole) => { const assetId = Number(pdfChoice[role]); if (!assetId || !pageExpression[role].trim()) return; await workspace.addPdf(role, assetId, pageExpression[role]); setPageExpression((current) => ({ ...current, [role]: '' })) }
  const savePreview = async () => {
    const preview = workspace.job?.preview
    if (!preview?.questions.length) return
    if (props.selectedChapterId) {
      const questions = buildGeneratedQuestionsForChapterSave(preview, props.selectedChapterId)
      await batchCreateChapterQuizQuestionsApi(props.selectedChapterId, questions, saveMode, { palaceId: props.palaceId, ocrSources: preview.ocr_sources || [] })
    } else {
      await batchCreatePalaceQuizQuestionsApi(props.palaceId, preview.questions, preview.ocr_sources || [])
    }
    await workspace.markSaved(); await props.onSaved(); toast.success(`已保存 ${preview.questions.length} 道题目。`)
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><CardTitle>AI 题库生成工作台</CardTitle><p className="mt-1 text-sm text-muted-foreground">统一配置题目与答案来源，先解析匹配，再确认生成。</p></div>
            <div className="flex gap-2"><Badge variant="outline">{sourceCount} 个来源</Badge><Button type="button" variant="outline" onClick={() => void workspace.createNew()} disabled={busy}><Plus className="size-4" />新任务</Button></div>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">保存范围：</span><span>{props.selectedChapterSummary || '当前宫殿'}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void props.onOpenRangeDialog()}>修改范围</Button>
            {workspace.job ? <Badge>{workspace.job.status}</Badge> : null}
          </div>
        </CardHeader>
      </Card>

      <Card><CardHeader><CardTitle>生成配置</CardTitle></CardHeader><CardContent className="space-y-3"><Textarea value={extraPrompt} onChange={(event) => setExtraPrompt(event.target.value)} placeholder="额外提示词：题型、难度、保留原文等" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enableSecondaryReview} onChange={(event) => setEnableSecondaryReview(event.target.checked)} />启用二次审核提示</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={classifyByMiniPalace} onChange={(event) => setClassifyByMiniPalace(event.target.checked)} />按当前范围的训练关卡分类</label><Button type="button" variant="outline" onClick={() => void workspace.updateConfig({ extra_prompt: extraPrompt, options: { enable_secondary_review: enableSecondaryReview, classify_by_mini_palace: classifyByMiniPalace } })}>保存生成配置</Button></CardContent></Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {(['question', 'answer'] as QuizSourceRole[]).map((role) => {
          const sources = role === 'question' ? questionSources : answerSources
          return <Card key={role} className={role === 'question' ? 'border-primary/30' : ''}>
            <CardHeader><CardTitle className="flex items-center gap-2">{role === 'question' ? <Brain className="size-5" /> : <Sparkles className="size-5" />}{roleLabel(role)}{role === 'question' ? <Badge>必填</Badge> : <Badge variant="outline">可选 · 留空由 AI 补答</Badge>}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Textarea value={text[role]} onChange={(event) => setText((current) => ({ ...current, [role]: event.target.value }))} placeholder={`粘贴${roleLabel(role)}文本`} className="min-h-28" /><Button type="button" variant="outline" onClick={() => void addText(role)} disabled={busy || !text[role].trim()}><FileText className="size-4" />添加文本</Button></div>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-5 text-sm hover:bg-muted/50"><ImagePlus className="size-4" />添加图片或文本文件<input className="hidden" type="file" multiple accept="image/*,.txt,.md,.markdown,.json" onChange={(event) => { void workspace.addFiles(role, Array.from(event.target.files || [])); event.target.value = '' }} /></label>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={pdfChoice[role]} onChange={(event) => setPdfChoice((current) => ({ ...current, [role]: event.target.value }))}><option value="">选择长期 PDF</option>{workspace.pdfAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}（{asset.page_count}页）</option>)}</select><Input value={pageExpression[role]} onChange={(event) => setPageExpression((current) => ({ ...current, [role]: event.target.value }))} placeholder="页码：1-10,15" /><Button type="button" variant="outline" onClick={() => void addPdf(role)} disabled={busy}><Library className="size-4" />添加</Button></div>
              {role === 'question' ? <Button type="button" variant="outline" onClick={() => void workspace.addMindmap()} disabled={busy || !props.palace?.editor_doc}><Brain className="size-4" />添加当前复习脑图</Button> : null}
              <div className="space-y-2">{sources.length === 0 ? <div className="rounded-lg bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">尚未添加来源</div> : sources.map((source) => <div key={source.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"><div className="min-w-0"><div className="truncate font-medium">{source.display_name}</div><div className="text-xs text-muted-foreground">{source.source_type}{source.page_numbers.length ? ` · 第 ${source.page_numbers.join(',')} 页` : ''}</div></div><div className="flex gap-1"><Button type="button" size="icon" variant="ghost" onClick={() => void workspace.moveSource(source.id, -1)}><ArrowUp className="size-4" /></Button><Button type="button" size="icon" variant="ghost" onClick={() => void workspace.moveSource(source.id, 1)}><ArrowDown className="size-4" /></Button><Button type="button" size="icon" variant="ghost" onClick={() => void workspace.removeSource(source.id)}><Trash2 className="size-4" /></Button></div></div>)}</div>
            </CardContent>
          </Card>
        })}
      </div>

      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Library className="size-5" />PDF 长期资料库</CardTitle></CardHeader><CardContent className="space-y-3"><label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-5 text-sm"><Plus className="size-4" />上传 PDF 到资料库<input className="hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void workspace.uploadPdf(file); event.target.value = '' }} /></label><div className="grid gap-2 md:grid-cols-2">{workspace.pdfAssets.map((asset) => <div key={asset.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"><div className="min-w-0"><div className="truncate font-medium">{asset.name}</div><div className="text-xs text-muted-foreground">{asset.original_name} · {asset.page_count} 页 · {(asset.file_size / 1024 / 1024).toFixed(1)} MB</div></div><div className="flex gap-1"><Button type="button" size="sm" variant="outline" onClick={() => window.open(`/api/v1/quiz-pdf-assets/${asset.id}/file`, '_blank')}>打开</Button><Button type="button" size="sm" variant="outline" onClick={() => void workspace.archivePdf(asset.id)}>归档</Button><Button type="button" size="icon" variant="ghost" onClick={() => void workspace.deletePdf(asset.id)}><Trash2 className="size-4" /></Button></div></div>)}</div></CardContent></Card>

      <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void workspace.extractMatch()} disabled={busy || questionSources.length === 0}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}解析并匹配</Button>{workspace.job?.error_message ? <span className="text-sm text-destructive">{workspace.job.error_message}</span> : null}</div>

      {matching.length ? <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>匹配审核</CardTitle><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => void workspace.saveMatching(matching).then(() => workspace.rematch(selectedMatchIds))} disabled={!selectedMatchIds.length}>局部重匹配</Button><Button type="button" variant="outline" onClick={mergeSelected}>合并已忽略项</Button><Button type="button" variant="outline" onClick={() => void workspace.saveMatching(matching)} disabled={busy}><Save className="size-4" />保存修正</Button><Button type="button" onClick={() => void workspace.saveMatching(matching).then(workspace.generatePreview)} disabled={busy || activeQuestions.length === 0}>确认并生成题库</Button></div></div></CardHeader><CardContent className="space-y-3">{matching.map((item, index) => <div key={item.id} className="space-y-3 rounded-lg border border-border/70 p-3"><div className="flex flex-wrap items-center gap-2"><input aria-label={`选择匹配 ${index + 1}`} type="checkbox" checked={selectedMatchIds.includes(item.id)} onChange={(event) => setSelectedMatchIds((current) => event.target.checked ? [...current, item.id] : current.filter((value) => value !== item.id))} /><Badge variant={item.answer_generated_by_ai ? 'destructive' : 'secondary'}>{item.answer_generated_by_ai ? 'AI 生成答案' : item.status}</Badge><Badge variant="outline">置信度 {item.confidence}</Badge><div className="ml-auto flex gap-1"><Button type="button" size="icon" variant="ghost" onClick={() => moveMatch(index, -1)}><ArrowUp className="size-4" /></Button><Button type="button" size="icon" variant="ghost" onClick={() => moveMatch(index, 1)}><ArrowDown className="size-4" /></Button><Button type="button" size="sm" variant="outline" onClick={() => swapAnswerWithNext(index)}>重绑下一答案</Button><Button type="button" size="sm" variant="outline" onClick={() => duplicateMatch(item)}>拆分副本</Button><Button type="button" size="sm" variant={item.ignored ? 'default' : 'outline'} onClick={() => updateMatch(item.id, { ignored: !item.ignored, status: item.ignored ? 'matched' : 'ignored' })}>{item.ignored ? '恢复' : '忽略'}</Button></div></div><Textarea value={item.question_text} onChange={(event) => updateMatch(item.id, { question_text: event.target.value })} className="min-h-20" /><Textarea value={item.answer_text} onChange={(event) => updateMatch(item.id, { answer_text: event.target.value })} className="min-h-20" /></div>)}</CardContent></Card> : null}

      {workspace.job?.preview ? <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>题库预览 · {workspace.job.preview.questions.length} 题</CardTitle><div className="flex gap-2">{props.selectedChapterId ? <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={saveMode} onChange={(event) => setSaveMode(event.target.value as 'append' | 'overwrite')}><option value="append">追加保存</option><option value="overwrite">覆盖章节题库</option></select> : null}<Button type="button" onClick={() => void savePreview()} disabled={busy}><Save className="size-4" />保存到题库</Button></div></div></CardHeader><CardContent className="space-y-3">{workspace.job.preview.warnings?.map((warning) => <div key={warning} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">{warning}</div>)}{workspace.job.preview.questions.map((question, index) => <PreviewQuestionCard key={`${question.stem}_${index}`} question={question} index={index} />)}</CardContent></Card> : null}

      {workspace.jobs.length ? <Card><CardHeader><CardTitle>生成任务</CardTitle></CardHeader><CardContent className="space-y-2">{workspace.jobs.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"><button type="button" className="min-w-0 text-left" onClick={() => workspace.setJob(item)}><div className="truncate font-medium">{item.title}</div><div className="text-xs text-muted-foreground">{item.status} · {item.sources.length} 个来源</div></button><Button type="button" size="icon" variant="ghost" onClick={() => void workspace.removeJob(item.id)}><Trash2 className="size-4" /></Button></div>)}</CardContent></Card> : null}
    </div>
  )
}
