import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, LoaderCircle, Plus, Search } from 'lucide-react'
import { createSubjectApi, getSubjectsApi, type SubjectSummary } from '@/modules/content/public'
import { toast } from '@/shared/feedback/toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'

interface PalaceCreateSetupProps {
  busy: boolean
  onCreate: (options: { title: string; subjectIds: number[] }) => Promise<void> | void
}

export function PalaceCreateSetup({ busy, onCreate }: PalaceCreateSetupProps) {
  const [title, setTitle] = useState('')
  const [subjects, setSubjects] = useState<SubjectSummary[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [search, setSearch] = useState('')
  const [newSubjectName, setNewSubjectName] = useState('')
  const [loading, setLoading] = useState(true)
  const [creatingSubject, setCreatingSubject] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getSubjectsApi()
      .then((items) => { if (!cancelled) setSubjects(items) })
      .catch((error) => toast.error(error instanceof Error ? error.message : '加载学科失败。'))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    return keyword ? subjects.filter((subject) => subject.name.toLocaleLowerCase().includes(keyword)) : subjects
  }, [search, subjects])

  const toggleSubject = (id: number) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const createSubject = async () => {
    const name = newSubjectName.trim()
    if (!name || creatingSubject) return
    setCreatingSubject(true)
    try {
      const subject = await createSubjectApi({ name, color: '#6366f1' })
      setSubjects((current) => [...current, subject].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name) || a.id - b.id))
      setSelectedIds((current) => current.includes(subject.id) ? current : [...current, subject.id])
      setNewSubjectName('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建学科失败。')
    } finally {
      setCreatingSubject(false)
    }
  }

  const submit = () => {
    const nextTitle = title.trim()
    if (!nextTitle) return toast.warning('请先填写宫殿名。')
    if (selectedIds.length === 0) return toast.warning('请至少选择一个所属学科。')
    void onCreate({ title: nextTitle, subjectIds: selectedIds })
  }

  return (
    <Card className="border-border/70 bg-card/92">
      <CardHeader><CardTitle>创建宫殿</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="new-palace-title">宫殿名</Label>
          <Input id="new-palace-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：教育心理学核心理论" autoFocus />
          <div className="text-xs text-muted-foreground">首次关联主章节后名称会跟随主章节；手动改名后转为手动名称。</div>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label>所属学科（可多选）</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">已选 {selectedIds.length}</Badge>
              <Button asChild type="button" size="sm" variant="outline">
                <Link to="/knowledge">
                  <ExternalLink className="mr-1.5 size-3.5" />
                  管理学科思维导图
                </Link>
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            宫殿会绑定学科，并在编辑器中再落到具体章节。可先在学科思维导图里维护章节结构。
          </div>
          <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索学科" className="pl-9" /></div>
          <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
            {loading ? <div className="text-sm text-muted-foreground">正在加载学科…</div> : filtered.map((subject) => {
              const selected = selectedIds.includes(subject.id)
              return (
                <div
                  key={subject.id}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-2 ${selected ? 'border-primary/50 bg-primary/10' : 'border-border/70 bg-background/60'}`}
                >
                  <button
                    type="button"
                    data-testid={`select-subject-${subject.id}`}
                    onClick={() => toggleSubject(subject.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-1 py-1 text-left"
                    aria-pressed={selected}
                  >
                    <input type="checkbox" checked={selected} readOnly tabIndex={-1} aria-hidden="true" />
                    <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: subject.color || '#6366f1' }} />
                    <span className="truncate font-medium">{subject.name}</span>
                  </button>
                  <Button asChild type="button" size="sm" variant="ghost" className="shrink-0 px-2">
                    <Link
                      to={`/knowledge?subjectId=${subject.id}`}
                      aria-label={`编辑学科思维导图 ${subject.name}`}
                      title="编辑该学科的章节思维导图"
                    >
                      编辑导图
                    </Link>
                  </Button>
                </div>
              )
            })}
          </div>
          <div className="flex gap-2 rounded-lg border border-dashed border-border/80 p-3">
            <Input value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} placeholder="即时新建学科" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createSubject() } }} />
            <Button type="button" variant="outline" disabled={!newSubjectName.trim() || creatingSubject} onClick={() => void createSubject()}>
              {creatingSubject ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}新建并选择
            </Button>
          </div>
        </div>
        <Button className="w-full" disabled={busy || !title.trim() || selectedIds.length === 0} onClick={submit}>
          {busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}创建并进入编辑器
        </Button>
      </CardContent>
    </Card>
  )
}
