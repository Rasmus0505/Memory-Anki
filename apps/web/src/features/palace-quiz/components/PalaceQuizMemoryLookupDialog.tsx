import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  BookOpen,
  Expand,
  LoaderCircle,
  Pin,
  PinOff,
  RotateCcw,
  Search,
  Shrink,
  X,
} from 'lucide-react'
import { getPalaceEditorApi, getPalacesGroupedApi } from '@/entities/palace/api/catalogApi'
import { useRevealSession } from '@/entities/review/model/useRevealSession'
import { buildAllRevealedState } from '@/entities/review/model/review-flow-tree'
import { useReviewFeedback } from '@/features/review/hooks/useReviewFeedback'
import type {
  MindMapEditorState,
  PalaceGroupedItem,
  PalaceGroupedListResponse,
} from '@/shared/api/contracts'
import {
  calculateResizedMemoryLookupLayout,
  clampMemoryLookupLayoutToViewport,
  MEMORY_LOOKUP_DRAG_CLICK_THRESHOLD_PX,
  MEMORY_LOOKUP_RESIZE_HANDLE_STYLES,
  readMemoryLookupLayout,
  saveMemoryLookupLayout,
  type MemoryLookupLayout,
  type MemoryLookupResizeDirection,
  type MemoryLookupResizeState,
} from '@/features/palace-quiz/model/memoryLookupLayout'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'

type MemoryLookupPreviewMode = 'view' | 'flip'

function createEmptyGroupedData(): PalaceGroupedListResponse {
  return {
    groups: [],
    ungrouped: [],
    subjects: [],
  }
}

function flattenPalaces(data: Pick<PalaceGroupedListResponse, 'subjects'>): PalaceGroupedItem[] {
  const list: PalaceGroupedItem[] = []
  for (const subject of data.subjects) {
    for (const group of subject.chapter_groups) {
      list.push(...group.palaces)
    }
    list.push(...subject.ungrouped_palaces)
  }
  return list
}

function getPalaceTitle(palace: PalaceGroupedItem) {
  return palace.resolved_title || palace.title || '未命名宫殿'
}

function getPalaceContext(palace: PalaceGroupedItem) {
  const subjectName = palace.resolved_subject?.name
  const chapterName = palace.primary_chapter?.name || palace.resolved_parent_chapter?.name
  return [subjectName, chapterName].filter(Boolean).join(' / ') || '未分类'
}

function buildEditorState(response: Awaited<ReturnType<typeof getPalaceEditorApi>>): MindMapEditorState {
  return {
    editor_doc: response.editor_doc,
    editor_config: response.editor_config,
    editor_local_config: response.editor_local_config,
    lang: response.lang,
    editor_fingerprint: response.editor_fingerprint,
  }
}

function getRootNodeUid(editorState: MindMapEditorState | null) {
  const doc = editorState?.editor_doc
  if (!doc || typeof doc !== 'object') return null
  const root = (doc as { root?: { data?: { uid?: unknown } } }).root
  const uid = root?.data?.uid
  return typeof uid === 'string' && uid.trim() ? uid.trim() : null
}

export function PalaceQuizMemoryLookupDialog({
  open,
  onOpenChange,
  currentPalaceId,
  followCurrentPalace = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPalaceId: number
  followCurrentPalace?: boolean
}) {
  const [search, setSearch] = useState('')
  const [groupedData, setGroupedData] = useState<PalaceGroupedListResponse>(createEmptyGroupedData)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [selectedPalaceId, setSelectedPalaceId] = useState<number | null>(currentPalaceId)
  const [previewTitle, setPreviewTitle] = useState('')
  const [previewState, setPreviewState] = useState<MindMapEditorState | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [layout, setLayout] = useState<MemoryLookupLayout>(() => readMemoryLookupLayout())
  const [pinned, setPinned] = useState(false)
  const [previewMode, setPreviewMode] = useState<MemoryLookupPreviewMode>('view')
  const [rootFocusNonce, setRootFocusNonce] = useState(0)
  const dragStateRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const resizeStateRef = useRef<MemoryLookupResizeState | null>(null)
  const suppressCapsuleClickRef = useRef(false)

  const palaces = useMemo(() => flattenPalaces(groupedData), [groupedData])
  const selectedPalace = palaces.find((palace) => palace.id === selectedPalaceId) ?? null
  const rootNodeUid = getRootNodeUid(previewState)
  const revealSession = useRevealSession({
    title: selectedPalace ? getPalaceTitle(selectedPalace) : previewTitle || '宫殿脑图',
    editorState: previewState,
  })
  const feedback = useReviewFeedback({
    root: revealSession.root,
    revealMap: revealSession.revealMap,
    revealedNonRootCount: revealSession.revealedNonRootCount,
    totalNodeCount: revealSession.totalNodeCount,
  })
  const flipEditorState = revealSession.visibleEditorState
  const enterFlipMode = useCallback(() => {
    setPreviewMode('flip')
    revealSession.setRevealMap(buildAllRevealedState(revealSession.root))
    revealSession.setRedNodeIds(new Set<string>())
  }, [revealSession.root, revealSession.setRedNodeIds, revealSession.setRevealMap])

  useEffect(() => {
    if (!open) return
    setSelectedPalaceId((current) => {
      if (followCurrentPalace) return currentPalaceId
      return current ?? currentPalaceId
    })
  }, [currentPalaceId, followCurrentPalace, open])

  const persistLayout = useCallback(
    (nextLayout: MemoryLookupLayout | ((current: MemoryLookupLayout) => MemoryLookupLayout)) => {
      setLayout((current) => {
        const resolved = typeof nextLayout === 'function' ? nextLayout(current) : nextLayout
        return saveMemoryLookupLayout(resolved)
      })
    },
    [],
  )

  useEffect(() => {
    if (!open) return
    persistLayout((current) => current)
  }, [open, persistLayout])

  useEffect(() => {
    const handleResize = () => {
      persistLayout((current) => clampMemoryLookupLayoutToViewport(current))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [persistLayout])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const loadPalaces = async () => {
      setListLoading(true)
      setListError('')
      try {
        const data = await getPalacesGroupedApi(search.trim() ? { search: search.trim() } : undefined)
        if (cancelled) return
        setGroupedData(data)
        const flattened = flattenPalaces(data)
        setSelectedPalaceId((current) => {
          if (followCurrentPalace && flattened.some((palace) => palace.id === currentPalaceId)) {
            return currentPalaceId
          }
          if (current && flattened.some((palace) => palace.id === current)) return current
          if (flattened.some((palace) => palace.id === currentPalaceId)) return currentPalaceId
          return flattened[0]?.id ?? null
        })
      } catch (error) {
        if (cancelled) return
        setListError(error instanceof Error ? error.message : '加载记忆宫殿列表失败。')
        setGroupedData(createEmptyGroupedData())
      } finally {
        if (!cancelled) setListLoading(false)
      }
    }
    void loadPalaces()
    return () => {
      cancelled = true
    }
  }, [currentPalaceId, followCurrentPalace, open, search])

  useEffect(() => {
    if (!open || selectedPalaceId == null) {
      setPreviewState(null)
      return
    }
    let cancelled = false
    const loadPreview = async () => {
      setPreviewLoading(true)
      setPreviewError('')
      try {
        const response = await getPalaceEditorApi(selectedPalaceId)
        if (cancelled) return
        setPreviewTitle(response.palace?.title || '记忆宫殿')
        const nextState = buildEditorState(response)
        setPreviewState(nextState)
        if (getRootNodeUid(nextState)) {
          setRootFocusNonce((current) => current + 1)
        }
      } catch (error) {
        if (cancelled) return
        setPreviewTitle('记忆宫殿')
        setPreviewState(null)
        setPreviewError(error instanceof Error ? error.message : '加载宫殿脑图失败。')
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }
    void loadPreview()
    return () => {
      cancelled = true
    }
  }, [open, selectedPalaceId])

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('[data-memory-lookup-control="true"]')
      ) {
        return
      }
      dragStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: layout.x,
        originY: layout.y,
      }
      suppressCapsuleClickRef.current = false
      if ('setPointerCapture' in event.currentTarget) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    },
    [layout.x, layout.y],
  )

  const beginResize = useCallback(
    (direction: MemoryLookupResizeDirection, event: ReactPointerEvent<HTMLButtonElement>) => {
      resizeStateRef.current = {
        direction,
        startX: event.clientX,
        startY: event.clientY,
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      }
      if ('setPointerCapture' in event.currentTarget) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      event.stopPropagation()
    },
    [layout.height, layout.width, layout.x, layout.y],
  )

  const handlePointerMove = useCallback(
    (clientX: number, clientY: number) => {
      if (dragStateRef.current) {
        const dragState = dragStateRef.current
        const deltaX = clientX - dragState.startX
        const deltaY = clientY - dragState.startY
        if (
          Math.abs(deltaX) > MEMORY_LOOKUP_DRAG_CLICK_THRESHOLD_PX ||
          Math.abs(deltaY) > MEMORY_LOOKUP_DRAG_CLICK_THRESHOLD_PX
        ) {
          suppressCapsuleClickRef.current = true
        }
        persistLayout((current) => ({
          ...current,
          x: dragState.originX + deltaX,
          y: dragState.originY + deltaY,
        }))
      }

      if (resizeStateRef.current) {
        const nextLayout = calculateResizedMemoryLookupLayout(
          resizeStateRef.current,
          clientX,
          clientY,
          window.innerWidth,
          window.innerHeight,
        )
        persistLayout((current) => ({
          ...current,
          ...nextLayout,
        }))
      }
    },
    [persistLayout],
  )

  const stopPointerInteraction = useCallback(() => {
    dragStateRef.current = null
    resizeStateRef.current = null
  }, [])

  useEffect(() => {
    if (!open) return
    const handleWindowPointerMove = (event: PointerEvent) => {
      handlePointerMove(event.clientX, event.clientY)
    }
    const handleWindowPointerUp = () => {
      stopPointerInteraction()
    }
    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerUp)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
      window.removeEventListener('pointercancel', handleWindowPointerUp)
    }
  }, [handlePointerMove, open, stopPointerInteraction])

  const collapse = () => {
    persistLayout((current) => ({ ...current, collapsed: true }))
  }

  const expand = () => {
    persistLayout((current) => ({ ...current, collapsed: false }))
  }

  if (layout.collapsed) {
    return (
      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (!nextOpen && pinned) return
        onOpenChange(nextOpen)
      }} modal={false}>
        <DialogContent
          layout="unstyled"
          className="fixed z-[241]"
          style={{ left: layout.x, top: layout.y }}
        >
          <DialogTitle className="sr-only">查看记忆宫殿</DialogTitle>
          <button
            type="button"
            className="inline-flex max-w-[280px] items-center gap-2 rounded-full border border-border/80 bg-card/95 px-3 py-2 text-sm font-medium shadow-2xl backdrop-blur transition-colors hover:bg-secondary"
            onPointerDown={beginDrag}
            onClick={() => {
              if (suppressCapsuleClickRef.current) {
                suppressCapsuleClickRef.current = false
                return
              }
              expand()
            }}
            aria-label="打开记忆宫殿查看"
          >
            <BookOpen className="h-4 w-4 shrink-0 text-primary" />
            <span className="shrink-0">查看宫殿</span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {selectedPalace ? getPalaceTitle(selectedPalace) : previewTitle || '记忆宫殿'}
            </span>
            <Expand className="h-3.5 w-3.5 shrink-0" />
          </button>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && pinned) return
      onOpenChange(nextOpen)
    }} modal={false}>
      <DialogContent
        layout="unstyled"
        className="fixed z-[241] rounded-2xl border border-border/80 bg-card/98 shadow-2xl backdrop-blur"
        style={{
          left: layout.x,
          top: layout.y,
          width: layout.width,
          height: layout.height,
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div
            className="flex cursor-move touch-none items-start justify-between gap-4 border-b border-border/70 px-4 py-3 sm:px-5"
            onPointerDown={beginDrag}
          >
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-base">查看记忆宫殿</DialogTitle>
              <DialogDescription className="text-xs">
                做题时快速查看宫殿内容，关闭后继续当前题目。
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1" data-memory-lookup-control="true">
              <Button
                type="button"
                variant={pinned ? 'default' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                aria-label={pinned ? '取消置顶记忆宫殿查看' : '置顶记忆宫殿查看'}
                title={pinned ? '取消置顶' : '置顶'}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setPinned((current) => !current)}
              >
                {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="缩小为胶囊"
                title="缩小为胶囊"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={collapse}
              >
                <Shrink className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="关闭记忆宫殿查看"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col border-b border-border/70 lg:border-b-0 lg:border-r">
              <div className="border-b border-border/70 p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索记忆宫殿"
                    className="h-9 pl-9"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {listLoading ? (
                  <div className="flex h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在加载宫殿...
                  </div>
                ) : listError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {listError}
                  </div>
                ) : palaces.length === 0 ? (
                  <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border/80 px-3 text-center text-sm text-muted-foreground">
                    没有找到记忆宫殿。
                  </div>
                ) : (
                  <div className="space-y-1">
                    {palaces.map((palace) => {
                      const active = palace.id === selectedPalaceId
                      return (
                        <button
                          key={palace.id}
                          type="button"
                          className={cn(
                            'w-full rounded-lg px-3 py-2 text-left transition-colors',
                            active
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'hover:bg-secondary',
                          )}
                          onClick={() => setSelectedPalaceId(palace.id)}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <BookOpen className="h-4 w-4 shrink-0" />
                            <span className="truncate text-sm font-medium">{getPalaceTitle(palace)}</span>
                          </div>
                          <div
                            className={cn(
                              'mt-1 truncate text-xs',
                              active ? 'text-primary-foreground/78' : 'text-muted-foreground',
                            )}
                          >
                            {getPalaceContext(palace)}
                          </div>
                          <div
                            className={cn(
                              'mt-1 text-xs',
                              active ? 'text-primary-foreground/78' : 'text-muted-foreground',
                            )}
                          >
                            {(palace.chapters?.length || 0)} 章节 · {(palace.segments?.length || 0)} 分块
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col p-3 sm:p-4">
              <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {selectedPalace ? getPalaceTitle(selectedPalace) : previewTitle || '宫殿脑图'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {previewMode === 'view'
                      ? '只读脑图预览'
                      : '翻卡模式：点击已显示节点展开子节点，点击“待回忆”翻开内容。'}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <div className="inline-flex rounded-full border border-border/70 bg-muted/45 p-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={previewMode === 'view' ? 'default' : 'ghost'}
                      className="h-7 rounded-full px-3 text-xs"
                      onClick={() => setPreviewMode('view')}
                    >
                      查看模式
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={previewMode === 'flip' ? 'default' : 'ghost'}
                      className="h-7 rounded-full px-3 text-xs"
                      onClick={enterFlipMode}
                    >
                      翻卡模式
                    </Button>
                  </div>
                  {previewMode === 'flip' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={!previewState}
                      onClick={revealSession.reset}
                    >
                      <RotateCcw className="h-4 w-4" />
                      重新开始
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-background">
                {previewLoading ? (
                  <div className="flex h-full min-h-[180px] items-center justify-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在加载脑图...
                  </div>
                ) : previewError ? (
                  <div className="flex h-full min-h-[180px] items-center justify-center p-4">
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {previewError}
                    </div>
                  </div>
                ) : previewState ? (
                  previewMode === 'flip' && flipEditorState ? (
                    <MindMapFrame
                      key={`quiz-memory-lookup-${selectedPalaceId}-flip`}
                      editorState={flipEditorState}
                      readonly
                      practiceModeActive
                      syncOnPropChange
                      syncIntent="replace"
                      syncReason="review_flip"
                      externalSyncKey={revealSession.visibleEditorSyncKey}
                      preserveViewOnSync
                      initialViewPolicy="reset"
                      onEditorStateChange={() => {}}
                      onNodeClick={revealSession.handleNodeClick}
                      onNodeContextMenu={revealSession.handleNodeContextMenu}
                      reviewFxSignal={feedback.reviewFxSignal}
                      className="h-full min-h-[180px] w-full border-0"
                    />
                  ) : (
                    <MindMapFrame
                      key={`quiz-memory-lookup-${selectedPalaceId}-view`}
                      editorState={previewState}
                      readonly
                      focusRequestNodeUid={rootNodeUid}
                      focusRequestNonce={rootFocusNonce}
                      initialViewPolicy="reset"
                      onEditorStateChange={() => {}}
                      className="h-full min-h-[180px] w-full border-0"
                    />
                  )
                ) : (
                  <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-muted-foreground">
                    请选择一个记忆宫殿。
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {(
          [
            ['n', '从上边调整记忆宫殿查看大小'],
            ['e', '从右边调整记忆宫殿查看大小'],
            ['s', '从下边调整记忆宫殿查看大小'],
            ['w', '从左边调整记忆宫殿查看大小'],
            ['nw', '从左上角调整记忆宫殿查看大小'],
            ['ne', '从右上角调整记忆宫殿查看大小'],
            ['se', '从右下角调整记忆宫殿查看大小'],
            ['sw', '从左下角调整记忆宫殿查看大小'],
          ] as Array<[MemoryLookupResizeDirection, string]>
        ).map(([direction, label]) => (
          <button
            key={direction}
            type="button"
            aria-label={label}
            className="absolute rounded-sm bg-transparent"
            style={MEMORY_LOOKUP_RESIZE_HANDLE_STYLES[direction]}
            onPointerDown={(event) => beginResize(direction, event)}
          />
        ))}
      </DialogContent>
    </Dialog>
  )
}
