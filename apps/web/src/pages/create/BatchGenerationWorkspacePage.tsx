import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, BookOpen, FileSearch, Save, Sparkles, Trash2, Upload } from 'lucide-react'
import {
  buildBatchPublishPlan,
  confirmBatchOutline,
  createBatchWorkspace,
  deleteBatchWorkspace,
  getBatchWorkspace,
  previewBatchPrompt,
  saveBatchDraft,
  updateBatchSection,
  uploadBatchPdfs,
  type BatchSection,
  type BatchWorkspace,
  type OutputMode,
} from '@/entities/batch-generation/api'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { appConfirm } from '@/shared/components/ui/native-dialog'

const STORAGE_KEY = 'memory-anki-batch-workspace-id'
const outputLabels: Record<OutputMode, string> = { palace: '仅宫殿', quiz: '仅题库', both: '宫殿 + 题库', skip: '跳过' }

export default function BatchGenerationWorkspacePage() {
  const navigate = useNavigate()
  const [workspace, setWorkspace] = useState<BatchWorkspace | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [promptPreview, setPromptPreview] = useState<Record<string, unknown> | null>(null)
  const [draftText, setDraftText] = useState('{}')
  const [publishPlan, setPublishPlan] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    const id = localStorage.getItem(STORAGE_KEY)
    if (!id) return
    void getBatchWorkspace(id).then(setWorkspace).catch(() => localStorage.removeItem(STORAGE_KEY))
  }, [])

  const selectedSection = useMemo(() => workspace?.books.flatMap((book) => book.sections).find((section) => section.id === selectedSectionId) ?? null, [selectedSectionId, workspace])

  async function createWorkspace() {
    setBusy(true)
    try {
      const result = await createBatchWorkspace(`整书批量生成 ${new Date().toLocaleDateString('zh-CN')}`)
      localStorage.setItem(STORAGE_KEY, result.id)
      setWorkspace(result)
      setMessage('工作区已创建，可一次选择多本 PDF。')
    } finally {
      setBusy(false)
    }
  }

  async function upload(role: 'textbook' | 'quiz', files: FileList | null) {
    if (!workspace || !files?.length) return
    setBusy(true)
    setMessage('正在本地分析 PDF 文本层、页数、目录和扫描页比例…')
    try {
      setWorkspace(await uploadBatchPdfs(workspace.id, role, Array.from(files)))
      setMessage('分析完成。请检查章节目次和页码，再选择代表节。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }

  async function patchSection(section: BatchSection, changes: Parameters<typeof updateBatchSection>[1]) {
    try {
      await updateBatchSection(section, changes)
      if (workspace) setWorkspace(await getBatchWorkspace(workspace.id))
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message}；请刷新后重新编辑。` : '保存失败')
    }
  }

  async function showPrompt(kind: 'palace' | 'quiz') {
    if (!selectedSection) return
    const result = await previewBatchPrompt(selectedSection.id, { kind, model: kind === 'palace' ? 'qwen3-vl-flash' : 'deepseek-v4-flash', system_prompt: kind === 'palace' ? '将本节教材转换为结构清晰、可编辑的记忆宫殿草稿。' : '基于教材与题库证据生成可审阅的题目草稿，不得编造来源。', user_prompt: `处理章节：${selectedSection.title}，页码 ${selectedSection.start_page}-${selectedSection.end_page}。` })
    setPromptPreview(result)
  }

  async function saveDraft(kind: 'palace' | 'quiz') {
    if (!selectedSection || !workspace) return
    try {
      const content = JSON.parse(draftText) as Record<string, unknown>
      await saveBatchDraft(selectedSection, kind, content)
      setWorkspace(await getBatchWorkspace(workspace.id))
      setMessage('草稿已保存并完成确定性规则质检。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '草稿 JSON 无效')
    }
  }

  async function deleteWorkspace() {
    if (!workspace) return
    const confirmed = await appConfirm(
      '确定删除当前批量生成工作区吗？已上传的 PDF、目录规划和草稿都会永久删除，此操作不可撤销。',
      {
        title: '删除批量生成工作区',
        confirmText: '删除工作区',
        tone: 'danger',
      },
    )
    if (!confirmed) return

    setBusy(true)
    try {
      await deleteBatchWorkspace(workspace.id)
      if (localStorage.getItem(STORAGE_KEY) === workspace.id) {
        localStorage.removeItem(STORAGE_KEY)
      }
      setWorkspace(null)
      setSelectedSectionId(null)
      setPromptPreview(null)
      setPublishPlan(null)
      navigate('/palaces/new', { replace: true })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除工作区失败')
    } finally {
      setBusy(false)
    }
  }
  if (!workspace) {
    return <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center p-6"><Card className="w-full"><CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-5" />整书 PDF 批量生成与校正</CardTitle></CardHeader><CardContent className="space-y-4 text-sm text-muted-foreground"><p>创建持久化草稿工作区，先规划目录和页段，再按节生成、预览、纠错和发布。</p><Button onClick={() => void createWorkspace()} disabled={busy}>创建工作区</Button></CardContent></Card></main>
  }

  return <main className="mx-auto max-w-[1500px] space-y-4 p-4 lg:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">{workspace.title}</h1><p className="text-sm text-muted-foreground">目录确认 → 代表节 → 批量生成 → 异常复核 → 发布清单</p></div><div className="flex gap-2"><label><input className="hidden" type="file" accept="application/pdf" multiple onChange={(event) => void upload('textbook', event.target.files)} /><Button asChild variant="outline"><span><Upload className="mr-2 size-4" />教材 PDF</span></Button></label><label><input className="hidden" type="file" accept="application/pdf" multiple onChange={(event) => void upload('quiz', event.target.files)} /><Button asChild variant="outline"><span><Upload className="mr-2 size-4" />题库 PDF</span></Button></label><Button variant="destructive" disabled={busy} onClick={() => void deleteWorkspace()}><Trash2 className="mr-2 size-4" />删除当前工作区</Button><Button onClick={() => void buildBatchPublishPlan(workspace.id).then(setPublishPlan)}><Save className="mr-2 size-4" />发布预检</Button></div></div>
    {message ? <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{message}</div> : null}
    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <section className="space-y-4">
        {workspace.assets.length ? <Card><CardHeader><CardTitle className="text-base">PDF 分析</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{workspace.assets.map((asset) => <div key={asset.id} className="rounded border p-3 text-sm"><div className="font-medium">{asset.original_name}</div><div className="mt-1 text-muted-foreground">{asset.page_count} 页 · 文本 {asset.text_page_count} · 扫描 {asset.scanned_page_count} · {asset.analysis.pdf_profile ?? '未知'}</div></div>)}</CardContent></Card> : null}
        {workspace.books.map((book) => <Card key={book.id}><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="flex items-center gap-2 text-base"><BookOpen className="size-4" />{book.title}</CardTitle><Badge variant="outline">{book.gate_status}</Badge></div></CardHeader><CardContent className="space-y-2">{book.sections.map((section) => <div key={section.id} className={`rounded-md border p-3 ${selectedSectionId === section.id ? 'border-primary bg-primary/5' : ''}`} onClick={() => { setSelectedSectionId(section.id); setDraftText(JSON.stringify(section.drafts[0]?.content ?? {}, null, 2)) }}><div className="flex flex-wrap items-center gap-2"><Input className="min-w-48 flex-1" value={section.title} onChange={(event) => void patchSection(section, { title: event.target.value })} /><Input className="w-20" type="number" value={section.start_page} onChange={(event) => void patchSection(section, { start_page: Number(event.target.value) })} /><span>-</span><Input className="w-20" type="number" value={section.end_page} onChange={(event) => void patchSection(section, { end_page: Number(event.target.value) })} /><select className="h-9 rounded-md border bg-background px-2 text-sm" value={section.output_mode} onChange={(event) => void patchSection(section, { output_mode: event.target.value as OutputMode })}>{Object.entries(outputLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button size="sm" variant={book.representative_section_id === section.id ? 'default' : 'outline'} onClick={(event) => { event.stopPropagation(); void confirmBatchOutline(book.id, section.id).then(setWorkspace) }}>代表节</Button></div>{section.issues.map((issue) => <div key={issue.id} className="mt-2 flex items-center gap-2 text-xs text-amber-700"><AlertTriangle className="size-3" />{issue.message}</div>)}</div>)}</CardContent></Card>)}
      </section>
      <aside className="space-y-4">{selectedSection ? <><Card><CardHeader><CardTitle className="text-base">章节操作</CardTitle></CardHeader><CardContent className="space-y-3"><div className="text-sm"><strong>{selectedSection.title}</strong><div className="text-muted-foreground">第 {selectedSection.start_page}-{selectedSection.end_page} 页 · {outputLabels[selectedSection.output_mode]}</div></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void showPrompt('palace')}><FileSearch className="mr-2 size-4" />宫殿调用包</Button><Button variant="outline" onClick={() => void showPrompt('quiz')}><FileSearch className="mr-2 size-4" />题库调用包</Button>{selectedSection.existing_palace_id ? <Button asChild><Link to={`/palaces/${selectedSection.existing_palace_id}/edit`}>打开宫殿编辑器</Link></Button> : <Button asChild><Link to="/palaces/new">新建宫殿草稿</Link></Button>}</div></CardContent></Card><Card><CardHeader><CardTitle className="text-base">草稿编辑</CardTitle></CardHeader><CardContent className="space-y-3"><Label htmlFor="batch-draft">结构化草稿 JSON</Label><Textarea id="batch-draft" className="min-h-72 font-mono text-xs" value={draftText} onChange={(event) => setDraftText(event.target.value)} /><div className="flex gap-2"><Button onClick={() => void saveDraft('palace')}>保存宫殿草稿</Button><Button variant="outline" onClick={() => void saveDraft('quiz')}>保存题库草稿</Button></div></CardContent></Card></> : <Card><CardContent className="p-6 text-sm text-muted-foreground">选择一个章节查看调用包、编辑草稿和覆盖目标。</CardContent></Card>}{promptPreview ? <Card><CardHeader><CardTitle className="text-base">完整 AI 调用包</CardTitle></CardHeader><CardContent><pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{JSON.stringify(promptPreview, null, 2)}</pre></CardContent></Card> : null}{publishPlan ? <Card><CardHeader><CardTitle className="text-base">发布清单</CardTitle></CardHeader><CardContent><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{JSON.stringify(publishPlan, null, 2)}</pre></CardContent></Card> : null}</aside>
    </div>
  </main>
}
