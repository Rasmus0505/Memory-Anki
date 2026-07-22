import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderTree, LoaderCircle, Plus, Search } from 'lucide-react'
import {
  createSubjectApi,
  getSubjectEditorApi,
  getSubjectsApi,
  saveSubjectEditorApi,
  type SubjectSummary,
} from '@/modules/content/public'
import { readMindMapEditorState, parseMindMapDocument, type MindMapNode, type MindMapSelection } from '@/modules/content/public'
import { updatePalaceKnowledgeBindingApi } from '@/modules/content/public'
import type { PalaceMeta } from '@/modules/content/public'
import { MindMapEditorSurface, MindMapPageToolbar, type MindMapEditorSurfaceHandle } from '@/modules/content/public'
import { useMindMapDocumentSession } from '@/shared/hooks/useMindMapDocumentSession'
import { toast } from '@/shared/feedback/toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { detectClientSource } from '@/shared/lib/clientSource'

export type MindMapDocumentTab = {
  key: string
  kind: 'palace' | 'subject'
  label: string
  subjectId?: number
}

interface PalaceMindMapWorkspaceProps {
  palace: PalaceMeta
  activeKey: string
  onActiveKeyChange: (key: string) => void
  onReload: () => Promise<void>
}

function operationId() {
  return globalThis.crypto?.randomUUID?.() ?? `binding-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function collectLinkedUids(node: MindMapNode, linkedIds: Set<number>, result: string[]) {
  const data = node.data ?? {}
  if (typeof data.memoryAnkiId === 'number' && linkedIds.has(data.memoryAnkiId) && typeof data.uid === 'string') result.push(data.uid)
  for (const child of node.children ?? []) collectLinkedUids(child, linkedIds, result)
}

export function PalaceMindMapWorkspace({ palace, activeKey, onActiveKeyChange, onReload }: PalaceMindMapWorkspaceProps) {
  const isPwa = detectClientSource() === 'pwa'
  const frameRef = useRef<MindMapEditorSurfaceHandle | null>(null)
  const [allSubjects, setAllSubjects] = useState<SubjectSummary[]>([])
  const [subjects, setSubjects] = useState(palace.subjects ?? [])
  const [explicitIds, setExplicitIds] = useState(palace.explicit_chapter_ids ?? palace.chapters.filter((chapter) => chapter.is_explicit !== false).map((chapter) => chapter.id))
  const [primaryId, setPrimaryId] = useState<number | null>(palace.primary_chapter_id ?? null)
  const [revision, setRevision] = useState(palace.binding_revision ?? 0)
  const [bindingBusy, setBindingBusy] = useState(false)
  const [linkMode, setLinkMode] = useState(false)
  const [search, setSearch] = useState('')
  const [newSubjectName, setNewSubjectName] = useState('')
  const [creatingSubject, setCreatingSubject] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [uiCleared, setUiCleared] = useState(false)

  useEffect(() => {
    // Editor meta must include subjects; if an older/incomplete payload omits the
    // field, keep the last known binding instead of wiping the UI after a save.
    if (palace.subjects !== undefined) {
      setSubjects(palace.subjects)
    }
    setExplicitIds(palace.explicit_chapter_ids ?? palace.chapters.filter((chapter) => chapter.is_explicit !== false).map((chapter) => chapter.id))
    setPrimaryId(palace.primary_chapter_id ?? null)
    if (palace.binding_revision !== undefined) {
      setRevision(palace.binding_revision)
    }
  }, [palace])

  useEffect(() => {
    void getSubjectsApi().then(setAllSubjects).catch((error) => toast.error(error instanceof Error ? error.message : '加载学科失败。'))
  }, [])

  const tabs = useMemo<MindMapDocumentTab[]>(() => [
    { key: 'palace', kind: 'palace', label: '宫殿图' },
    ...subjects.map((subject) => ({ key: `subject:${subject.id}`, kind: 'subject' as const, label: subject.name, subjectId: subject.id })),
  ], [subjects])
  const selectedSubjectId = activeKey.startsWith('subject:') ? Number(activeKey.slice(8)) : null

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeKey)) onActiveKeyChange('palace')
  }, [activeKey, onActiveKeyChange, tabs])

  const session = useMindMapDocumentSession({
    entityId: selectedSubjectId,
    loadCacheKey: 'palace-subject-mindmap',
    adapter: {
      load: getSubjectEditorApi,
      save: saveSubjectEditorApi,
      selectMeta: (response) => response.subject,
      selectEditorState: readMindMapEditorState,
    },
  })

  const highlightedNodeUids = useMemo(() => {
    if (!session.editorState) return []
    const document = parseMindMapDocument(session.editorState.editor_doc)
    const result: string[] = []
    collectLinkedUids(document.root, new Set(explicitIds), result)
    return result
  }, [explicitIds, session.editorState])

  const saveBinding = async (nextSubjectIds: number[], nextChapterIds: number[], nextPrimaryId: number | null) => {
    if (bindingBusy) return
    setBindingBusy(true)
    try {
      const response = await updatePalaceKnowledgeBindingApi(palace.id, {
        subject_ids: nextSubjectIds,
        chapter_ids: nextChapterIds,
        primary_chapter_id: nextPrimaryId,
        base_revision: revision,
        operation_id: operationId(),
      })
      setSubjects(response.subjects)
      setExplicitIds(response.explicit_chapter_ids)
      setPrimaryId(response.primary_chapter_id)
      setRevision(response.binding_revision)
      await onReload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存学科与章节关联失败。')
      try {
        await onReload()
      } catch {
        // Keep the last successful local binding state if reload also fails.
      }
    } finally {
      setBindingBusy(false)
    }
  }

  const handleNodeClick = (nodes: MindMapSelection[]) => {
    if (!linkMode) return
    const selected = nodes[0]
    if (selected?.memoryAnkiNodeType !== 'chapter' || selected.memoryAnkiId == null) return
    const chapterId = selected.memoryAnkiId
    const linked = explicitIds.includes(chapterId)
    if (linked && !window.confirm(`确定取消关联章节「${selected.text || chapterId}」吗？`)) return
    const nextIds = linked ? explicitIds.filter((id) => id !== chapterId) : [...explicitIds, chapterId]
    const nextPrimary = linked ? (primaryId === chapterId ? null : primaryId) : chapterId
    void saveBinding(subjects.map((subject) => subject.id), nextIds, nextPrimary)
  }

  const addSubject = (subject: SubjectSummary) => {
    if (subjects.some((item) => item.id === subject.id)) {
      toast.info(`学科「${subject.name}」已关联。`)
      return
    }
    void saveBinding([...subjects.map((item) => item.id), subject.id], explicitIds, primaryId)
  }

  const removeSubject = (subject: SubjectSummary) => {
    const affected = palace.chapters.filter((chapter) => chapter.subject?.id === subject.id && chapter.is_explicit !== false).length
    if (!window.confirm(`确定移除学科「${subject.name}」吗？${affected ? ` 将同时取消 ${affected} 个章节关联。` : ''}`)) return
    void saveBinding(subjects.filter((item) => item.id !== subject.id).map((item) => item.id), explicitIds, primaryId)
  }

  const createSubject = async () => {
    const name = newSubjectName.trim()
    if (!name || creatingSubject) return
    setCreatingSubject(true)
    try {
      const subject = await createSubjectApi({ name, color: '#6366f1' })
      setAllSubjects((current) => [...current, subject])
      setNewSubjectName('')
      addSubject(subject)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建学科失败。')
    } finally { setCreatingSubject(false) }
  }

  const switchDocument = async (key: string) => {
    if (key === activeKey) return
    if (selectedSubjectId != null && session.hasUnsavedChanges) {
      try {
        await session.flushSave()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '当前思维导图尚未保存，暂不切换。')
        return
      }
    }
    onActiveKeyChange(key)
  }

  const explicitChapters = palace.chapters.filter((chapter) => explicitIds.includes(chapter.id))
  const availableSubjects = allSubjects.filter((subject) => !subjects.some((selected) => selected.id === subject.id) && subject.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  return (
    <div className="space-y-3">
      <Card className="border-border/70 bg-card/92">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FolderTree className="size-4" />学科与思维导图</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => <Button key={tab.key} type="button" size="sm" variant={activeKey === tab.key ? 'default' : 'outline'} onClick={() => { void switchDocument(tab.key) }}>{tab.label}</Button>)}
            {bindingBusy ? <Badge variant="secondary"><LoaderCircle className="mr-1 size-3 animate-spin" />保存关联</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {subjects.map((subject) => <Badge key={subject.id} variant="secondary" className="gap-2" style={{ borderColor: subject.color }}>
              {subject.name}<button type="button" aria-label={`移除学科 ${subject.name}`} onClick={() => removeSubject(subject)}>×</button>
            </Badge>)}
          </div>
          <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
            <span className="text-sm text-muted-foreground">主章节（名称来源）</span>
            <select className="h-9 rounded-md border bg-background px-3 text-sm" value={primaryId ?? ''} onChange={(event) => { const value = event.target.value ? Number(event.target.value) : null; void saveBinding(subjects.map((subject) => subject.id), explicitIds, value) }}>
              <option value="">自动选择</option>
              {explicitChapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.subject?.name ? `${chapter.subject.name} / ` : ''}{chapter.name}</option>)}
            </select>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto]">
            <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索并添加现有学科" className="pl-9" /></div>
            <select className="h-9 rounded-md border bg-background px-3 text-sm" value="" onChange={(event) => { const subject = allSubjects.find((item) => item.id === Number(event.target.value)); if (subject) addSubject(subject) }}>
              <option value="">选择学科…</option>{availableSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
            <Input value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} placeholder="新建学科" />
            <Button type="button" variant="outline" disabled={!newSubjectName.trim() || creatingSubject} onClick={() => void createSubject()}><Plus className="mr-2 size-4" />新建并添加</Button>
          </div>
        </CardContent>
      </Card>

      {selectedSubjectId != null ? (
        <Card className="border-border/70 bg-card/92">
          <CardContent className="space-y-3 p-4">
            <MindMapPageToolbar
              compact
              modeToggle={{ label: linkMode ? '退出关联章节' : '关联章节', onClick: () => setLinkMode((value) => !value) }}
              immersiveAction={{ label: fullscreen ? '退出沉浸' : '沉浸编辑', active: fullscreen, onClick: () => setFullscreen((value) => !value) }}
              nativeFullscreenAction={{ label: '全屏编辑', active: false, onClick: () => { void frameRef.current?.enterFullscreen() } }}
              clearUiAction={{ label: uiCleared ? '恢复界面' : '清屏', active: uiCleared, onClick: () => frameRef.current?.toggleUiCleared() }}
            />
            {linkMode ? <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">关联模式：点击章节节点进行勾选或取消；每次取消都会确认。已关联 {explicitIds.length} 个章节，主章节 ID：{primaryId ?? '未指定'}。</div> : null}
            {session.editorState ? <MindMapEditorSurface
              ref={frameRef}
              key={`palace-subject:${selectedSubjectId}`}
              editorState={session.editorState}
              sceneChrome="edit"
              presentationStrategy={isPwa ? 'viewport-only' : 'native-preferred'}
              highlightedNodeUids={highlightedNodeUids}
              immersiveModeActive={fullscreen}
              viewMemoryScope={`palace:${palace.id}:subject:${selectedSubjectId}`}
              syncOnPropChange
              onEditorStateChange={session.setEditorState}
              onNodeClick={handleNodeClick}
              onFullscreenChange={setFullscreen}
              onUiClearedChange={setUiCleared}
              className="h-[72vh] w-full rounded-lg border border-border/70 bg-background"
            /> : <div className="flex h-[50vh] items-center justify-center text-sm text-muted-foreground">正在加载学科思维导图…</div>}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
