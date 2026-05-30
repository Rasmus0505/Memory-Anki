import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { type RevealState } from '@/entities/session/model'
import { useBilinkOverlay } from '@/features/bilink'
import { useBilinkCounts } from '@/features/bilink/hooks/useBilinkCounts'
import { useBilinks } from '@/features/bilink/hooks/useBilinks'
import type { BilinkNodeContext } from '@/shared/api/contracts'
import {
  allNodesRevealed,
  buildInitialRevealState,
  buildReviewTree,
  buildSelectionNodeId,
  buildVisibleEditorState,
  findNextHiddenChild,
  flattenNodes,
  hideNodeAndDescendants,
} from '@/features/review/model/review-flow-tree'
import {
  clearPracticeSessionProgressApi,
  createPalaceApi,
  createPalaceSegmentApi,
  deletePalaceSegmentApi,
  deleteAttachmentApi,
  getPalaceEditorApi,
  getPracticeSessionProgressApi,
  getPalaceSegmentsApi,
  getPalaceVersionDetailApi,
  getPalaceVersionsApi,
  linkPalaceChaptersApi,
  restorePalaceVersionApi,
  savePracticeSessionProgressApi,
  savePalaceEditorApi,
  savePalaceEditorWithOptionsApi,
  updatePalaceSegmentApi,
  updatePalaceApi,
  uploadAttachmentApi,
} from '@/shared/api/modules/palaces'
import { getSubjectsApi, getSubjectTreeApi } from '@/shared/api/modules/knowledge'
import type {
  MindMapDoc,
  MindMapDocNode,
  MindMapEditorState,
  PalaceSegmentSummary,
  PalaceVersionDetail,
  PalaceVersionSummary,
  SessionProgressSnapshot,
} from '@/shared/api/contracts'
import type { MindMapSelection } from '@/shared/components/mindmap-host'
import { usePersistedMindMapEditor } from '@/shared/hooks/usePersistedMindMapEditor'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import {
  formatDateTimeInputValue,
  toLocalDateTimePayload,
} from '@/features/palace-edit/model/palace-edit-format'

export interface PalaceMeta {
  id: number
  title: string
  description: string
  created_at: string | null
  attachments: Array<{ id: number; original_name: string; file_size: number }>
  chapters: Array<{
    id: number
    name: string
    parent_id?: number | null
    is_explicit?: boolean
    subject?: { id: number; name: string } | null
  }>
  primary_chapter_id?: number | null
}

export interface ChapterOption {
  id: number
  name: string
  depth: number
  subjectId: number | null
  subjectName: string
  parentId: number | null
  children: ChapterOption[]
}

type StatusBadgeState = {
  variant: 'secondary' | 'destructive'
  label: string
}

type RangeTarget = number | 'new' | null
type EditorMode = 'edit' | 'practice'
type BilinkSearchMode = 'inline' | 'toolbar'

const pendingDraftCreationByLocationKey = new Map<string, Promise<number>>()

function requestDraftPalaceId(locationKey: string) {
  const existing = pendingDraftCreationByLocationKey.get(locationKey)
  if (existing) return existing

  const pending = createPalaceApi({ title: '未命名宫殿', description: '', pegs: [] })
    .then((created) => created.id as number)
    .catch((error) => {
      pendingDraftCreationByLocationKey.delete(locationKey)
      throw error
    })

  pendingDraftCreationByLocationKey.set(locationKey, pending)
  return pending
}

function parseMindMapDoc(value: unknown): MindMapDoc | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? (parsed as MindMapDoc) : null
    } catch {
      return null
    }
  }
  return typeof value === 'object' ? (value as MindMapDoc) : null
}

function buildSubtreeUidMap(doc: MindMapDoc | null) {
  const subtreeMap = new Map<string, string[]>()

  const walk = (node: MindMapDocNode | null | undefined): string[] => {
    if (!node || typeof node !== 'object') return []
    const ownUid =
      node.data && typeof node.data === 'object' && typeof node.data.uid === 'string'
        ? node.data.uid
        : null
    const childUids = (Array.isArray(node.children) ? node.children : []).flatMap((child) => walk(child))
    const subtreeUids = ownUid ? [ownUid, ...childUids] : childUids
    if (ownUid) {
      subtreeMap.set(ownUid, Array.from(new Set(subtreeUids)))
    }
    return subtreeUids
  }

  walk(doc?.root)
  return subtreeMap
}

function uniqueStrings(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).filter(Boolean)))
}

function getEarlierDateTime(left: string | null, right: string | null) {
  if (!left) return right
  if (!right) return left
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right
}

export function usePalaceEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const palaceId = id ? Number(id) : null
  const [isCreatingDraft, setIsCreatingDraft] = useState(false)
  const [replaceSyncVersion, setReplaceSyncVersion] = useState(0)
  const [selectedNodes, setSelectedNodes] = useState<MindMapSelection[]>([])
  const [title, setTitle] = useState('')
  const [createdAt, setCreatedAt] = useState('')
  const [chapterOptions, setChapterOptions] = useState<ChapterOption[]>([])
  const [explicitChapterIds, setExplicitChapterIds] = useState<number[]>([])
  const [inheritedChapterIds, setInheritedChapterIds] = useState<number[]>([])
  const [primaryChapterId, setPrimaryChapterId] = useState<number | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [versions, setVersions] = useState<PalaceVersionSummary[]>([])
  const [removedDuplicateCount, setRemovedDuplicateCount] = useState(0)
  const [previewingVersionId, setPreviewingVersionId] = useState<number | null>(
    null,
  )
  const [previewVersionDetail, setPreviewVersionDetail] =
    useState<PalaceVersionDetail | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [segments, setSegments] = useState<PalaceSegmentSummary[]>([])
  const [segmentDialogOpen, setSegmentDialogOpen] = useState(false)
  const [segmentName, setSegmentName] = useState('')
  const [segmentColor, setSegmentColor] = useState('#14b8a6')
  const [segmentCreatedAt, setSegmentCreatedAt] = useState('')
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null)
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null)
  const [segmentSaving, setSegmentSaving] = useState(false)
  const [segmentMergingId, setSegmentMergingId] = useState<number | null>(null)
  const [segmentError, setSegmentError] = useState('')
  const [isSegmentRangeMode, setIsSegmentRangeMode] = useState(false)
  const [rangeTargetSegmentId, setRangeTargetSegmentId] = useState<RangeTarget>(null)
  const [selectedRangeNodeUids, setSelectedRangeNodeUids] = useState<string[]>([])
  const [overriddenConflictNodeUids, setOverriddenConflictNodeUids] = useState<string[]>([])
  const [editorMode, setEditorMode] = useState<EditorMode>('edit')
  const [bilinkSearchOpen, setBilinkSearchOpen] = useState(false)
  const [bilinkSearchMode, setBilinkSearchMode] = useState<BilinkSearchMode>('inline')
  const [bilinkSearchQuery, setBilinkSearchQuery] = useState('')
  const [bilinkTriggerNodeUid, setBilinkTriggerNodeUid] = useState<string | null>(null)
  const [bilinkSearchPosition, setBilinkSearchPosition] = useState<{ left: number; top: number } | null>(null)
  const [bilinkPreviewOpen, setBilinkPreviewOpen] = useState(false)
  const [bilinkPreviewLoading, setBilinkPreviewLoading] = useState(false)
  const [bilinkPreviewError, setBilinkPreviewError] = useState('')
  const [bilinkPreviewContext, setBilinkPreviewContext] = useState<BilinkNodeContext | null>(null)
  const [bilinkInsertionText, setBilinkInsertionText] = useState<string | null>(null)
  const [bilinkInsertionNonce, setBilinkInsertionNonce] = useState(0)
  const suppressNativeFullscreenExitUntilRef = useRef(0)
  const hardUnloadRef = useRef(false)

  const {
    meta,
    editorState,
    setEditorState,
    isSaving,
    error,
    reload,
  } = usePersistedMindMapEditor({
    entityId: palaceId,
    fetcher: getPalaceEditorApi,
    saver: savePalaceEditorApi,
    selectMeta: (response) => response.palace as PalaceMeta,
    selectEditorState: (response) => ({
      editor_doc: response.editor_doc,
      editor_config: response.editor_config,
      editor_local_config: response.editor_local_config,
      lang: response.lang,
    }),
    onSaveError: async (nextError, pendingState) => {
      if (!palaceId || !nextError.message.includes('危险结构变更')) return false
      const confirmed = window.confirm(
        '这次保存会让宫殿节点数量骤减。只有在你确实要大幅删除宫殿结构时才继续。确定继续保存吗？',
      )
      if (!confirmed) return true
      await savePalaceEditorWithOptionsApi(palaceId, {
        ...pendingState,
        confirm_dangerous_change: true,
        editor_source: 'palace_edit',
      })
      await reload()
      setReplaceSyncVersion((value) => value + 1)
      return true
    },
  })

  const palace = meta as PalaceMeta | null
  const selectedNode = selectedNodes[0] ?? null
  const parsedEditorDoc = useMemo(() => parseMindMapDoc(editorState?.editor_doc ?? null), [editorState?.editor_doc])
  const subtreeUidMap = useMemo(() => buildSubtreeUidMap(parsedEditorDoc), [parsedEditorDoc])
  const segmentById = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment] as const)),
    [segments],
  )
  const currentRangeTargetSegment =
    typeof rangeTargetSegmentId === 'number' ? segmentById.get(rangeTargetSegmentId) ?? null : null
  const selectedRangeNodeCount = selectedRangeNodeUids.length
  const timer = useTimedSession({
    kind: 'palace_edit',
    title: title || palace?.title || '未命名宫殿',
    palaceId,
    persistKey: palaceId ? `palace_edit:${palaceId}` : null,
  })
  const timerRef = useRef(timer)
  const practiceTitle = title || palace?.title || '未命名宫殿'
  const practiceRoot = useMemo(
    () => buildReviewTree(parsedEditorDoc, practiceTitle),
    [parsedEditorDoc, practiceTitle],
  )
  const practiceNodeMap = useMemo(() => flattenNodes(practiceRoot), [practiceRoot])
  const practiceDocFingerprint = useMemo(
    () => JSON.stringify(parsedEditorDoc ?? {}),
    [parsedEditorDoc],
  )
  const [practiceRevealMap, setPracticeRevealMap] = useState<Record<string, RevealState>>(
    () => buildInitialRevealState(practiceRoot),
  )
  const [practiceRedNodeIds, setPracticeRedNodeIds] = useState<Set<string>>(
    () => new Set<string>(),
  )
  const [practiceSnapshotLoaded, setPracticeSnapshotLoaded] = useState(false)
  const bilinks = useBilinks(palaceId)
  const bilinkCounts = useBilinkCounts(palaceId)

  useEffect(() => {
    setPracticeSnapshotLoaded(false)
  }, [practiceDocFingerprint])

  useEffect(() => {
    if (!palaceId || !editorState) return
    let cancelled = false

    const loadPracticeSnapshot = async () => {
      try {
        const response = await getPracticeSessionProgressApi(palaceId)
        if (cancelled) return
        const progress = response.progress
        if (progress && !progress.completed) {
          setPracticeRevealMap(
            buildInitialRevealState(practiceRoot, progress.reveal_map),
          )
          setPracticeRedNodeIds(
            new Set((progress.red_node_ids ?? []).filter(Boolean)),
          )
        } else {
          setPracticeRevealMap(buildInitialRevealState(practiceRoot))
          setPracticeRedNodeIds(new Set<string>())
        }
      } catch {
        if (cancelled) return
        setPracticeRevealMap(buildInitialRevealState(practiceRoot))
        setPracticeRedNodeIds(new Set<string>())
      } finally {
        if (!cancelled) {
          setPracticeSnapshotLoaded(true)
        }
      }
    }

    void loadPracticeSnapshot()

    return () => {
      cancelled = true
    }
  }, [editorState, palaceId, practiceDocFingerprint, practiceRoot])

  const resetInlinePractice = useCallback(() => {
    setPracticeRevealMap(buildInitialRevealState(practiceRoot))
    setPracticeRedNodeIds(new Set<string>())
  }, [practiceRoot])

  const practiceVisibleEditorState = useMemo(() => {
    if (!editorState) return null
    return buildVisibleEditorState(
      editorState,
      parsedEditorDoc,
      practiceRevealMap,
      practiceNodeMap,
      practiceTitle,
      practiceRedNodeIds,
    )
  }, [
    editorState,
    parsedEditorDoc,
    practiceNodeMap,
    practiceRedNodeIds,
    practiceRevealMap,
    practiceTitle,
  ])

  useEffect(() => {
    if (!palaceId || !practiceSnapshotLoaded) return

    const persistSnapshot = async () => {
      if (allNodesRevealed(practiceRoot, practiceRevealMap)) {
        await clearPracticeSessionProgressApi(palaceId)
        return
      }

      const snapshot = {
        completed: false,
        reveal_map: practiceRevealMap,
        red_node_ids: [...practiceRedNodeIds],
      } satisfies Pick<
        SessionProgressSnapshot,
        'completed' | 'reveal_map' | 'red_node_ids'
      >

      await savePracticeSessionProgressApi(palaceId, snapshot)
    }

    void persistSnapshot()
  }, [
    palaceId,
    practiceRedNodeIds,
    practiceRevealMap,
    practiceRoot,
    practiceSnapshotLoaded,
  ])

  useEffect(() => {
    if (!palaceId || !editorState) return
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig())) return
    timer.start({ source: 'page_enter' })
  }, [editorState, palaceId, timer])

  useEffect(() => {
    timerRef.current = timer
  }, [timer, timerRef])

  useEffect(() => {
    const handleBeforeUnload = () => {
      hardUnloadRef.current = true
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  useEffect(() => {
    return () => {
      const currentTimer = timerRef.current
      if (hardUnloadRef.current) {
        return
      }
      if (currentTimer.startedAt && currentTimer.status !== 'completed') {
        void currentTimer.complete('left_page')
      }
    }
  }, [timerRef])

  useEffect(() => {
    if (!mindMapFullscreen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mindMapFullscreen])

  useEffect(() => {
    if (!mindMapFullscreen) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.fullscreenElement) return
      event.preventDefault()
      event.stopPropagation()
      setMindMapFullscreen(false)
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [mindMapFullscreen])

  useEffect(() => {
    if (palaceId || isCreatingDraft) return
    setIsCreatingDraft(true)
    void requestDraftPalaceId(location.key).then((createdId) => {
      navigate(`/palaces/${createdId}/edit`, { replace: true })
    })
  }, [isCreatingDraft, location.key, navigate, palaceId])

  useEffect(() => {
    if (!palace) return
    setTitle(palace.title)
    setCreatedAt(formatDateTimeInputValue(palace.created_at))
    setExplicitChapterIds(
      palace.chapters.filter((chapter) => chapter.is_explicit !== false).map((chapter) => chapter.id),
    )
    setInheritedChapterIds(
      palace.chapters.filter((chapter) => chapter.is_explicit === false).map((chapter) => chapter.id),
    )
    setPrimaryChapterId(palace.primary_chapter_id ?? null)
    const nextSegments = Array.isArray((palace as any).segments) ? (palace as any).segments : []
    setSegments(nextSegments)
    setActiveSegmentId((current) =>
      current != null && nextSegments.some((segment: PalaceSegmentSummary) => segment.id === current)
        ? current
        : nextSegments[0]?.id ?? null,
    )
    setRangeTargetSegmentId((current) => {
      if (current === 'new') return current
      return current != null && nextSegments.some((segment: PalaceSegmentSummary) => segment.id === current)
        ? current
        : null
    })
  }, [palace])

  const handleTitleChange = (value: string) => {
    timer.registerActivity('edit_operation', { source: 'title_input' })
    setTitle(value)
  }

  const handleCreatedAtChange = (value: string) => {
    timer.registerActivity('edit_operation', { source: 'created_at_input' })
    setCreatedAt(value)
  }

  useEffect(() => {
    const loadChapterOptions = async () => {
      const subjects = await getSubjectsApi()
      const trees = await Promise.all(
        subjects.map((subject) => getSubjectTreeApi(subject.id)),
      )
      const toNode = (
        node: any,
        depth: number,
        subjectName: string,
      ): ChapterOption => ({
        id: node.id,
        name: node.name,
        depth,
        subjectId: node.subject_id ?? null,
        subjectName,
        parentId: node.parent_id ?? null,
        children: Array.isArray(node.children)
          ? node.children.map((child: any) => toNode(child, depth + 1, subjectName))
          : [],
      })

      const options = trees.flatMap((tree) =>
        (tree.chapters || []).map((node: any) => toNode(node, 0, tree.subject?.name || '未命名学科')),
      )
      setChapterOptions(options)
    }

    void loadChapterOptions()
  }, [])

  const handleSaveMeta = async () => {
    if (!palace) return
    timer.registerActivity('edit_operation', { source: 'save_meta' })
    await updatePalaceApi(palace.id, {
      title: title.trim() || '未命名宫殿',
      created_at: createdAt ? toLocalDateTimePayload(createdAt) : null,
    })
    await reload()
  }

  const handleEstablishCreatedAt = async () => {
    if (!palace) return
    timer.registerActivity('edit_operation', { source: 'establish_created_at' })
    await updatePalaceApi(palace.id, {
      created_at: new Date().toISOString(),
    })
    await reload()
  }

  const handleAttachmentUpload = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file || !palace) return
    timer.registerActivity('edit_operation', { source: 'attachment_upload' })
    await uploadAttachmentApi(palace.id, file)
    await reload()
    event.target.value = ''
  }

  const handleAttachmentDelete = async (attachmentId: number) => {
    timer.registerActivity('edit_operation', { source: 'attachment_delete' })
    await deleteAttachmentApi(attachmentId)
    await reload()
  }

  const handleChapterToggle = async (chapterId: number) => {
    if (!palace) return
    timer.registerActivity('edit_operation', { source: 'chapter_toggle' })
    const wasSelected = explicitChapterIds.includes(chapterId)
    const nextIds = wasSelected
      ? explicitChapterIds.filter((item) => item !== chapterId)
      : [...explicitChapterIds, chapterId]
    const nextPrimaryChapterId = wasSelected
      ? (primaryChapterId === chapterId ? null : primaryChapterId)
      : chapterId
    setExplicitChapterIds(nextIds)
    setPrimaryChapterId(nextPrimaryChapterId)
    await linkPalaceChaptersApi(palace.id, {
      chapter_ids: nextIds,
      primary_chapter_id: nextPrimaryChapterId,
    })
    await reload()
  }

  const enterInlinePractice = useCallback(() => {
    timer.registerActivity('practice_interaction', { source: 'inline_practice_enter' })
    setEditorMode('practice')
  }, [timer])

  const exitInlinePractice = useCallback(() => {
    timer.registerActivity('practice_interaction', { source: 'inline_practice_exit' })
    setEditorMode('edit')
  }, [timer])

  const toggleMindMapFullscreen = useCallback((active?: boolean) => {
    timer.registerActivity('edit_operation', { source: 'mind_map_immersive_toggle' })
    if (active === true) {
      suppressNativeFullscreenExitUntilRef.current = Date.now() + 1500
    }
    setMindMapFullscreen((current) => (typeof active === 'boolean' ? active : !current))
  }, [timer])

  const handleMindMapNativeFullscreenChange = useCallback((active: boolean) => {
    if (active) {
      return
    }
    if (Date.now() < suppressNativeFullscreenExitUntilRef.current) {
      return
    }
    setMindMapFullscreen(false)
  }, [])

  const toggleInlinePractice = useCallback(() => {
    if (editorMode === 'practice') {
      exitInlinePractice()
      return
    }
    enterInlinePractice()
  }, [editorMode, enterInlinePractice, exitInlinePractice])

  const handleInlinePracticeNodeClick = useCallback(
    (nodes: MindMapSelection[]) => {
      if (editorMode !== 'practice') return
      const nodeId = buildSelectionNodeId(nodes[0] ?? null)
      if (!nodeId) return
      const node = practiceNodeMap.get(nodeId)
      if (!node) return
      timer.registerActivity('practice_interaction', { source: 'inline_practice_click' })
      setPracticeRevealMap((current) => {
        const state = current[nodeId] ?? 'hidden'
        if (state === 'placeholder') {
          return { ...current, [nodeId]: 'revealed' }
        }
        if (state !== 'revealed') return current
        const nextChild = findNextHiddenChild(node, current)
        if (!nextChild) return current
        return { ...current, [nextChild.id]: 'placeholder' }
      })
    },
    [editorMode, practiceNodeMap, timer],
  )

  const handleInlinePracticeNodeContextMenu = useCallback(
    (nodes: MindMapSelection[]) => {
      if (editorMode !== 'practice') return
      const nodeId = buildSelectionNodeId(nodes[0] ?? null)
      if (!nodeId || nodeId === practiceRoot.id) return
      timer.registerActivity('practice_interaction', { source: 'inline_practice_contextmenu' })
      setPracticeRevealMap((current) =>
        hideNodeAndDescendants(nodeId, practiceNodeMap, current),
      )
    },
    [editorMode, practiceNodeMap, practiceRoot.id, timer],
  )

  const restartInlinePractice = useCallback(async () => {
    resetInlinePractice()
    if (palaceId) {
      await clearPracticeSessionProgressApi(palaceId)
    }
    timer.registerActivity('practice_interaction', { source: 'inline_practice_restart' })
  }, [palaceId, resetInlinePractice, timer])

  const activeMindMapEditorState = useMemo<MindMapEditorState | null>(
    () =>
      editorMode === 'practice'
        ? (practiceVisibleEditorState ?? editorState ?? null)
        : (editorState ?? null),
    [editorMode, editorState, practiceVisibleEditorState],
  )

  const handleOpenVersions = async () => {
    if (!palace) return
    const result = await getPalaceVersionsApi(palace.id)
    setVersions(result.versions)
    setRemovedDuplicateCount(result.removed_duplicates ?? 0)
    setPreviewingVersionId(null)
    setPreviewVersionDetail(null)
    setPreviewError('')
    setPreviewLoading(false)
    setVersionOpen(true)
  }

  const refreshBilinks = useCallback(() => {
    bilinks.refresh()
    bilinkCounts.refresh()
  }, [bilinkCounts, bilinks])
  const bilinkOverlay = useBilinkOverlay({
    currentPalaceId: palaceId,
    allowCreate: true,
    onBilinkCreated: refreshBilinks,
    onBilinkDeleted: refreshBilinks,
    onJumpToContext: (context) => {
      navigate(`/palaces/${context.palace_id}/edit`)
    },
  })

  const refreshSegments = async () => {
    if (!palaceId) return
    const result = await getPalaceSegmentsApi(palaceId)
    setSegments(result.items)
    setActiveSegmentId((current) =>
      current != null && result.items.some((segment) => segment.id === current)
        ? current
        : result.items[0]?.id ?? null,
    )
    setRangeTargetSegmentId((current) => {
      if (current === 'new') return current
      return current != null && result.items.some((segment) => segment.id === current) ? current : null
    })
  }

  const handleOpenCreateSegment = () => {
    setSegmentError('')
    setEditingSegmentId(null)
    setSegmentName('')
    setSegmentColor('#14b8a6')
    setSegmentCreatedAt(
      formatDateTimeInputValue(
        segments.length === 0 ? palace?.created_at ?? new Date().toISOString() : new Date().toISOString(),
      ),
    )
    setSegmentDialogOpen(true)
  }

  const handleOpenEditSegment = (segment: PalaceSegmentSummary) => {
    if (segment.is_virtual_default) {
      setSegmentError('默认第 1 部分不单独保存为实体分块，时间沿用宫殿本身。')
      return
    }
    setSegmentError('')
    setEditingSegmentId(segment.id)
    setSegmentName(segment.name)
    setSegmentColor(segment.color)
    setSegmentCreatedAt(formatDateTimeInputValue(segment.created_at))
    setActiveSegmentId(segment.id)
    setSegmentDialogOpen(true)
  }

  const enterSegmentRangeMode = (target: RangeTarget) => {
    const sourceSegment =
      target === 'new'
        ? null
        : typeof target === 'number'
          ? segments.find((segment) => segment.id === target) ?? null
          : null
    setIsSegmentRangeMode(true)
    setRangeTargetSegmentId(target)
    setSelectedRangeNodeUids(sourceSegment ? [...sourceSegment.node_uids] : [])
    setOverriddenConflictNodeUids([])
    if (typeof target === 'number') {
      setActiveSegmentId(target)
    }
  }

  const exitSegmentRangeMode = () => {
    setIsSegmentRangeMode(false)
    setRangeTargetSegmentId(null)
    setSelectedRangeNodeUids([])
    setOverriddenConflictNodeUids([])
  }

  const handleSegmentRangeModeToggle = (payload: {
    active: boolean
    targetSegmentId: RangeTarget
  }) => {
    if (!payload.active) {
      exitSegmentRangeMode()
      return
    }
    enterSegmentRangeMode(payload.targetSegmentId ?? 'new')
  }

  const handleSegmentRangeDraftChange = (payload: {
    selectedNodeUids: string[]
    overriddenConflictNodeUids: string[]
  }) => {
    setSelectedRangeNodeUids(uniqueStrings(payload.selectedNodeUids))
    setOverriddenConflictNodeUids(uniqueStrings(payload.overriddenConflictNodeUids))
  }

  const handleAdjustSegmentRange = (segment: PalaceSegmentSummary) => {
    enterSegmentRangeMode(segment.id)
  }

  const handleConfirmSegmentRange = () => {
    if (!selectedRangeNodeUids.length) {
      window.alert('先在脑图里选中至少一个节点，再确认分块范围。')
      return
    }
    timer.registerActivity('edit_operation', { source: 'segment_range_confirm' })
    if (typeof rangeTargetSegmentId === 'number') {
      const segment = segments.find((item) => item.id === rangeTargetSegmentId)
      if (!segment) return
      handleOpenEditSegment(segment)
      return
    }
    handleOpenCreateSegment()
  }

  const handleSaveSegment = async () => {
    if (!palaceId) return
    timer.registerActivity('edit_operation', { source: 'segment_save' })
    setSegmentSaving(true)
    setSegmentError('')
    const selectedNodeUids = uniqueStrings(
      isSegmentRangeMode
        ? selectedRangeNodeUids
        : selectedNodes
            .map((node) => node.uid)
            .filter((value): value is string => Boolean(value)),
    )
    try {
      const isEditingVirtualDefault = editingSegmentId != null && segments.find((segment) => segment.id === editingSegmentId)?.is_virtual_default
      if (editingSegmentId && !isEditingVirtualDefault) {
        await updatePalaceSegmentApi(editingSegmentId, {
          name: segmentName,
          color: segmentColor,
          created_at: toLocalDateTimePayload(segmentCreatedAt),
          ...(selectedNodeUids.length > 0 ? { node_uids: selectedNodeUids } : {}),
        })
      } else {
        await createPalaceSegmentApi(palaceId, {
          name: segmentName,
          color: segmentColor,
          created_at: toLocalDateTimePayload(segmentCreatedAt),
          node_uids: selectedNodeUids,
        })
      }
      await refreshSegments()
      setSegmentDialogOpen(false)
      exitSegmentRangeMode()
    } catch (error) {
      setSegmentError(error instanceof Error ? error.message : '保存分块失败，请稍后重试。')
    } finally {
      setSegmentSaving(false)
    }
  }

  const handleDeleteSegment = async (segmentId: number) => {
    const confirmed = window.confirm('删除这个分块只会取消这组节点的分块划分，不会删除任何脑图内容。确定继续吗？')
    if (!confirmed) return
    timer.registerActivity('edit_operation', { source: 'segment_delete' })
    await deletePalaceSegmentApi(segmentId)
    await refreshSegments()
  }

  const handleMergeSegment = async (sourceSegmentId: number, targetSegmentId: number) => {
    if (sourceSegmentId === targetSegmentId) return
    const sourceSegment = segments.find((segment) => segment.id === sourceSegmentId)
    const targetSegment = segments.find((segment) => segment.id === targetSegmentId)
    if (!sourceSegment || !targetSegment) return

    timer.registerActivity('edit_operation', { source: 'segment_merge' })
    setSegmentMergingId(sourceSegmentId)
    try {
      await updatePalaceSegmentApi(targetSegmentId, {
        created_at: getEarlierDateTime(targetSegment.created_at, sourceSegment.created_at),
        node_uids: uniqueStrings([...targetSegment.node_uids, ...sourceSegment.node_uids]),
      })
      await deletePalaceSegmentApi(sourceSegmentId)
      await refreshSegments()
      setActiveSegmentId(targetSegmentId)
    } finally {
      setSegmentMergingId(null)
    }
  }

  const activeSegment =
    segments.find((segment) => segment.id === activeSegmentId) ?? null

  const handlePreviewVersion = async (versionId: number) => {
    if (!palace) return
    setPreviewingVersionId(versionId)
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const detail = await getPalaceVersionDetailApi(palace.id, versionId)
      setPreviewVersionDetail(detail)
    } catch (err) {
      setPreviewVersionDetail(null)
      setPreviewError(err instanceof Error ? err.message : '加载版本预览失败。')
    } finally {
      setPreviewLoading(false)
    }
  }

  const resetVersionPreview = () => {
    setPreviewingVersionId(null)
    setPreviewVersionDetail(null)
    setPreviewError('')
    setPreviewLoading(false)
  }

  const handleCloseVersions = () => {
    setVersionOpen(false)
    resetVersionPreview()
    setRemovedDuplicateCount(0)
  }

  const handleRestoreVersion = async (versionId: number) => {
    if (!palace) return
    const confirmed = window.confirm(
      '恢复历史版本只会回滚当前宫殿内容，不会影响其他宫殿和复习记录。确定继续吗？',
    )
    if (!confirmed) return
    await restorePalaceVersionApi(palace.id, versionId)
    await reload()
    setReplaceSyncVersion((value) => value + 1)
    handleCloseVersions()
  }

  const statusBadge = useMemo<StatusBadgeState>(() => {
    if (!palaceId) {
      return { variant: 'secondary', label: '正在创建草稿' }
    }
    if (error) {
      return { variant: 'destructive', label: '保存异常' }
    }
    if (!editorState) {
      return { variant: 'secondary', label: '加载中' }
    }
    if (isSaving) {
      return { variant: 'secondary', label: '自动保存脑图中' }
    }
    return { variant: 'secondary', label: '宿主桥已连接' }
  }, [editorState, error, isSaving, palaceId])

  return {
    palaceId,
    palace,
    timer,
    title,
    setTitle: handleTitleChange,
    createdAt,
    setCreatedAt: handleCreatedAtChange,
    editorMode,
    chapterOptions,
    explicitChapterIds,
    inheritedChapterIds,
    primaryChapterId,
    versionOpen,
    setVersionOpen,
    mindMapFullscreen,
    setMindMapFullscreen,
    toggleMindMapFullscreen,
    handleMindMapNativeFullscreenChange,
    versions,
    removedDuplicateCount,
    previewingVersionId,
    previewVersionDetail,
    previewLoading,
    previewError,
    segments,
    segmentDialogOpen,
    setSegmentDialogOpen,
    segmentName,
    setSegmentName,
    segmentColor,
    setSegmentColor,
    segmentCreatedAt,
    setSegmentCreatedAt,
    editingSegmentId,
    activeSegmentId,
    setActiveSegmentId,
    activeSegment,
    segmentSaving,
    segmentMergingId,
    segmentError,
    isSegmentRangeMode,
    rangeTargetSegmentId,
    selectedRangeNodeUids,
    overriddenConflictNodeUids,
    selectedRangeNodeCount,
    currentRangeTargetSegment,
    subtreeUidMap,
    editorState,
    activeMindMapEditorState,
    replaceSyncVersion,
    selectedNodes,
    selectedNode,
    setSelectedNodes,
    setEditorState,
    handleSaveMeta,
    handleEstablishCreatedAt,
    handleAttachmentUpload,
    handleAttachmentDelete,
    handleChapterToggle,
    enterInlinePractice,
    exitInlinePractice,
    toggleInlinePractice,
    bilinks: bilinks.items,
    bilinksLoading: bilinks.loading,
    bilinksError: bilinks.error,
    bilinkCounts: bilinkCounts.counts,
    bilinkCountsLoading: bilinkCounts.loading,
    ...bilinkOverlay,
    handleInlinePracticeNodeClick,
    handleInlinePracticeNodeContextMenu,
    restartInlinePractice,
    handleOpenVersions,
    handleOpenCreateSegment,
    handleOpenEditSegment,
    handleAdjustSegmentRange,
    handleSegmentRangeModeToggle,
    handleSegmentRangeDraftChange,
    handleConfirmSegmentRange,
    handleSaveSegment,
    handleDeleteSegment,
    handleMergeSegment,
    handlePreviewVersion,
    handleCloseVersions,
    handleRestoreVersion,
    resetVersionPreview,
    statusBadge,
  }
}
