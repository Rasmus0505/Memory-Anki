import * as React from 'react'
import { Maximize2, Minimize2, PenLine, RotateCcw, Sparkles, SquareCheckBig } from 'lucide-react'
import type { MindMapDoc, MindMapDocNode, MindMapEditorState } from '@/api/client'
import { MindMapFrame, type MindMapSelection } from '@/components/mindmap-host'
import { SessionTimerBar } from '@/components/session/SessionTimerBar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type RevealState, formatDuration } from '@/lib/session-records'
import { useTimedSession } from '@/hooks/useTimedSession'

export interface ReviewMindMapNode {
  id: string
  text: string
  note: string
  parentId: string | null
  children: ReviewMindMapNode[]
}

export interface ReviewFlowSnapshot {
  revealMap: Record<string, RevealState>
  redNodeIds: string[]
  completed: boolean
}

interface CompleteFlowPayload {
  durationSeconds: number
  completionMode: 'manual_complete' | 'auto_complete'
  revealedRemaining: boolean
  redNodeIds: string[]
}

interface MindMapReviewFlowProps {
  title: string
  palaceId: number | null
  sessionKind: 'practice' | 'review'
  editorState: MindMapEditorState
  onComplete: (payload: CompleteFlowPayload) => void | Promise<void>
  onRestart?: () => void
  submitting?: boolean
  persistProgress?: boolean
  initialSnapshot?: ReviewFlowSnapshot | null
  onSnapshotChange?: (snapshot: ReviewFlowSnapshot) => void
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function parseEditorDoc(raw: unknown): MindMapDoc | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as MindMapDoc
    } catch {
      return null
    }
  }
  if (typeof raw === 'object') return raw as MindMapDoc
  return null
}

function plainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function getNodeId(node: MindMapDocNode | undefined, fallbackId: string) {
  const data = node?.data ?? {}
  return String(data.uid ?? data.memoryAnkiId ?? fallbackId)
}

function normalizeNode(node: MindMapDocNode | undefined, fallbackId: string, parentId: string | null): ReviewMindMapNode {
  const data = node?.data ?? {}
  const children = Array.isArray(node?.children) ? node.children : []
  const id = getNodeId(node, fallbackId)

  return {
    id,
    text: plainText(data.text),
    note: plainText(data.note),
    parentId,
    children: children.map((child, index) => normalizeNode(child, `${fallbackId}-${index}`, id)),
  }
}

function buildReviewTree(doc: MindMapDoc | null, fallbackTitle: string): ReviewMindMapNode {
  if (!doc?.root) {
    return { id: 'root', text: fallbackTitle || '未命名导图', note: '', parentId: null, children: [] }
  }
  return normalizeNode(doc.root, 'root', null)
}

function flattenNodes(root: ReviewMindMapNode): Map<string, ReviewMindMapNode> {
  const map = new Map<string, ReviewMindMapNode>()
  const walk = (node: ReviewMindMapNode) => {
    map.set(node.id, node)
    node.children.forEach(walk)
  }
  walk(root)
  return map
}

function buildInitialRevealState(root: ReviewMindMapNode, previous: Record<string, RevealState> | null = null) {
  const next: Record<string, RevealState> = {}
  const walk = (node: ReviewMindMapNode) => {
    const previousState = previous?.[node.id]
    next[node.id] = previousState ?? 'hidden'
    node.children.forEach(walk)
  }
  walk(root)
  next[root.id] = 'revealed'
  return next
}

function sanitizeRedNodeIds(root: ReviewMindMapNode, previous: Iterable<string>) {
  const validIds = new Set(collectNodeIds(root))
  validIds.delete(root.id)
  return new Set([...previous].filter((id) => validIds.has(id)))
}

function collectNodeIds(root: ReviewMindMapNode) {
  const ids: string[] = []
  const walk = (node: ReviewMindMapNode) => {
    ids.push(node.id)
    node.children.forEach(walk)
  }
  walk(root)
  return ids
}

function countNodes(node: ReviewMindMapNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0)
}

function findNextHiddenChild(node: ReviewMindMapNode, revealMap: Record<string, RevealState>) {
  return node.children.find((child) => (revealMap[child.id] ?? 'hidden') === 'hidden') ?? null
}

function buildSelectionNodeId(node: MindMapSelection | null): string | null {
  if (!node) return null
  if (node.uid) return String(node.uid)
  if (node.memoryAnkiId != null) return String(node.memoryAnkiId)
  return null
}

const PLACEHOLDER_NODE_STYLE = {
  fillColor: '#eef2f7',
  borderColor: '#94a3b8',
  borderWidth: 2,
  color: '#475569',
}

const REVEALED_NODE_STYLE = {
  fillColor: '#ecfdf5',
  borderColor: '#22c55e',
  borderWidth: 2,
  color: '#14532d',
}

const RED_NODE_STYLE = {
  fillColor: '#fef2f2',
  borderColor: '#ef4444',
  borderWidth: 2,
  color: '#7f1d1d',
}

const ROOT_NODE_STYLE = {
  fillColor: '#111827',
  borderColor: '#0f172a',
  borderWidth: 2,
  color: '#f8fafc',
  fontWeight: 'bold',
}

const DEFAULT_LINE_STYLE = {
  lineColor: '#cbd5e1',
  lineWidth: 2,
}

const COMPLETED_LINE_STYLE = {
  lineColor: '#22c55e',
  lineWidth: 3,
}

function parentChildrenAllVisible(
  parentId: string | null,
  nodeMap: Map<string, ReviewMindMapNode>,
  revealMap: Record<string, RevealState>,
) {
  if (!parentId) return false
  const parent = nodeMap.get(parentId)
  if (!parent || parent.children.length === 0) return false
  return parent.children.every((child) => (revealMap[child.id] ?? 'hidden') !== 'hidden')
}

function getNodeVisualStyle(
  state: RevealState,
  isRoot: boolean,
  edgeCompleted: boolean,
  redMarked: boolean,
): Record<string, string | number> {
  const nodeStyle = isRoot
    ? ROOT_NODE_STYLE
    : redMarked
      ? RED_NODE_STYLE
      : state === 'placeholder'
        ? PLACEHOLDER_NODE_STYLE
        : REVEALED_NODE_STYLE
  const lineStyle = edgeCompleted ? COMPLETED_LINE_STYLE : DEFAULT_LINE_STYLE
  return {
    ...nodeStyle,
    ...lineStyle,
  }
}

const PLACEHOLDER_CONTENT_KEYS = [
  'text',
  'note',
  'richText',
  'textWidth',
  'textHeight',
  'noteWidth',
  'noteHeight',
  'hyperlink',
  'hyperlinkTitle',
  'hideText',
  'hideNote',
  'customTextWidth',
]

function clearPlaceholderContentFields(data: Record<string, unknown>) {
  const nextData = { ...data }
  PLACEHOLDER_CONTENT_KEYS.forEach((key) => {
    delete nextData[key]
  })
  return nextData
}

function buildVisibleEditorDoc(
  source: MindMapDoc | null,
  revealMap: Record<string, RevealState>,
  nodeMap: Map<string, ReviewMindMapNode>,
  fallbackTitle: string,
  redNodeIds: Set<string>,
): MindMapDoc {
  if (!source?.root) {
    return {
      root: {
        data: { text: fallbackTitle || '未命名导图' },
        children: [],
      },
    }
  }

  const walk = (node: MindMapDocNode | undefined, fallbackId: string, forceVisible = false): MindMapDocNode | null => {
    if (!node) return null
    const id = getNodeId(node, fallbackId)
    const revealState = revealMap[id] ?? 'hidden'
    if (!forceVisible && revealState === 'hidden') return null

    const nextNode = cloneValue(node)
    let nextData = { ...(nextNode.data ?? {}) }

    if (forceVisible || revealState === 'revealed') {
      nextData = clearPlaceholderContentFields(nextData)
      if (!plainText(nextData.text)) {
        nextData.text = fallbackId === 'root' ? fallbackTitle || '未命名导图' : nodeMap.get(id)?.text || ''
      }
    } else {
      nextData = clearPlaceholderContentFields(nextData)
      nextData.text = '待回忆'
      nextData.customTextWidth = 132
      nextData.hideNote = true
    }

    Object.assign(
      nextData,
      getNodeVisualStyle(
        forceVisible ? 'revealed' : revealState,
        fallbackId === 'root',
        parentChildrenAllVisible(nodeMap.get(id)?.parentId ?? null, nodeMap, revealMap),
        redNodeIds.has(id) && fallbackId !== 'root',
      ),
    )

    nextNode.data = nextData
    const children = Array.isArray(node.children) ? node.children : []
    nextNode.children = children
      .map((child, index) => walk(child, `${fallbackId}-${index}`))
      .filter((child): child is MindMapDocNode => Boolean(child))
    return nextNode
  }

  return {
    ...cloneValue(source),
    root: walk(source.root, 'root', true) ?? {
      data: { text: fallbackTitle || '未命名导图' },
      children: [],
    },
    view: null,
  }
}

function revealRemainingNodes(
  root: ReviewMindMapNode,
  revealMap: Record<string, RevealState>,
  redNodeIds: Set<string>,
) {
  const nextRevealMap = { ...revealMap }
  const nextRedNodeIds = new Set(redNodeIds)
  let revealedRemaining = false

  const walk = (node: ReviewMindMapNode) => {
    const currentState = nextRevealMap[node.id] ?? 'hidden'
    if (node.id !== root.id && currentState !== 'revealed') {
      nextRevealMap[node.id] = 'revealed'
      nextRedNodeIds.add(node.id)
      revealedRemaining = true
    }
    node.children.forEach(walk)
  }

  walk(root)
  return {
    revealMap: nextRevealMap,
    redNodeIds: nextRedNodeIds,
    revealedRemaining,
  }
}

function allNodesRevealed(root: ReviewMindMapNode, revealMap: Record<string, RevealState>) {
  const ids = collectNodeIds(root).filter((id) => id !== root.id)
  return ids.length > 0 && ids.every((id) => (revealMap[id] ?? 'hidden') === 'revealed')
}

export function MindMapReviewFlow({
  title,
  palaceId,
  sessionKind,
  editorState,
  onComplete,
  onRestart,
  submitting = false,
  persistProgress = false,
  initialSnapshot = null,
  onSnapshotChange,
}: MindMapReviewFlowProps) {
  const timer = useTimedSession({
    kind: sessionKind,
    title,
    palaceId,
  })
  const parsedDoc = React.useMemo(() => parseEditorDoc(editorState.editor_doc), [editorState.editor_doc])
  const root = React.useMemo(() => buildReviewTree(parsedDoc, title), [parsedDoc, title])
  const nodeMap = React.useMemo(() => flattenNodes(root), [root])
  const [revealMap, setRevealMap] = React.useState<Record<string, RevealState>>(() =>
    buildInitialRevealState(root, initialSnapshot?.revealMap ?? null),
  )
  const [redNodeIds, setRedNodeIds] = React.useState<Set<string>>(
    () => new Set((initialSnapshot?.redNodeIds ?? []).filter(Boolean)),
  )
  const [fullscreen, setFullscreen] = React.useState(false)
  const [completed, setCompleted] = React.useState(Boolean(initialSnapshot?.completed))
  const submittingRef = React.useRef(false)
  const timerRef = React.useRef(timer)
  const userAdvancedReviewRef = React.useRef(Boolean(initialSnapshot?.completed))
  const docFingerprint = React.useMemo(() => JSON.stringify(parsedDoc ?? {}), [parsedDoc])
  const lastSnapshotPayloadRef = React.useRef('')

  React.useEffect(() => {
    const nextRevealMap = buildInitialRevealState(root, revealMap)
    setRevealMap(nextRevealMap)
    setRedNodeIds((current) => sanitizeRedNodeIds(root, current))
    if (sessionKind === 'review') {
      setCompleted(false)
    }
    userAdvancedReviewRef.current = false
  }, [docFingerprint, root, sessionKind])

  React.useEffect(() => {
    if (!fullscreen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [fullscreen])

  React.useEffect(() => {
    timerRef.current = timer
  }, [timer])

  React.useEffect(() => {
    const payload = {
      revealMap,
      redNodeIds: [...redNodeIds],
      completed,
    }
    const fingerprint = JSON.stringify(payload)
    if (fingerprint === lastSnapshotPayloadRef.current) return
    lastSnapshotPayloadRef.current = fingerprint
    onSnapshotChange?.(payload)
  }, [completed, onSnapshotChange, redNodeIds, revealMap])

  React.useEffect(() => {
    return () => {
      const currentTimer = timerRef.current
      if (currentTimer.startedAt && currentTimer.status !== 'completed') {
        currentTimer.complete('left_page', { persist_progress: persistProgress })
      }
    }
  }, [persistProgress])

  const visibleEditorState = React.useMemo<MindMapEditorState>(
    () => ({
      editor_doc: buildVisibleEditorDoc(parsedDoc, revealMap, nodeMap, title, redNodeIds),
      editor_config: cloneValue(editorState.editor_config ?? {}),
      editor_local_config: cloneValue(editorState.editor_local_config ?? {}),
      lang: editorState.lang || 'zh',
    }),
    [editorState.editor_config, editorState.editor_local_config, editorState.lang, nodeMap, parsedDoc, redNodeIds, revealMap, title],
  )

  const totalNodeCount = React.useMemo(() => countNodes(root), [root])
  const visibleNonRootCount = React.useMemo(
    () =>
      collectNodeIds(root).filter((id) => id !== root.id && (revealMap[id] ?? 'hidden') !== 'hidden').length,
    [revealMap, root],
  )
  const revealedNonRootCount = React.useMemo(
    () =>
      collectNodeIds(root).filter((id) => id !== root.id && (revealMap[id] ?? 'hidden') === 'revealed').length,
    [revealMap, root],
  )

  const finishFlow = React.useCallback(
    async (modeName: 'manual_complete' | 'auto_complete') => {
      if (completed || submittingRef.current) return

      const finishState = revealRemainingNodes(root, revealMap, redNodeIds)
      setRevealMap(finishState.revealMap)
      setRedNodeIds(finishState.redNodeIds)
      setCompleted(true)
      timer.registerActivity({ source: 'complete' })
      const record = timer.complete(modeName, {
        revealed_remaining: finishState.revealedRemaining,
        red_marked_count: finishState.redNodeIds.size,
      })
      submittingRef.current = true
      try {
        await onComplete({
          durationSeconds: record?.effectiveSeconds ?? timer.effectiveSeconds,
          completionMode: modeName,
          revealedRemaining: finishState.revealedRemaining,
          redNodeIds: [...finishState.redNodeIds],
        })
      } finally {
        submittingRef.current = false
      }
    },
    [completed, onComplete, redNodeIds, revealMap, root, timer],
  )

  React.useEffect(() => {
    if (sessionKind !== 'review' || completed) return
    if (userAdvancedReviewRef.current && allNodesRevealed(root, revealMap)) {
      void finishFlow('auto_complete')
    }
  }, [completed, finishFlow, revealMap, root, sessionKind])

  const handleNodeClick = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (completed) return
      const nodeId = buildSelectionNodeId(nodes[0] ?? null)
      if (!nodeId) return
      const node = nodeMap.get(nodeId)
      if (!node) return
      timer.registerActivity({ source: 'left_click' })
      setRevealMap((current) => {
        const state = current[nodeId] ?? 'hidden'
        if (state === 'placeholder') {
          userAdvancedReviewRef.current = true
          return { ...current, [nodeId]: 'revealed' }
        }
        if (state !== 'revealed') return current
        const nextChild = findNextHiddenChild(node, current)
        if (!nextChild) return current
        userAdvancedReviewRef.current = true
        return { ...current, [nextChild.id]: 'placeholder' }
      })
    },
    [completed, nodeMap, timer],
  )

  const handleNodeContextMenu = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (completed) return
      const nodeId = buildSelectionNodeId(nodes[0] ?? null)
      if (!nodeId || nodeId === root.id) return
      timer.registerActivity({ source: 'right_click' })
      setRedNodeIds((current) => {
        const next = new Set(current)
        if (next.has(nodeId)) {
          next.delete(nodeId)
        } else {
          next.add(nodeId)
        }
        return next
      })
    },
    [completed, root.id, timer],
  )

  const handleRestart = React.useCallback(() => {
    const initialRevealMap = buildInitialRevealState(root)
    setRevealMap(initialRevealMap)
    setRedNodeIds(new Set())
    setCompleted(false)
    userAdvancedReviewRef.current = false
    timer.complete('restart')
    timer.reset()
    onRestart?.()
  }, [onRestart, root, timer])

  const mapPanel = (
    <div className={cn('overflow-hidden rounded-2xl border border-border/70 bg-card', fullscreen ? 'h-full' : '')}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">手动翻牌复习</div>
            <div className="mt-1 text-xs text-muted-foreground">左键揭示或放出子卡，右键标红没记住；正式复习会在全部正文翻开后自动完成。</div>
          </div>
          {completed ? <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">本次已完成</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">已出现 {visibleNonRootCount} / {Math.max(totalNodeCount - 1, 0)}</Badge>
          <Badge variant="secondary">翻卡模式</Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFullscreen((current) => !current)}
          >
            {fullscreen ? <Minimize2 className="mr-2 h-4 w-4" /> : <Maximize2 className="mr-2 h-4 w-4" />}
            {fullscreen ? '退出全屏' : '全屏导图'}
          </Button>
        </div>
      </div>

      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="default">
            <Sparkles className="mr-2 h-4 w-4" />
            翻卡模式
          </Button>
          {onRestart ? (
            <Button type="button" size="sm" variant="outline" onClick={handleRestart}>
              <RotateCcw className="mr-2 h-4 w-4" />
              重新开始练习
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={submitting} onClick={() => void finishFlow('manual_complete')}>
            <SquareCheckBig className="mr-2 h-4 w-4" />
            完成
          </Button>
        </div>
      </div>

      <div className={cn('p-4', fullscreen ? 'h-[calc(100vh-235px)] min-h-0' : '')}>
        <MindMapFrame
          editorState={visibleEditorState}
          readonly
          showToolbarWhenReadonly={false}
          syncOnPropChange
          preserveViewOnSync
          onEditorStateChange={() => {}}
          onNodeClick={handleNodeClick}
          onNodeContextMenu={handleNodeContextMenu}
          className={cn(
            'w-full rounded-2xl border border-border/70 bg-white',
            fullscreen ? 'h-full' : 'h-[68vh]',
          )}
        />
      </div>
    </div>
  )

  const infoPanel = (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <PenLine className="h-4 w-4" />
        当前状态
      </div>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">
        <div className="rounded-2xl border border-border/70 bg-background/70 px-3 py-3">
          已出现 {visibleNonRootCount} 张，已揭示 {revealedNonRootCount} 张，
          红标 {redNodeIds.size} 张，当前有效时长 {formatDuration(timer.effectiveSeconds)}。
        </div>
        <div className="rounded-2xl border border-dashed border-border/80 px-3 py-3">
          翻卡模式只接管鼠标揭示与标红，不影响导图正文。
        </div>
        {persistProgress ? (
          <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-700">
            未完成时会自动续练；完成或手动重开后会清空这次练习进度。
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-3 py-3 text-amber-700">
            正式复习不会跨退出保留当前翻卡进度，但会记录本次有效时长。
          </div>
        )}
      </div>
    </div>
  )

  const timerBar = (
    <SessionTimerBar
      effectiveSeconds={timer.effectiveSeconds}
      pauseCount={timer.pauseCount}
      status={timer.status}
      onStart={() => timer.start({ source: 'manual' })}
      onPause={() => timer.pause({ source: 'manual' })}
      onResume={() => timer.resume({ source: 'manual' })}
      onAdjustDuration={timer.adjustDuration}
      showCompleteAction={false}
      showRestartAction={false}
      className={fullscreen ? 'fixed right-5 top-5 z-[90]' : 'sticky top-5 z-20'}
    />
  )

  const screenGlowClass =
    timer.glowState === 'running'
      ? 'memory-anki-session-glow-running'
      : timer.glowState === 'paused'
        ? 'memory-anki-session-glow-paused'
        : ''

  return (
    <div className={cn('space-y-6', screenGlowClass)}>
      {fullscreen ? (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm">
          {timerBar}
          <div className="flex h-full gap-4 p-4 sm:p-6">
            <div className="min-h-0 flex-1">{mapPanel}</div>
            <div className="hidden w-[340px] shrink-0 xl:block xl:pt-24">
              <div className="space-y-4">{infoPanel}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div>{mapPanel}</div>
          <div className="space-y-4">
            {timerBar}
            {infoPanel}
          </div>
        </div>
      )}
    </div>
  )
}
