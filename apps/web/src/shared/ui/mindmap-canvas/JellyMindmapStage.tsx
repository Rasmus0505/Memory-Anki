import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { bumpElement, cue, shockwaveElement, squashElement, useFxOwner, type Point } from '@/shared/fx'
import type { GraphData, MindMapNode, MindMapNodeVisual } from './adapter'
import { planRevealTransitions } from './parentCharge'

export interface JellyMindmapStageHandle {
  fitView: () => void
  focusNode: (nodeUid: string | null) => void
}

export interface JellyMindmapStageProps {
  graphData: GraphData
  selectedNodeId: string | null
  selectedNodeIds?: string[]
  onNodeSelect?: (nodeId: string | null, options?: { additive?: boolean }) => void
  onNodeActivate?: (nodeId: string) => void
  onNodeContextAction?: (nodeId: string) => void
  onNodeHover?: (nodeId: string | null) => void
  onPaneDoubleClick?: () => void
  onPaneLongPress?: () => void
  readonly?: boolean
  className?: string
  /** HTML-lab compatible camera default. The setting can opt into pan. */
  cameraNudge?: 'still' | 'pan'
  /**
   * False for off-screen freestyle neighbours. The stage stays mounted so the
   * camera can warm up, but it does not build a card per node.
   */
  paintNodes?: boolean
  /** False skips flip theatre and sounds. Resting faces stay flat either way. */
  live?: boolean
  /** Visual children are supplied by the graph projection; generic stage stays business-free. */
  renderCard?: (node: MindMapNode, args: { isRoot: boolean; isParent: boolean; isLeaf: boolean }) => ReactNode
}

type StageNode = MindMapNode & {
  depth: number
  children: string[]
  visual: MindMapNodeVisual
  text: string
}

export type JellyStageRect = { x: number; y: number; width: number; height: number }
export type StageRect = JellyStageRect

export const JELLY_FLIP_DURATION_MS = 550
export const JELLY_BATCH_STAGGER_MS = 45

const ROOT_WIDTH = 250
const ROOT_MIN_HEIGHT = 115
const PARENT_WIDTH = 260
const LEAF_WIDTH = 270
const CARD_GAP_X = 170
const SIBLING_GAP_Y = 24
const STAGE_PADDING = 90
const CARD_FONT = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
const TEXT_HEIGHT_CACHE_LIMIT = 4000

let measureCanvas: HTMLCanvasElement | null = null
let measureContext: CanvasRenderingContext2D | null = null
const textHeightCache = new Map<string, number>()

function rememberTextHeight(key: string, value: number) {
  if (textHeightCache.size >= TEXT_HEIGHT_CACHE_LIMIT) textHeightCache.clear()
  textHeightCache.set(key, value)
  return value
}

function visualOf(node: MindMapNode): MindMapNodeVisual {
  return (node.metadata.visual ?? {}) as MindMapNodeVisual
}

function plainTextOf(node: MindMapNode) {
  const text = typeof node.metadata.text === 'string' ? node.metadata.text : node.label
  return text.replace(/<br\s*\/?>(\r?\n)?/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() || '未命名知识点'
}

function buildStageNodes(graph: GraphData): Map<string, StageNode> {
  const byId = new Map<string, StageNode>()
  graph.nodes.forEach((node) => {
    byId.set(node.id, {
      ...node,
      depth: 0,
      children: [],
      visual: visualOf(node),
      text: plainTextOf(node),
    })
  })
  graph.edges.filter((edge) => edge.type === 'parent-child').forEach((edge) => {
    const parent = byId.get(edge.source)
    if (parent && byId.has(edge.target)) parent.children.push(edge.target)
  })
  // Depth comes from the parent-child edges, not metadata: a two-level chapter
  // tree and a flattened peg tree must both place leaves on the same column.
  const roots = [...byId.values()].filter((node) => node.parentId == null)
  const seen = new Set<string>()
  const walk = (id: string, depth: number) => {
    const node = byId.get(id)
    if (!node || seen.has(id)) return
    seen.add(id)
    node.depth = depth
    node.children.forEach((childId) => walk(childId, depth + 1))
  }
  roots.forEach((root) => walk(root.id, 0))
  byId.forEach((node) => {
    if (!seen.has(node.id)) walk(node.id, Math.max(0, Number((node.metadata as { depth?: number }).depth ?? 0)))
  })
  return byId
}

/**
 * Height budget is measured once per node and never re-measured on flip, so the
 * shell geometry is identical for the concealed and revealed faces. Chrome
 * overhead per card kind mirrors the CSS padding/labels.
 */
const CARD_CHROME = { root: 100, parent: 118, leaf: 76 } as const

function cardChrome(node: StageNode) {
  if (node.depth === 0) return CARD_CHROME.root
  return node.children.length > 0 ? CARD_CHROME.parent : CARD_CHROME.leaf
}

function measureTextHeight(text: string, width: number, font: string, minHeight: number) {
  const maxWidth = Math.max(120, width - 42)
  const fallback = () => {
    const perLine = Math.max(8, Math.floor(maxWidth / 9))
    const lines = text.split(/\r?\n/).reduce((count, paragraph) => count + Math.max(1, Math.ceil(paragraph.length / perLine)), 0)
    return Math.max(minHeight, 24 + lines * 24)
  }
  const cacheKey = `${width}\u0000${font}\u0000${minHeight}\u0000${text}`
  const cached = textHeightCache.get(cacheKey)
  if (cached != null) return cached
  if (typeof document === 'undefined' || (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent))) {
    return rememberTextHeight(cacheKey, fallback())
  }
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  measureContext ??= measureCanvas.getContext('2d')
  const context = measureContext
  if (!context) return rememberTextHeight(cacheKey, fallback())
  context.font = font
  const lines = text.split(/\r?\n/).reduce((count, paragraph) => {
    let lineWidth = 0
    let paragraphLines = 1
    for (const char of paragraph || ' ') {
      const next = lineWidth + context.measureText(char).width
      if (next > maxWidth && lineWidth > 0) {
        paragraphLines += 1
        lineWidth = context.measureText(char).width
      } else {
        lineWidth = next
      }
    }
    return count + paragraphLines
  }, 0)
  return rememberTextHeight(cacheKey, Math.max(minHeight, 24 + lines * 24))
}

function cardWidth(node: StageNode) {
  if (node.depth === 0) return ROOT_WIDTH
  return node.children.length > 0 ? PARENT_WIDTH : LEAF_WIDTH
}

function computeLayout(nodes: Map<string, StageNode>, rootId: string | null): { rects: Map<string, StageRect>; width: number; height: number } {
  const rects = new Map<string, StageRect>()
  if (!rootId || !nodes.has(rootId)) return { rects, width: 0, height: 0 }
  const rawHeights = new Map<string, number>()
  nodes.forEach((node) => {
    const minHeight = node.depth === 0 ? ROOT_MIN_HEIGHT : 120
    rawHeights.set(node.id, Math.max(minHeight, measureTextHeight(node.text, cardWidth(node), CARD_FONT, minHeight) + cardChrome(node)))
  })
  // Every sibling group shares its tallest card height. This is calculated before
  // placement, so flipping a face never changes the world geometry or wrapping.
  const uniformHeights = new Map<string, number>()
  nodes.forEach((node) => {
    const tallest = Math.max(...node.children.map((id) => rawHeights.get(id) ?? 120), 120)
    node.children.forEach((childId) => uniformHeights.set(childId, tallest))
  })
  const cardHeight = (node: StageNode) => uniformHeights.get(node.id) ?? rawHeights.get(node.id) ?? 120
  const heightMemo = new Map<string, number>()
  const subtreeHeight = (id: string): number => {
    const cached = heightMemo.get(id)
    if (cached) return cached
    const node = nodes.get(id)!
    const ownHeight = cardHeight(node)
    if (node.children.length === 0) {
      heightMemo.set(id, ownHeight)
      return ownHeight
    }
    const childHeights = node.children.map(subtreeHeight)
    const height = Math.max(
      ownHeight,
      childHeights.reduce((sum, item) => sum + item, 0) + Math.max(0, childHeights.length - 1) * SIBLING_GAP_Y,
    )
    heightMemo.set(id, height)
    return height
  }
  const place = (id: string, x: number, top: number) => {
    const node = nodes.get(id)!
    const height = subtreeHeight(id)
    const ownHeight = cardHeight(node)
    const y = top + (height - ownHeight) / 2
    const width = cardWidth(node)
    rects.set(id, { x, y, width, height: ownHeight })
    if (node.children.length === 0) return
    const childX = x + width + CARD_GAP_X
    const totalChildrenHeight = node.children.map(subtreeHeight).reduce((sum, item) => sum + item, 0)
      + Math.max(0, node.children.length - 1) * SIBLING_GAP_Y
    let childTop = top + (height - totalChildrenHeight) / 2
    node.children.forEach((childId) => {
      const childHeight = subtreeHeight(childId)
      place(childId, childX, childTop)
      childTop += childHeight + SIBLING_GAP_Y
    })
  }
  const totalHeight = subtreeHeight(rootId)
  place(rootId, STAGE_PADDING, STAGE_PADDING)
  const maxRight = Math.max(...[...rects.values()].map((rect) => rect.x + rect.width), ROOT_WIDTH)
  const maxBottom = Math.max(...[...rects.values()].map((rect) => rect.y + rect.height), ROOT_MIN_HEIGHT)
  return { rects, width: maxRight + STAGE_PADDING, height: Math.max(maxBottom + STAGE_PADDING, totalHeight + STAGE_PADDING * 2) }
}

export function jellyBezierPath(source: JellyStageRect, target: JellyStageRect) {
  const startX = source.x + source.width
  const startY = source.y + source.height / 2
  const endX = target.x
  const endY = target.y + target.height / 2
  const dx = Math.max(64, (endX - startX) * 0.46)
  return `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`
}

export function computeJellyLayout(graphData: GraphData) {
  const nodes = buildStageNodes(graphData)
  const rootId = [...nodes.values()].find((node) => node.parentId == null)?.id ?? null
  return computeLayout(nodes, rootId)
}

function pointFor(rect: StageRect, host: HTMLElement, pan: { x: number; y: number }, scale: number): Point {
  const bounds = host.getBoundingClientRect()
  return {
    x: bounds.left + pan.x + (rect.x + rect.width / 2) * scale,
    y: bounds.top + pan.y + (rect.y + rect.height / 2) * scale,
  }
}

export const JellyMindmapStage = forwardRef<JellyMindmapStageHandle, JellyMindmapStageProps>(function JellyMindmapStage({
  graphData,
  selectedNodeId,
  selectedNodeIds = [],
  onNodeSelect,
  onNodeActivate,
  onNodeContextAction,
  onNodeHover,
  onPaneDoubleClick,
  onPaneLongPress,
  readonly = true,
  className,
  cameraNudge = 'still',
  paintNodes = true,
  live = true,
  renderCard,
}, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const worldRef = useRef<HTMLDivElement | null>(null)
  const fxInstanceId = useId()
  const fxOwner = useFxOwner(`mindmap-jelly-stage:${fxInstanceId}`)
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 })
  const [cameraEpoch, setCameraEpoch] = useState(0)
  const [turningIds, setTurningIds] = useState<ReadonlySet<string>>(() => new Set())
  const [prompt, setPrompt] = useState<{ nodeId: string; text: string } | null>(null)
  const promptTimerRef = useRef<number | null>(null)
  const turningTimerRef = useRef(0)
  const longPressTimerRef = useRef<number | null>(null)
  const handledRevealIdsRef = useRef<Set<string>>(new Set())
  const previousRevealedRef = useRef<Set<string>>(new Set())
  const previousMasteredRef = useRef<Set<string>>(new Set())
  const hydratedGraphRef = useRef(false)
  const graphIdentityRef = useRef<string | null>(null)
  const nodes = useMemo(
    () => (paintNodes ? buildStageNodes(graphData) : new Map<string, StageNode>()),
    [graphData, paintNodes],
  )
  const rootId = useMemo(() => [...nodes.values()].find((node) => node.parentId == null)?.id ?? null, [nodes])
  const layout = useMemo(
    () => (paintNodes ? computeLayout(nodes, rootId) : { rects: new Map<string, StageRect>(), width: 0, height: 0 }),
    [nodes, paintNodes, rootId],
  )
  // A different document/scene is a fresh silent hydration, not a reveal burst.
  const graphIdentity = useMemo(
    () => `${rootId ?? ''}|${nodes.size}|${[...nodes.keys()].slice(0, 4).join(',')}`,
    [nodes, rootId],
  )
  const revealedIds = useMemo(
    () => new Set([...nodes.values()].filter((node) => node.visual.revealed).map((node) => node.id)),
    [nodes],
  )
  // Same planner the effect uses, so the CSS flip delay and the sound delay can
  // never drift apart: both read the batch stagger slot for each new card.
  const flipDelayById = useMemo(() => {
    if (!hydratedGraphRef.current || graphIdentityRef.current !== graphIdentity) return new Map<string, number>()
    return planRevealTransitions({
      revealed: revealedIds,
      handled: handledRevealIdsRef.current,
      previous: previousRevealedRef.current,
      hydrated: true,
      sameGraph: true,
      staggerMs: JELLY_BATCH_STAGGER_MS,
    }).delayMsById
  }, [graphIdentity, revealedIds])
  const parentOf = useMemo(() => {
    const map = new Map<string, string>()
    nodes.forEach((node) => node.children.forEach((child) => map.set(child, node.id)))
    return map
  }, [nodes])
  const progress = useMemo(() => {
    const map = new Map<string, { done: number; total: number; mastered: boolean }>()
    const resolvedMemo = new Map<string, boolean>()
    const isResolved = (id: string, stack = new Set<string>()): boolean => {
      const cached = resolvedMemo.get(id)
      if (cached != null) return cached
      if (stack.has(id)) return false
      const node = nodes.get(id)
      if (!node) return false
      if (node.children.length === 0) {
        const result = Boolean(node.visual.revealed)
        resolvedMemo.set(id, result)
        return result
      }
      const nextStack = new Set(stack)
      nextStack.add(id)
      const result = node.children.every((childId) => isResolved(childId, nextStack))
      resolvedMemo.set(id, result)
      return result
    }
    nodes.forEach((node) => {
      if (node.children.length === 0) return
      const done = node.children.filter((id) => isResolved(id)).length
      map.set(node.id, { done, total: node.children.length, mastered: done === node.children.length })
    })
    return map
  }, [nodes])

  const applyCamera = useCallback((next: { x: number; y: number; scale: number }, commit = false) => {
    cameraRef.current = next
    const world = worldRef.current
    if (world) {
      world.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`
    }
    if (commit) setCameraEpoch((version) => version + 1)
  }, [])

  const fitView = useCallback(() => {
    const host = hostRef.current
    if (!host || layout.width <= 0 || layout.height <= 0) return
    const nextScale = Math.min(1, Math.max(0.35, Math.min(
      (host.clientWidth - 24) / layout.width,
      (host.clientHeight - 24) / layout.height,
    )))
    applyCamera({
      scale: nextScale,
      x: Math.round((host.clientWidth - layout.width * nextScale) / 2),
      y: Math.round((host.clientHeight - layout.height * nextScale) / 2),
    }, true)
  }, [applyCamera, layout.height, layout.width])

  useImperativeHandle(ref, () => ({
    fitView,
    focusNode: (nodeUid) => {
      if (!nodeUid) return
      const rect = layout.rects.get(nodeUid)
      const host = hostRef.current
      if (!rect || !host) return
      const scale = cameraRef.current.scale
      const nextScale = cameraNudge === 'pan' ? Math.min(1.08, Math.max(scale, 0.86)) : scale
      applyCamera({
        scale: nextScale,
        x: Math.round(host.clientWidth / 2 - (rect.x + rect.width / 2) * nextScale),
        y: Math.round(host.clientHeight / 2 - (rect.y + rect.height / 2) * nextScale),
      }, true)
    },
  }), [applyCamera, cameraNudge, fitView, layout.rects])

  useLayoutEffect(() => {
    fitView()
  }, [fitView])

  useEffect(() => {
    const onResize = () => fitView()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fitView])

  useEffect(() => {
    if (typeof window === 'undefined' || nodes.size === 0) return
    // Existing progress is painted silently on mount and on document switch.
    // Only later reveal/fold transitions on the same document emit feedback.
    const transitions = planRevealTransitions({
      revealed: revealedIds,
      handled: handledRevealIdsRef.current,
      previous: previousRevealedRef.current,
      hydrated: hydratedGraphRef.current,
      sameGraph: graphIdentityRef.current === graphIdentity,
      staggerMs: JELLY_BATCH_STAGGER_MS,
    })
    handledRevealIdsRef.current = transitions.handled
    if (!live || (transitions.newlyRevealed.length === 0 && transitions.folded.length === 0)) {
      previousRevealedRef.current = transitions.previous
      previousMasteredRef.current = new Set([...progress.entries()].filter(([, value]) => value.mastered).map(([id]) => id))
      hydratedGraphRef.current = true
      graphIdentityRef.current = graphIdentity
      return
    }
    hydratedGraphRef.current = true
    graphIdentityRef.current = graphIdentity
    const { newlyRevealed, folded: foldedIds, delayMsById } = transitions
    const nodesById = new Map<string, HTMLElement>()
    hostRef.current?.querySelectorAll<HTMLElement>('[data-jelly-node]').forEach((element) => {
      const id = element.dataset.jellyNode
      if (id) nodesById.set(id, element)
    })
    const readNodeElement = (id: string) => nodesById.get(id) ?? null
    foldedIds.forEach((id) => {
      const foldedNode = nodes.get(id)
      if (!foldedNode || foldedNode.children.length > 0 || foldedNode.parentId == null) return
      const leafElement = readNodeElement(id)
      const parentElement = readNodeElement(parentOf.get(id) ?? '')
      if (leafElement && parentElement) {
        cue('map.fold', {
          rect: leafElement.getBoundingClientRect(),
          target: () => {
            if (!parentElement.isConnected) return null
            const rect = parentElement.getBoundingClientRect()
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          },
          onFirstArrive: () => bumpElement(parentElement),
        }, { owner: fxOwner })
      }
    })
    const charges = newlyRevealed.flatMap((id) => {
      const leaf = nodes.get(id)
      if (!leaf || leaf.children.length > 0) return []
      const parentId = parentOf.get(id)
      const leafElement = readNodeElement(id)
      const parentElement = readNodeElement(parentId ?? '')
      const leafRect = layout.rects.get(id)
      if (!parentId || !leafElement || !parentElement || !leafRect || !hostRef.current) return []
      // Crack/land is one cue per card; every revealed card gets its own energy orb.
      cue('map.land', { rect: leafElement.getBoundingClientRect(), delayMs: delayMsById.get(id) ?? 0 }, { owner: fxOwner })
      const parentNode = nodes.get(parentId)
      const parentProgress = progress.get(parentId)
      const target = () => {
        if (!parentElement.isConnected) return null
        const rect = parentElement.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
      return [{
        origin: pointFor(leafRect, hostRef.current, cameraRef.current, cameraRef.current.scale),
        delayMs: delayMsById.get(id) ?? 0,
        target,
        label: `${parentProgress?.done ?? 1}/${parentProgress?.total ?? parentNode?.children.length ?? 1}`,
        mastered: Boolean(parentProgress?.mastered),
        onArrive: () => {
          squashElement(parentElement)
          shockwaveElement(parentElement)
        },
      }]
    })
    const newlyMasteredParents = [...progress.entries()]
      .filter(([id, value]) => value.mastered && !previousMasteredRef.current.has(id))
      .map(([id]) => id)
      .filter((id) => parentOf.get(id) === rootId)
    const rootElement = rootId ? readNodeElement(rootId) : null
    for (const parentId of newlyMasteredParents) {
      const parentRect = layout.rects.get(parentId)
      const parentElement = readNodeElement(parentId)
      if (!parentRect || !parentElement || !rootElement || !hostRef.current) continue
      const rootProgress = rootId ? progress.get(rootId) : undefined
      charges.push({
        origin: pointFor(parentRect, hostRef.current, cameraRef.current, cameraRef.current.scale),
        delayMs: JELLY_FLIP_DURATION_MS,
        target: () => {
          if (!rootElement.isConnected) return null
          const rect = rootElement.getBoundingClientRect()
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        },
        label: `${rootProgress?.done ?? 1}/${rootProgress?.total ?? 1}`,
        mastered: Boolean(rootProgress?.mastered),
        onArrive: () => {
          squashElement(rootElement)
          shockwaveElement(rootElement)
        },
      })
    }
    if (charges.length > 0) {
      cue('map.settle', {
        weight: charges.length > 1 ? 'batch' : 'single',
        charges,
        freeze: charges.some((charge) => charge.mastered),
      }, { owner: fxOwner })
    }
    const turningLeaves = newlyRevealed.filter((id) => {
      const leaf = nodes.get(id)
      return Boolean(leaf && leaf.children.length === 0 && leaf.parentId != null)
    })
    if (turningLeaves.length > 0) {
      setTurningIds(new Set(turningLeaves))
      const maxDelay = Math.max(0, ...turningLeaves.map((id) => delayMsById.get(id) ?? 0))
      window.clearTimeout(turningTimerRef.current)
      turningTimerRef.current = window.setTimeout(
        () => setTurningIds(new Set()),
        maxDelay + JELLY_FLIP_DURATION_MS + 80,
      )
    }
    previousRevealedRef.current = new Set(revealedIds)
    previousMasteredRef.current = new Set([...progress.entries()].filter(([, value]) => value.mastered).map(([id]) => id))
  }, [fxOwner, graphIdentity, layout.rects, live, nodes, parentOf, progress, revealedIds, rootId])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-jelly-node]')) return
    const start = { x: event.clientX, y: event.clientY }
    const origin = cameraRef.current
    let moved = false
    if (onPaneLongPress) {
      if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = window.setTimeout(() => {
        if (!moved) onPaneLongPress()
      }, 520)
    }
    const move = (next: PointerEvent) => {
      if (Math.abs(next.clientX - start.x) > 8 || Math.abs(next.clientY - start.y) > 8) {
        moved = true
        if (longPressTimerRef.current != null) {
          window.clearTimeout(longPressTimerRef.current)
          longPressTimerRef.current = null
        }
      }
      applyCamera({
        x: origin.x + next.clientX - start.x,
        y: origin.y + next.clientY - start.y,
        scale: origin.scale,
      })
    }
    const end = () => {
      if (longPressTimerRef.current != null) {
        window.clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
    window.addEventListener('pointercancel', end, { once: true })
  }, [applyCamera, onPaneLongPress])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && Math.abs(event.deltaY) < 2) return
    event.preventDefault()
    const host = hostRef.current
    if (!host) return
    const camera = cameraRef.current
    const ratio = event.deltaY > 0 ? 0.92 : 1.08
    const nextScale = Math.min(1.6, Math.max(0.35, camera.scale * ratio))
    const bounds = host.getBoundingClientRect()
    const pointerX = event.clientX - bounds.left
    const pointerY = event.clientY - bounds.top
    applyCamera({
      scale: nextScale,
      x: pointerX - (pointerX - camera.x) * (nextScale / camera.scale),
      y: pointerY - (pointerY - camera.y) * (nextScale / camera.scale),
    })
  }, [applyCamera])

  const showPrompt = useCallback((nodeId: string, text: string) => {
    if (promptTimerRef.current != null) window.clearTimeout(promptTimerRef.current)
    setPrompt({ nodeId, text })
    promptTimerRef.current = window.setTimeout(() => setPrompt(null), 1500)
  }, [])

  useEffect(() => () => {
    if (promptTimerRef.current != null) window.clearTimeout(promptTimerRef.current)
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current)
    window.clearTimeout(turningTimerRef.current)
  }, [])

  const handleNodeClick = (event: MouseEvent, node: StageNode) => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (!readonly) onNodeSelect?.(node.id)
    if (node.children.length === 0) showPrompt(node.id, node.visual.revealed ? '已翻开 · 右键收回' : '点击翻开')
    onNodeActivate?.(node.id)
  }

  const handleNodeContextMenu = (event: MouseEvent, node: StageNode) => {
    event.preventDefault()
    event.stopPropagation()
    onNodeContextAction?.(node.id)
    showPrompt(node.id, node.children.length > 0 ? '右键收起子节点' : '右键收回')
  }

  return (
    <div
      ref={hostRef}
      className={['jelly-mindmap-stage', className ?? ''].filter(Boolean).join(' ')}
      onPointerDown={handlePointerDown}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-jelly-node]')) return
        onPaneDoubleClick?.()
      }}
      onWheel={handleWheel}
      role="application"
      aria-label="果冻翻卡导图"
      data-jelly-stage="true"
      data-jelly-live={live ? 'true' : 'false'}
      data-jelly-paint={paintNodes ? 'true' : 'false'}
    >
      <div className="jelly-stage-grid" aria-hidden="true" />
      {paintNodes ? (
      <div
        ref={worldRef}
        className="jelly-stage-world"
        style={{
          transform: `translate3d(${cameraRef.current.x}px, ${cameraRef.current.y}px, 0) scale(${cameraRef.current.scale})`,
          width: layout.width,
          height: layout.height,
        }}
        data-camera-epoch={cameraEpoch}
      >
        <svg className="jelly-stage-links" width={layout.width} height={layout.height} aria-hidden="true">
          {graphData.edges.filter((edge) => edge.type === 'parent-child').map((edge) => {
            const sourceRect = layout.rects.get(edge.source)
            const targetRect = layout.rects.get(edge.target)
            if (!sourceRect || !targetRect) return null
            const target = nodes.get(edge.target)
            const parent = nodes.get(edge.source)
            const linkLive = Boolean(target?.visual.revealed)
            const mastered = Boolean(progress.get(edge.source)?.mastered)
            const path = jellyBezierPath(sourceRect, targetRect)
            return (
              <g key={edge.id} className={['jelly-stage-link', linkLive ? 'is-live' : '', mastered ? 'is-mastered' : ''].filter(Boolean).join(' ')}>
                <path className="jelly-stage-link-glow" d={path} />
                <path className="jelly-stage-link-line" d={path} />
                {parent && target ? <circle className="jelly-stage-link-dot" cx={sourceRect.x + sourceRect.width} cy={sourceRect.y + sourceRect.height / 2} r="4" /> : null}
              </g>
            )
          })}
        </svg>
        {[...nodes.values()].map((node) => {
          const rect = layout.rects.get(node.id)
          if (!rect) return null
          const isRoot = node.parentId == null
          const isLeaf = node.children.length === 0
          const isParent = !isRoot && !isLeaf
          const charge = progress.get(node.id)
          const selected = selectedNodeId === node.id || selectedNodeIds.includes(node.id)
          const custom = renderCard?.(node, { isRoot, isParent, isLeaf })
              const cardStyle: CSSProperties & Record<string, string | number> = {
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            '--jelly-flip-delay': `${flipDelayById.get(node.id) ?? 0}ms`,
          }
          return (
            <div
              key={node.id}
              data-jelly-node={node.id}
              className={[
                'jelly-stage-node',
                isRoot ? 'is-root' : isParent ? 'is-parent' : 'is-leaf',
                node.visual.revealed ? 'is-revealed' : 'is-concealed',
                selected ? 'is-selected' : '',
                node.visual.muted ? 'is-muted' : '',
              ].filter(Boolean).join(' ')}
              style={cardStyle}
              onClick={(event) => handleNodeClick(event, node)}
              onContextMenu={(event) => handleNodeContextMenu(event, node)}
              onPointerEnter={() => onNodeHover?.(node.id)}
              onPointerLeave={() => onNodeHover?.(null)}
            >
              {custom ?? (
                <>
                  {isRoot ? <span className="jelly-stage-root-tag">MEMORY PALACE CORE</span> : null}
                  {isParent ? (
                    <>
                      <div className="jelly-stage-parent-head"><span>CHAPTER</span><span>{charge?.done ?? 0} / {charge?.total ?? node.children.length}</span></div>
                      <div className="jelly-stage-title">{node.text}</div>
                      <div className="jelly-stage-meter"><span style={{ width: `${charge ? Math.round((charge.done / Math.max(1, charge.total)) * 100) : 0}%` }} /></div>
                    </>
                  ) : isLeaf ? (
                    turningIds.has(node.id) ? (
                      <div className="jelly-stage-flipper is-turning" data-flipped={node.visual.revealed ? 'true' : 'false'}>
                        <div className="jelly-stage-face jelly-stage-front"><span>🔲 点击翻开</span></div>
                        <div className="jelly-stage-face jelly-stage-back"><span>{node.text}</span><small>右键收回</small></div>
                      </div>
                    ) : node.visual.revealed ? (
                      <div className="jelly-stage-face jelly-stage-back is-flat"><span>{node.text}</span><small>右键收回</small></div>
                    ) : (
                      <div className="jelly-stage-face jelly-stage-front is-flat"><span>🔲 点击翻开</span></div>
                    )
                  ) : null}
                  {isRoot ? <div className="jelly-stage-title">{node.text}</div> : null}
                  {(isParent || isRoot) && charge?.mastered ? <div className={['jelly-stage-stamp', isRoot ? 'jelly-stage-root-stamp' : ''].filter(Boolean).join(' ')}>MASTERED</div> : null}
                  {(isLeaf || isParent) && prompt?.nodeId === node.id ? (
                    <div className="jelly-stage-hint">{prompt.text}</div>
                  ) : (isLeaf || isParent) ? (
                    <div className="jelly-stage-hint jelly-stage-hint-hover">{isLeaf ? node.visual.revealed ? '右键收回' : '点击翻开' : '右键收起子节点'}</div>
                  ) : null}
                </>
              )}
            </div>
          )
        })}
      </div>
      ) : null}
    </div>
  )
})
