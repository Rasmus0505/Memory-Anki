import * as React from 'react'
import { Maximize2, Minimize2, Sparkles } from 'lucide-react'
import type { MindMapDoc, MindMapDocNode, MindMapEditorState } from '@/api/client'
import { MindMapFrame, type MindMapSelection } from '@/components/mindmap-host'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export type ReviewRating = 'forgot' | 'fuzzy' | 'remembered'
type RevealState = 'hidden' | 'placeholder' | 'revealed'

export interface ReviewMindMapNode {
  id: string
  text: string
  note: string
  parentId: string | null
  children: ReviewMindMapNode[]
}

interface MindMapReviewFlowProps {
  title: string
  description?: string
  editorState: MindMapEditorState
  submitting?: boolean
  onSubmit: (rating: ReviewRating) => void | Promise<void>
  result?: ReviewRating | null
  resultActions?: React.ReactNode
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
    text: plainText(data.text) || '未命名节点',
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

function buildInitialRevealState(root: ReviewMindMapNode): Record<string, RevealState> {
  const state: Record<string, RevealState> = {}
  const walk = (node: ReviewMindMapNode) => {
    state[node.id] = 'hidden'
    node.children.forEach(walk)
  }
  walk(root)
  state[root.id] = 'revealed'
  return state
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

function findNextHiddenChild(node: ReviewMindMapNode, revealMap: Record<string, RevealState>) {
  return node.children.find((child) => (revealMap[child.id] ?? 'hidden') === 'hidden') ?? null
}

function findNextHiddenSibling(
  node: ReviewMindMapNode,
  nodeMap: Map<string, ReviewMindMapNode>,
  revealMap: Record<string, RevealState>,
) {
  if (!node.parentId) return null
  const parent = nodeMap.get(node.parentId)
  if (!parent) return null
  const index = parent.children.findIndex((child) => child.id === node.id)
  if (index === -1) return null
  for (let i = index + 1; i < parent.children.length; i += 1) {
    const sibling = parent.children[i]
    if ((revealMap[sibling.id] ?? 'hidden') === 'hidden') return sibling
  }
  return null
}

function countNodes(node: ReviewMindMapNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0)
}

function ratingLabel(rating: ReviewRating): string {
  if (rating === 'forgot') return '忘记'
  if (rating === 'fuzzy') return '模糊'
  return '记住'
}

const PLACEHOLDER_NODE_STYLE = {
  fillColor: '#e5e7eb',
  borderColor: '#9ca3af',
  borderWidth: 2,
  color: '#4b5563',
}

const REVEALED_NODE_STYLE = {
  fillColor: '#dcfce7',
  borderColor: '#22c55e',
  borderWidth: 2,
  color: '#14532d',
}

const ROOT_NODE_STYLE = {
  fillColor: '#16a34a',
  borderColor: '#15803d',
  borderWidth: 2,
  color: '#f0fdf4',
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

function parentChildrenAllRevealed(
  parentId: string | null,
  nodeMap: Map<string, ReviewMindMapNode>,
  revealMap: Record<string, RevealState>,
): boolean {
  if (!parentId) return false
  const parent = nodeMap.get(parentId)
  if (!parent || parent.children.length === 0) return false
  return parent.children.every((child) => (revealMap[child.id] ?? 'hidden') === 'revealed')
}

function getNodeVisualStyle(
  state: RevealState,
  isRoot: boolean,
  edgeCompleted: boolean,
): Record<string, string | number> {
  const nodeStyle = isRoot ? ROOT_NODE_STYLE : state === 'placeholder' ? PLACEHOLDER_NODE_STYLE : REVEALED_NODE_STYLE
  const lineStyle = edgeCompleted ? COMPLETED_LINE_STYLE : DEFAULT_LINE_STYLE
  return {
    ...nodeStyle,
    ...lineStyle,
  }
}

function buildVisibleEditorDoc(
  source: MindMapDoc | null,
  revealMap: Record<string, RevealState>,
  nodeMap: Map<string, ReviewMindMapNode>,
  fallbackTitle: string,
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
    const nextData = { ...(nextNode.data ?? {}) }

    if (forceVisible || revealState === 'revealed') {
      if (!plainText(nextData.text)) {
        nextData.text = fallbackId === 'root' ? fallbackTitle || '未命名导图' : '未命名节点'
      }
      delete nextData.hideText
      delete nextData.customTextWidth
    } else {
      nextData.text = '待回忆'
      nextData.note = ''
      nextData.customTextWidth = 132
    }

    Object.assign(
      nextData,
      getNodeVisualStyle(
        forceVisible ? 'revealed' : revealState,
        fallbackId === 'root',
        parentChildrenAllRevealed(nodeMap.get(id)?.parentId ?? null, nodeMap, revealMap),
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

function buildSelectionNodeId(node: MindMapSelection | null): string | null {
  if (!node) return null
  if (node.uid) return String(node.uid)
  if (node.memoryAnkiId != null) return String(node.memoryAnkiId)
  return null
}

export function MindMapReviewFlow({
  title,
  description,
  editorState,
  submitting = false,
  onSubmit,
  result = null,
  resultActions,
}: MindMapReviewFlowProps) {
  const parsedDoc = React.useMemo(() => parseEditorDoc(editorState.editor_doc), [editorState.editor_doc])
  const root = React.useMemo(() => buildReviewTree(parsedDoc, title), [parsedDoc, title])
  const nodeMap = React.useMemo(() => flattenNodes(root), [root])
  const [revealMap, setRevealMap] = React.useState<Record<string, RevealState>>(() => buildInitialRevealState(root))
  const [fullscreen, setFullscreen] = React.useState(false)
  const clickTimerRef = React.useRef<number | null>(null)
  const lastNodeIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    setRevealMap(buildInitialRevealState(root))
  }, [root])

  React.useEffect(() => {
    if (!fullscreen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [fullscreen])

  React.useEffect(() => {
    return () => {
      if (clickTimerRef.current != null) {
        window.clearTimeout(clickTimerRef.current)
      }
    }
  }, [])

  const visibleEditorState = React.useMemo<MindMapEditorState>(
    () => ({
      editor_doc: buildVisibleEditorDoc(parsedDoc, revealMap, nodeMap, title),
      editor_config: cloneValue(editorState.editor_config ?? {}),
      editor_local_config: cloneValue(editorState.editor_local_config ?? {}),
      lang: editorState.lang || 'zh',
    }),
    [editorState.editor_config, editorState.editor_local_config, editorState.lang, nodeMap, parsedDoc, revealMap, title],
  )

  const hasAnyNonRootRevealed = React.useMemo(
    () => Object.entries(revealMap).some(([id, state]) => id !== root.id && state === 'revealed'),
    [revealMap, root.id],
  )

  const handleSingleClick = React.useCallback((nodeId: string) => {
    setRevealMap((current) => {
      const node = nodeMap.get(nodeId)
      if (!node) return current
      const state = current[nodeId] ?? 'hidden'
      if (state === 'placeholder') {
        return { ...current, [nodeId]: 'revealed' }
      }
      if (state !== 'revealed') return current
      const nextChild = findNextHiddenChild(node, current)
      if (!nextChild) return current
      return { ...current, [nextChild.id]: 'placeholder' }
    })
  }, [nodeMap])

  const handleDoubleClick = React.useCallback((nodeId: string) => {
    setRevealMap((current) => {
      const node = nodeMap.get(nodeId)
      if (!node) return current
      const state = current[nodeId] ?? 'hidden'
      if (state !== 'revealed') return current
      const sibling = findNextHiddenSibling(node, nodeMap, current)
      if (!sibling) return current
      return { ...current, [sibling.id]: 'placeholder' }
    })
  }, [nodeMap])

  const handleNodeActive = React.useCallback((nodes: MindMapSelection[]) => {
    const nodeId = buildSelectionNodeId(nodes[0] ?? null)
    if (!nodeId) return

    if (clickTimerRef.current != null && lastNodeIdRef.current === nodeId) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      lastNodeIdRef.current = null
      handleDoubleClick(nodeId)
      return
    }

    if (clickTimerRef.current != null) {
      window.clearTimeout(clickTimerRef.current)
      if (lastNodeIdRef.current) {
        handleSingleClick(lastNodeIdRef.current)
      }
      clickTimerRef.current = null
    }

    lastNodeIdRef.current = nodeId
    clickTimerRef.current = window.setTimeout(() => {
      handleSingleClick(nodeId)
      clickTimerRef.current = null
      lastNodeIdRef.current = null
    }, 220)
  }, [handleDoubleClick, handleSingleClick])

  const mapPanel = (
    <div className={`overflow-hidden rounded-2xl border border-border/70 bg-card ${fullscreen ? 'h-full' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-foreground">手动翻牌复习</div>
          <div className="mt-1 text-xs text-muted-foreground">
            单击空白卡翻开内容；单击已翻开卡片放出一个一级子卡片；双击已翻开卡片放出下一个同级卡片。
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">共 {countNodes(root)} 个节点</Badge>
          <Badge variant="secondary">宿主导图模式</Badge>
          <Button variant="outline" size="sm" onClick={() => setFullscreen((current) => !current)}>
            {fullscreen ? <Minimize2 className="mr-2 h-4 w-4" /> : <Maximize2 className="mr-2 h-4 w-4" />}
            {fullscreen ? '退出全屏' : '全屏导图'}
          </Button>
        </div>
      </div>

      <div className={`p-4 ${fullscreen ? 'h-[calc(100vh-210px)] min-h-0' : ''}`}>
        <MindMapFrame
          editorState={visibleEditorState}
          readonly
          showToolbarWhenReadonly
          syncOnPropChange
          preserveViewOnSync
          onEditorStateChange={() => {}}
          onNodeClick={handleNodeActive}
          className={`w-full rounded-2xl border border-border/70 bg-white ${fullscreen ? 'h-full' : 'h-[68vh]'}`}
        />
      </div>
    </div>
  )

  const scorePanel = (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4" />
        评分
      </div>

      {result ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-background/70 px-4 py-4 text-sm text-muted-foreground">
            本次练习结果：<span className="font-medium text-foreground">{ratingLabel(result)}</span>
          </div>
          {resultActions}
        </div>
      ) : (
        <>
          {!hasAnyNonRootRevealed ? (
            <div className="mb-3 rounded-2xl border border-dashed border-border/80 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
              至少先翻开一张非根节点卡片，再进行评分。
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Button variant="destructive" disabled={submitting || !hasAnyNonRootRevealed} onClick={() => void onSubmit('forgot')}>
              忘记
            </Button>
            <Button variant="outline" disabled={submitting || !hasAnyNonRootRevealed} onClick={() => void onSubmit('fuzzy')}>
              模糊
            </Button>
            <Button disabled={submitting || !hasAnyNonRootRevealed} onClick={() => void onSubmit('remembered')}>
              记住
            </Button>
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      {description ? (
        <div className="rounded-2xl border border-border/70 bg-background/80 p-4 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {description}
        </div>
      ) : null}

      {fullscreen ? (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm">
          <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
            <div className="min-h-0 flex-1">{mapPanel}</div>
            <div className="shrink-0">{scorePanel}</div>
          </div>
        </div>
      ) : (
        <>
          {mapPanel}
          {scorePanel}
        </>
      )}
    </div>
  )
}
