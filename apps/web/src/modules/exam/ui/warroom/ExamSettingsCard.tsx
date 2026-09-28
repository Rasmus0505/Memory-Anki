import { useEffect, useRef, useState } from 'react'
import type { ExamOverview, SubjectSummary } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { saveExamSettingsApi, setSubjectShareApi } from '../../api/examApi'

interface ExamSettingsCardProps {
  overview: ExamOverview
  subjects: SubjectSummary[]
  onSaved: () => void
}

export function ExamSettingsCard({ overview, subjects, onSaved }: ExamSettingsCardProps) {
  const [name, setName] = useState(overview.settings.exam_name)
  const [examDate, setExamDate] = useState(overview.settings.exam_date ?? '')
  const [subjectIds, setSubjectIds] = useState<number[]>(overview.settings.subject_ids)
  const [shares, setShares] = useState<Record<number, string>>({})
  const [status, setStatus] = useState<string | null>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    const next: Record<number, string> = {}
    for (const row of overview.subjects) next[row.id] = row.exam_share == null ? '' : String(row.exam_share)
    setShares((current) => ({ ...next, ...current }))
  }, [overview.subjects])

  const toggleSubject = (id: number) =>
    setSubjectIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))

  const save = async () => {
    const token = ++tokenRef.current
    setStatus('保存中…')
    try {
      await saveExamSettingsApi({ exam_name: name, exam_date: examDate || null, subject_ids: subjectIds })
      await Promise.all(
        Object.entries(shares).map(([id, raw]) => setSubjectShareApi(Number(id), raw.trim() === '' ? null : Number(raw))),
      )
      if (token !== tokenRef.current) return
      setStatus('已保存')
      onSaved()
    } catch (caught) {
      if (token !== tokenRef.current) return
      setStatus(caught instanceof Error ? caught.message : '保存失败')
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          考试名称
          <Input value={name} maxLength={80} placeholder="例如：考研" onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          考试日期
          <Input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm">
          考试学科与大纲分值占比 <span className="text-xs text-muted-foreground">（不勾选 = 全部学科；占比留空 = 平均分配）</span>
        </legend>
        {subjects.map((subject) => (
          <div key={subject.id} className="flex items-center gap-3 text-sm">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <input type="checkbox" checked={subjectIds.includes(subject.id)} onChange={() => toggleSubject(subject.id)} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: subject.color }} aria-hidden="true" />
              <span className="truncate">{subject.name}</span>
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Input
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                className="h-8 w-20"
                aria-label={`${subject.name} 分值占比`}
                value={shares[subject.id] ?? ''}
                onChange={(event) => setShares((current) => ({ ...current, [subject.id]: event.target.value }))}
              />
              %
            </label>
          </div>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm">保存考试设置</Button>
        <span role="status" className="text-xs text-muted-foreground">{status}</span>
      </div>
    </form>
  )
}
