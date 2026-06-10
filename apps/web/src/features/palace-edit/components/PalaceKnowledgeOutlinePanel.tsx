import { useEffect, useMemo, useState } from 'react'
import type { ChapterOption, PalaceMeta } from '@/features/palace-edit/hooks/usePalaceEditPage'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { getSubjectEditorApi, saveSubjectEditorApi } from '@/shared/api/modules/knowledge'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { usePersistedMindMapEditor } from '@/shared/hooks/usePersistedMindMapEditor'

interface PalaceKnowledgeOutlinePanelProps {
  palace: PalaceMeta | null
  explicitChapterIds: number[]
  chapterOptions: ChapterOption[]
}

interface SubjectMeta {
  id: number
  name: string
  color: string
}

function flattenChapterOptions(options: ChapterOption[]): ChapterOption[] {
  return options.flatMap((option) => [option, ...flattenChapterOptions(option.children)])
}

export function PalaceKnowledgeOutlinePanel({
  palace,
  explicitChapterIds,
  chapterOptions,
}: PalaceKnowledgeOutlinePanelProps) {
  const flatOptions = useMemo(() => flattenChapterOptions(chapterOptions), [chapterOptions])
  const availableSubjects = useMemo(() => {
    const seen = new Map<number, { id: number; name: string }>()
    for (const option of flatOptions) {
      if (explicitChapterIds.includes(option.id) && option.subjectId != null && !seen.has(option.subjectId)) {
        seen.set(option.subjectId, { id: option.subjectId, name: option.subjectName })
      }
    }
    return Array.from(seen.values())
  }, [explicitChapterIds, flatOptions])
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null)

  useEffect(() => {
    if (availableSubjects.length === 0) {
      setSelectedSubjectId(null)
      return
    }
    setSelectedSubjectId((current) =>
      current != null && availableSubjects.some((subject) => subject.id === current)
        ? current
        : availableSubjects[0].id,
    )
  }, [availableSubjects])

  const {
    meta,
    editorState,
    setEditorState,
    isSaving,
    error,
  } = usePersistedMindMapEditor({
    entityId: selectedSubjectId,
    fetcher: getSubjectEditorApi,
    saver: saveSubjectEditorApi,
    selectMeta: (response) => response.subject as SubjectMeta,
    selectEditorState: (response) => ({
      editor_doc: response.editor_doc,
      editor_config: response.editor_config,
      editor_local_config: response.editor_local_config,
      lang: response.lang,
      editor_fingerprint: response.editor_fingerprint,
    }),
  })

  const statusLabel = useMemo(() => {
    if (error) return <Badge variant="destructive">保存异常</Badge>
    if (!editorState) return <Badge variant="secondary">加载中</Badge>
    if (isSaving) return <Badge variant="secondary">自动保存中</Badge>
    return <Badge variant="secondary">与知识树同步</Badge>
  }, [editorState, error, isSaving])

  return (
    <Card className="border-border/70 bg-card/92">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base">知识大纲</CardTitle>
          <div className="text-sm text-muted-foreground">
            这里直接编辑知识树正式大纲，会和知识大纲页面保持同步。
          </div>
        </div>
        {statusLabel}
      </CardHeader>
      <CardContent className="space-y-4">
        {availableSubjects.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {availableSubjects.map((subject) => (
                <button
                  key={subject.id}
                  type="button"
                  onClick={() => setSelectedSubjectId(subject.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    selectedSubjectId === subject.id
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border/70 bg-background/70 text-muted-foreground'
                  }`}
                >
                  {subject.name}
                </button>
              ))}
              {meta ? <Badge variant="outline">当前编辑：{meta.name}</Badge> : null}
            </div>

            {editorState ? (
              <MindMapFrame
                key={`subject-outline-${selectedSubjectId}`}
                editorState={editorState}
                syncOnPropChange
                onEditorStateChange={(nextState: MindMapEditorState) => {
                  setEditorState(nextState)
                }}
                className="h-[52vh] w-full rounded-2xl border border-border/70 bg-white"
              />
            ) : (
              <div className="flex h-[52vh] items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/60 text-sm text-muted-foreground">
                正在加载知识大纲编辑器…
              </div>
            )}
          </>
        ) : (
          <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/60 px-6 text-center text-sm text-muted-foreground">
            {palace
              ? '先在左侧章节关联里勾选至少一个小节，下方才会加载对应学科的知识大纲。'
              : '当前宫殿还未加载完成。'}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
