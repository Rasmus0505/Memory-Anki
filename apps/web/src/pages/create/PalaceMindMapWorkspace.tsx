import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, FolderTree, LoaderCircle, Plus, Search } from 'lucide-react'
import {
  createSubjectApi,
  getSubjectEditorApi,
  getSubjectsApi,
  getSubjectTreeApi,
  saveSubjectEditorApi,
  type ChapterSummary,
  type SubjectSummary,
  type SubjectTree,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import { detectClientSource } from '@/shared/lib/clientSource'

export type MindMapDocumentTab = {
  key: string
  kind: 'palace' | 'subject'
  label: string
  subjectId?: number
}

interface PalaceKnowledgeWorkspaceProviderProps {
  palace: PalaceMeta
  activeKey: string
  onActiveKeyChange: (key: string) => void
  onReload: () => Promise<void>
  children: ReactNode
}

function operationId() {
  return globalThis.crypto?.randomUUID?.() ?? `binding-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function collectLinkedUids(node: MindMapNode, linkedIds: Set<number>, result: string[]) {
  const data = node.data ?? {}
  if (typeof data.memoryAnkiId === 'number' && linkedIds.has(data.memoryAnkiId) && typeof data.uid === 'string') result.push(data.uid)
  for (const child of node.children ?? []) collectLinkedUids(child, linkedIds, result)
}

function ChapterBindingNode({
  node,
  depth,
  explicitIds,
  busy,
  onToggle,
}: {
  node: ChapterSummary
  depth: number
  explicitIds: number[]
  busy: boolean
  onToggle: (chapterId: number, nextLinked: boolean, chapterName: string) => void
}) {
  const linked = explicitIds.includes(node.id)
  return (
    <div className="space-y-1">
      <label
        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <input
          type="checkbox"
          checked={linked}
          disabled={busy}
          onChange={() => onToggle(node.id, !linked, node.name)}
          aria-label={`关联章节 ${node.name}`}
        />
        <span className={linked ? 'font-medium text-foreground' : 'text-muted-foreground'}>{node.name}</span>
      </label>
      {(node.children ?? []).map((child) => (
        <ChapterBindingNode
          key={child.id}
          node={child}
          depth={depth + 1}
          explicitIds={explicitIds}
          busy={busy}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

type PalaceKnowledgeContextValue = {
  palace: PalaceMeta
  activeKey: string
  tabs: MindMapDocumentTab[]
  selectedSubjectId: number | null
  subjects: SubjectSummary[]
  explicitIds: number[]
  primaryId: number | null
  bindingBusy: boolean
  linkMode: boolean
  setLinkMode: (value: boolean | ((prev: boolean) => boolean)) => void
  fullscreen: boolean
  setFullscreen: (value: boolean | ((prev: boolean) => boolean)) => void
  uiCleared: boolean
  setUiCleared: (value: boolean) => void
  chapterTrees: SubjectTree[]
  chapterTreesLoading: boolean
  chapterLabelById: Map<number, string>
  explicitChapters: Array<{ id: number; label: string }>
  availableSubjects: SubjectSummary[]
  search: string
  setSearch: (value: string) => void
  newSubjectName: string
  setNewSubjectName: (value: string) => void
  creatingSubject: boolean
  switchDocument: (key: string) => Promise<void>
  saveBinding: (nextSubjectIds: number[], nextChapterIds: number[], nextPrimaryId: number | null) => Promise<void>
  toggleChapterBinding: (chapterId: number, nextLinked: boolean, chapterName?: string) => void
  addSubject: (subject: SubjectSummary) => void
  removeSubject: (subject: SubjectSummary) => void
  createSubject: () => Promise<void>
  handleNodeClick: (nodes: MindMapSelection[]) => void
  session: ReturnType<typeof useMindMapDocumentSession>
  highlightedNodeUids: string[]
  frameRef: MutableRefObject<MindMapEditorSurfaceHandle | null>
  isPwa: boolean
  chapterDialogOpen: boolean
  setChapterDialogOpen: (open: boolean) => void
}

const PalaceKnowledgeContext = createContext<PalaceKnowledgeContextValue | null>(null)

function usePalaceKnowledge() {
  const ctx = useContext(PalaceKnowledgeContext)
  if (!ctx) throw new Error('Palace knowledge workspace components must be used within PalaceKnowledgeWorkspaceProvider')
  return ctx
}

export function PalaceKnowledgeWorkspaceProvider({
  palace,
  activeKey,
  onActiveKeyChange,
  onReload,
  children,
}: PalaceKnowledgeWorkspaceProviderProps) {
  const isPwa = detectClientSource() === 'pwa'
  const frameRef = useRef<MindMapEditorSurfaceHandle | null>(null)
  const [allSubjects, setAllSubjects] = useState<SubjectSummary[]>([])
  const [subjects, setSubjects] = useState(palace.subjects ?? [])
  const [explicitIds, setExplicitIds] = useState(
    palace.explicit_chapter_ids
      ?? palace.chapters.filter((chapter) => chapter.is_explicit !== false).map((chapter) => chapter.id),
  )
  const [primaryId, setPrimaryId] = useState<number | null>(palace.primary_chapter_id ?? null)
  const [revision, setRevision] = useState(palace.binding_revision ?? 0)
  const [bindingBusy, setBindingBusy] = useState(false)
  const [linkMode, setLinkMode] = useState(false)
  const [search, setSearch] = useState('')
  const [newSubjectName, setNewSubjectName] = useState('')
  const [creatingSubject, setCreatingSubject] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [uiCleared, setUiCleared] = useState(false)
  const [chapterTrees, setChapterTrees] = useState<SubjectTree[]>([])
  const [chapterTreesLoading, setChapterTreesLoading] = useState(false)
  const [chapterDialogOpen, setChapterDialogOpen] = useState(false)

  useEffect(() => {
    // Editor meta must include subjects; if an older/incomplete payload omits the
    // field, keep the last known binding instead of wiping the UI after a save.
    if (palace.subjects !== undefined) {
      setSubjects(palace.subjects)
    }
    setExplicitIds(
      palace.explicit_chapter_ids
        ?? palace.chapters.filter((chapter) => chapter.is_explicit !== false).map((chapter) => chapter.id),
    )
    setPrimaryId(palace.primary_chapter_id ?? null)
    if (palace.binding_revision !== undefined) {
      setRevision(palace.binding_revision)
    }
  }, [palace])

  useEffect(() => {
    void getSubjectsApi().then(setAllSubjects).catch((error) => toast.error(error instanceof Error ? error.message : '加载学科失败。'))
  }, [])

  const subjectIdsKey = subjects.map((subject) => subject.id).sort((a, b) => a - b).join(',')

  useEffect(() => {
    if (!subjectIdsKey) {
      setChapterTrees([])
      return
    }
    let cancelled = false
    setChapterTreesLoading(true)
    const subjectIds = subjectIdsKey.split(',').map(Number)
    void Promise.all(subjectIds.map((subjectId) => getSubjectTreeApi(subjectId)))
      .then((trees) => {
        if (!cancelled) setChapterTrees(trees)
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : '加载学科章节树失败。')
      })
      .finally(() => {
        if (!cancelled) setChapterTreesLoading(false)
      })
    return () => { cancelled = true }
  }, [subjectIdsKey])

  const tabs = useMemo<MindMapDocumentTab[]>(() => [
    { key: 'palace', kind: 'palace', label: '宫殿图' },
    ...subjects.map((subject) => ({
      key: `subject:${subject.id}`,
      kind: 'subject' as const,
      label: subject.name,
      subjectId: subject.id,
    })),
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

  const saveBinding = useCallback(async (
    nextSubjectIds: number[],
    nextChapterIds: number[],
    nextPrimaryId: number | null,
  ) => {
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
  }, [bindingBusy, onReload, palace.id, revision])

  const chapterLabelById = useMemo(() => {
    const labels = new Map<number, string>()
    const walk = (nodes: ChapterSummary[], subjectName?: string) => {
      for (const node of nodes) {
        labels.set(node.id, subjectName ? `${subjectName} / ${node.name}` : node.name)
        walk(node.children ?? [], subjectName)
      }
    }
    for (const tree of chapterTrees) {
      walk(tree.chapters ?? [], tree.subject?.name)
    }
    for (const chapter of palace.chapters) {
      if (!labels.has(chapter.id)) {
        labels.set(chapter.id, chapter.subject?.name ? `${chapter.subject.name} / ${chapter.name}` : chapter.name)
      }
    }
    return labels
  }, [chapterTrees, palace.chapters])

  const handleNodeClick = useCallback((nodes: MindMapSelection[]) => {
    if (!linkMode) return
    const selected = nodes[0]
    if (selected?.memoryAnkiNodeType !== 'chapter' || selected.memoryAnkiId == null) return
    const chapterId = selected.memoryAnkiId
    const linked = explicitIds.includes(chapterId)
    if (linked && !window.confirm(`确定取消关联章节「${selected.text || chapterId}」吗？`)) return
    const nextIds = linked ? explicitIds.filter((id) => id !== chapterId) : [...explicitIds, chapterId]
    const nextPrimary = linked ? (primaryId === chapterId ? null : primaryId) : (primaryId ?? chapterId)
    void saveBinding(subjects.map((subject) => subject.id), nextIds, nextPrimary)
  }, [explicitIds, linkMode, primaryId, saveBinding, subjects])

  const toggleChapterBinding = useCallback((chapterId: number, nextLinked: boolean, chapterName?: string) => {
    if (bindingBusy) return
    const label = chapterName || chapterLabelById.get(chapterId) || `章节 #${chapterId}`
    if (!nextLinked && !window.confirm(`确定取消关联章节「${label}」吗？`)) return
    const nextIds = nextLinked
      ? (explicitIds.includes(chapterId) ? explicitIds : [...explicitIds, chapterId])
      : explicitIds.filter((id) => id !== chapterId)
    const nextPrimary = !nextLinked && primaryId === chapterId
      ? null
      : nextLinked
        ? (primaryId ?? chapterId)
        : primaryId
    void saveBinding(subjects.map((subject) => subject.id), nextIds, nextPrimary)
  }, [bindingBusy, chapterLabelById, explicitIds, primaryId, saveBinding, subjects])

  const addSubject = useCallback((subject: SubjectSummary) => {
    if (subjects.some((item) => item.id === subject.id)) {
      toast.info(`学科「${subject.name}」已关联。`)
      return
    }
    void saveBinding([...subjects.map((item) => item.id), subject.id], explicitIds, primaryId)
  }, [explicitIds, primaryId, saveBinding, subjects])

  const removeSubject = useCallback((subject: SubjectSummary) => {
    const affected = palace.chapters.filter(
      (chapter) => chapter.subject?.id === subject.id && chapter.is_explicit !== false,
    ).length
    if (!window.confirm(`确定移除学科「${subject.name}」吗？${affected ? ` 将同时取消 ${affected} 个章节关联。` : ''}`)) return
    void saveBinding(
      subjects.filter((item) => item.id !== subject.id).map((item) => item.id),
      explicitIds,
      primaryId,
    )
  }, [explicitIds, palace.chapters, primaryId, saveBinding, subjects])

  const createSubject = useCallback(async () => {
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
    } finally {
      setCreatingSubject(false)
    }
  }, [addSubject, creatingSubject, newSubjectName])

  const switchDocument = useCallback(async (key: string) => {
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
  }, [activeKey, onActiveKeyChange, selectedSubjectId, session])

  const explicitChapters = explicitIds.map((id) => ({
    id,
    label: chapterLabelById.get(id) ?? `章节 #${id}`,
  }))
  const availableSubjects = allSubjects.filter(
    (subject) =>
      !subjects.some((selected) => selected.id === subject.id)
      && subject.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  )

  const value = useMemo<PalaceKnowledgeContextValue>(() => ({
    palace,
    activeKey,
    tabs,
    selectedSubjectId,
    subjects,
    explicitIds,
    primaryId,
    bindingBusy,
    linkMode,
    setLinkMode,
    fullscreen,
    setFullscreen,
    uiCleared,
    setUiCleared,
    chapterTrees,
    chapterTreesLoading,
    chapterLabelById,
    explicitChapters,
    availableSubjects,
    search,
    setSearch,
    newSubjectName,
    setNewSubjectName,
    creatingSubject,
    switchDocument,
    saveBinding,
    toggleChapterBinding,
    addSubject,
    removeSubject,
    createSubject,
    handleNodeClick,
    session,
    highlightedNodeUids,
    frameRef,
    isPwa,
    chapterDialogOpen,
    setChapterDialogOpen,
  }), [
    activeKey,
    addSubject,
    availableSubjects,
    bindingBusy,
    chapterDialogOpen,
    chapterLabelById,
    chapterTrees,
    chapterTreesLoading,
    createSubject,
    creatingSubject,
    explicitChapters,
    explicitIds,
    fullscreen,
    handleNodeClick,
    highlightedNodeUids,
    isPwa,
    linkMode,
    newSubjectName,
    palace,
    primaryId,
    removeSubject,
    saveBinding,
    search,
    selectedSubjectId,
    session,
    subjects,
    switchDocument,
    tabs,
    toggleChapterBinding,
    uiCleared,
  ])

  return (
    <PalaceKnowledgeContext.Provider value={value}>
      {children}
    </PalaceKnowledgeContext.Provider>
  )
}

function ChapterBindingDialog() {
  const {
    subjects,
    explicitIds,
    bindingBusy,
    chapterTrees,
    chapterTreesLoading,
    toggleChapterBinding,
    chapterDialogOpen,
    setChapterDialogOpen,
  } = usePalaceKnowledge()

  return (
    <Dialog open={chapterDialogOpen} onOpenChange={setChapterDialogOpen}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>绑定章节</DialogTitle>
          <DialogDescription>
            勾选要关联到本宫殿的章节。也可在学科导图中开启「关联章节」模式点选节点。主章节用于宫殿默认名称来源。
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">在树中勾选或取消章节</span>
          <Badge variant="secondary">已选 {explicitIds.length}</Badge>
        </div>
        {subjects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-sm text-muted-foreground">
            请先关联至少一个学科，再选择章节。
          </div>
        ) : chapterTreesLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            正在加载章节树…
          </div>
        ) : chapterTrees.every((tree) => (tree.chapters ?? []).length === 0) ? (
          <div className="space-y-3 rounded-lg border border-dashed border-border/70 px-3 py-6 text-sm text-muted-foreground">
            <p>当前关联学科还没有章节。请先编辑学科思维导图生成章节结构。</p>
            <Button asChild type="button" size="sm" variant="outline">
              <Link to={subjects[0] ? `/knowledge?subjectId=${subjects[0].id}` : '/knowledge'}>
                去编辑学科思维导图
              </Link>
            </Button>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-md border border-border/60 bg-background/80 p-2">
            {chapterTrees.map((tree) => (
              <div key={tree.subject?.id ?? 'subject'} className="space-y-1">
                <div className="px-2 text-xs font-semibold text-muted-foreground">
                  {tree.subject?.name || '未命名学科'}
                </div>
                {(tree.chapters ?? []).map((node) => (
                  <ChapterBindingNode
                    key={node.id}
                    node={node}
                    depth={0}
                    explicitIds={explicitIds}
                    busy={bindingBusy}
                    onToggle={toggleChapterBinding}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Left sidebar: compact subject/chapter binding controls. */
export function PalaceKnowledgeBindingCard() {
  const {
    activeKey,
    tabs,
    selectedSubjectId,
    subjects,
    explicitIds,
    primaryId,
    bindingBusy,
    chapterLabelById,
    explicitChapters,
    availableSubjects,
    search,
    setSearch,
    newSubjectName,
    setNewSubjectName,
    creatingSubject,
    switchDocument,
    saveBinding,
    addSubject,
    removeSubject,
    createSubject,
    setChapterDialogOpen,
  } = usePalaceKnowledge()

  const summaryLabels = explicitChapters.slice(0, 3)
  const extraCount = Math.max(0, explicitChapters.length - summaryLabels.length)

  return (
    <>
      <Card className="border-border/70 bg-card/92">
        <CardHeader className="space-y-2 p-4 pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <FolderTree className="size-4" />
              学科与思维导图
            </span>
            <Button asChild type="button" size="sm" variant="outline">
              <Link to={selectedSubjectId ? `/knowledge?subjectId=${selectedSubjectId}` : '/knowledge'}>
                <ExternalLink className="mr-1.5 size-3.5" />
                打开学科编辑
              </Link>
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-2">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <Button
                key={tab.key}
                type="button"
                size="sm"
                variant={activeKey === tab.key ? 'default' : 'outline'}
                onClick={() => { void switchDocument(tab.key) }}
              >
                {tab.label}
              </Button>
            ))}
            {bindingBusy ? (
              <Badge variant="secondary">
                <LoaderCircle className="mr-1 size-3 animate-spin" />
                保存关联
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {subjects.map((subject) => (
              <Badge key={subject.id} variant="secondary" className="gap-2" style={{ borderColor: subject.color }}>
                <Link to={`/knowledge?subjectId=${subject.id}`} className="hover:underline" title="编辑该学科思维导图">
                  {subject.name}
                </Link>
                <button type="button" aria-label={`移除学科 ${subject.name}`} onClick={() => removeSubject(subject)}>×</button>
              </Badge>
            ))}
            {subjects.length === 0 ? (
              <span className="text-xs text-muted-foreground">尚未关联学科</span>
            ) : null}
          </div>

          <div className="space-y-2 rounded-lg border border-border/70 bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">绑定章节</div>
              <Badge variant="secondary">已选 {explicitIds.length}</Badge>
            </div>
            {explicitChapters.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {summaryLabels.map((chapter) => (
                  <Badge key={chapter.id} variant="outline" className="max-w-full truncate font-normal">
                    {chapterLabelById.get(chapter.id) ?? chapter.label}
                  </Badge>
                ))}
                {extraCount > 0 ? (
                  <Badge variant="secondary">+{extraCount}</Badge>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                尚未绑定章节。打开弹窗勾选，或在学科导图中用「关联章节」点选。
              </p>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setChapterDialogOpen(true)}
            >
              管理章节绑定
            </Button>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">主章节（名称来源）</span>
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={primaryId ?? ''}
              onChange={(event) => {
                const value = event.target.value ? Number(event.target.value) : null
                void saveBinding(subjects.map((subject) => subject.id), explicitIds, value)
              }}
            >
              <option value="">自动选择</option>
              {explicitChapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>{chapter.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索并添加现有学科"
                className="pl-9"
              />
            </div>
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value=""
              onChange={(event) => {
                const subject = availableSubjects.find((item) => item.id === Number(event.target.value))
                if (subject) addSubject(subject)
              }}
            >
              <option value="">选择学科…</option>
              {availableSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <Input
                value={newSubjectName}
                onChange={(event) => setNewSubjectName(event.target.value)}
                placeholder="新建学科"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                disabled={!newSubjectName.trim() || creatingSubject}
                onClick={() => void createSubject()}
                aria-label="新建并添加学科"
                title="新建并添加"
              >
                {creatingSubject ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <ChapterBindingDialog />
    </>
  )
}

/** Right pane: subject mind-map when a subject document tab is active. */
export function PalaceSubjectMindMapCard({
  className,
  surfaceClassName,
}: {
  className?: string
  surfaceClassName?: string
}) {
  const {
    palace,
    selectedSubjectId,
    explicitIds,
    primaryId,
    linkMode,
    setLinkMode,
    fullscreen,
    setFullscreen,
    uiCleared,
    setUiCleared,
    session,
    highlightedNodeUids,
    handleNodeClick,
    frameRef,
    isPwa,
  } = usePalaceKnowledge()

  if (selectedSubjectId == null) return null

  return (
    <Card
      className={cn(
        'flex min-h-0 flex-1 flex-col border-border/70 bg-card/92',
        fullscreen && 'fixed inset-x-5 bottom-5 top-5 z-[90] min-h-0 bg-card/96 shadow-2xl',
        className,
      )}
    >
      <CardContent
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-3 p-4',
          fullscreen && 'h-full',
        )}
      >
        <MindMapPageToolbar
          compact
          modeToggle={{
            label: linkMode ? '退出关联章节' : '关联章节',
            onClick: () => setLinkMode((value) => !value),
          }}
          immersiveAction={{
            label: fullscreen ? '退出沉浸' : '沉浸编辑',
            active: fullscreen,
            onClick: () => setFullscreen((value) => !value),
          }}
          nativeFullscreenAction={{
            label: '全屏编辑',
            active: false,
            onClick: () => { void frameRef.current?.enterFullscreen() },
          }}
          clearUiAction={{
            label: uiCleared ? '恢复界面' : '清屏',
            active: uiCleared,
            onClick: () => frameRef.current?.toggleUiCleared(),
          }}
        />
        {linkMode ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            关联模式：点击章节节点进行勾选或取消；每次取消都会确认。已关联 {explicitIds.length} 个章节，主章节 ID：{primaryId ?? '未指定'}。
          </div>
        ) : null}
        {session.editorState ? (
          <MindMapEditorSurface
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
            className={cn(
              'min-h-0 w-full flex-1 rounded-lg border border-border/70 bg-background',
              surfaceClassName,
            )}
          />
        ) : (
          <div className="flex min-h-[420px] flex-1 items-center justify-center text-sm text-muted-foreground">
            正在加载学科思维导图…
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * @deprecated Prefer PalaceKnowledgeWorkspaceProvider + PalaceKnowledgeBindingCard.
 * Kept as a thin alias for any residual imports.
 */
export function PalaceMindMapWorkspace(props: Omit<PalaceKnowledgeWorkspaceProviderProps, 'children'>) {
  return (
    <PalaceKnowledgeWorkspaceProvider {...props}>
      <PalaceKnowledgeBindingCard />
    </PalaceKnowledgeWorkspaceProvider>
  )
}
