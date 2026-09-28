import { useCallback, useEffect, useState } from 'react'
import type { SubjectSummary } from '@/shared/api/contracts'
import { getPalaceEditorApi, getSubjectsApi } from '@/modules/content/public'
import { ExamWarRoomView, parseDoc, useExamOverview } from '@/modules/exam/public'
import { ErrorState, LoadingState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'

export default function ExamWarRoomPage() {
  const { data, error, reload } = useExamOverview()
  const [subjects, setSubjects] = useState<SubjectSummary[]>([])
  const loadDoc = useCallback(async (palaceId: number) => parseDoc((await getPalaceEditorApi(palaceId)).editor_doc), [])

  useEffect(() => {
    let cancelled = false
    void getSubjectsApi()
      .then((rows) => {
        if (!cancelled) {
          setSubjects(rows.map((row) => ({ id: row.id, name: row.name, color: row.color ?? 'var(--color-primary)' })))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  if (!data && error) {
    return (
      <ErrorState
        title="考试作战室加载失败"
        description={error}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
            重新加载
          </Button>
        }
      />
    )
  }
  if (!data) return <LoadingState text="正在汇总全局掌握度…" />
  return <ExamWarRoomView overview={data} subjects={subjects} onChanged={() => void reload()} loadDoc={loadDoc} />
}
