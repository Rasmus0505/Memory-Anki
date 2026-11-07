import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ExternalLink, LoaderCircle, Plus, Search } from 'lucide-react'
import { createSubjectApi, getSubjectsApi, type SubjectSummary } from '@/modules/content/public'
import { toast } from '@/shared/feedback/toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { cn } from '@/shared/lib/utils'

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
      const subject = await createSubjectApi({ name, color: '#2f6b63' })
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
    <Card>
      <CardContent className="flex flex-col gap-6 p-5 sm:p-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-palace-title">宫殿名</Label>
          <Input id="new-palace-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：教育心理学核心理论" autoFocus className="h-10 text-[15px]" />
          <div className="text-xs text-muted-foreground">首次关联主章节后名称会跟随主章节；手动改名后转为手动名称。</div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>
              所属学科
              <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">已选 {selectedIds.length}</span>
            </Label>
            <Button asChild type="button" size="sm" variant="ghost" className="-mr-2 text-muted-foreground">
              <Link to="/knowledge">
                <ExternalLink className="size-3.5" />
                管理学科思维导图
              </Link>
            </Button>
          </div>
          <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索学科" className="pl-9" /></div>
          <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
            {loading ? <div className="text-sm text-muted-foreground">正在加载学科…</div> : filtered.map((subject) => {
              const selected = selectedIds.includes(subject.id)
              return (
                <div
                  key={subject.id}
                  className={cn(
                    'group/subject flex items-center gap-1 rounded-lg border pr-1 transition-[background-color,border-color] duration-200',
                    selected ? 'border-primary/40 bg-primary-soft' : 'border-border/80 hover:border-foreground/20 hover:bg-accent/60',
                  )}
                >
                  <button
                    type="button"
                    data-testid={`select-subject-${subject.id}`}
                    onClick={() => toggleSubject(subject.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm"
                    aria-pressed={selected}
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card',
                      )}
                      aria-hidden
                    >
                      {selected ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: subject.color || '#2f6b63' }} />
                    <span className={cn('truncate', selected && 'font-medium')}>{subject.name}</span>
                  </button>
                  {/* Secondary action: quiet until the row is hovered or focused. */}
                  <Button asChild type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover/subject:opacity-100 sm:focus-visible:opacity-100">
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
          <div className="flex gap-2">
            <Input value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} placeholder="即时新建学科" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createSubject() } }} />
            <Button type="button" variant="outline" disabled={!newSubjectName.trim() || creatingSubject} onClick={() => void createSubject()}>
              {creatingSubject ? <LoaderCircle className="animate-spin" /> : <Plus />}新建并选择
            </Button>
          </div>
        </div>
        <Button size="lg" className="w-full" disabled={busy || !title.trim() || selectedIds.length === 0} onClick={submit}>
          {busy ? <LoaderCircle className="animate-spin" /> : null}创建并进入编辑器
        </Button>
      </CardContent>
    </Card>
  )
}
