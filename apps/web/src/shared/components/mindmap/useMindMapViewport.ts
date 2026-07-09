import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useReactFlow, type Node } from '@xyflow/react'
import type { GraphData } from './adapter'
import { getEventFeedbackPoint, hasMeaningfulSizeChange } from './mindMapCanvasGeometry'
import {
  DROP_HIT_PADDING_X,
  DROP_HIT_PADDING_Y,
  getResolvedNodeSize,
  TOOLBAR_HEIGHT,
  type DropMode,
  type NodeSize,
  type PreviewState,
} from './layout'
import type { MindMapCanvasViewCommand, MindMapMobileViewPolicy } from './MindMapCanvas'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'

const COLUMN_PROBE_PX = 240

interface UseMindMapViewportInput {
  frameRef: RefObject<HTMLDivElement | null>
  graphNodes: GraphData['nodes']
  nodes: Node[]
  measuredNodeSizesRef: RefObject<Map<string, NodeSize>>
  isDraggingNodeRef: RefObject<boolean>
  focusMode: boolean
  readonly: boolean
  mobileViewPolicy: MindMapMobileViewPolicy
  toolbarVisible: boolean
  viewCommand: MindMapCanvasViewCommand | null
  setNodeSizeVersion: (updater: (version: number) => number) => void
}

export function useMindMapViewport({
  frameRef,
  graphNodes,
  nodes,
  measuredNodeSizesRef,
  isDraggingNodeRef,
  focusMode,
  readonly,
  mobileViewPolicy,
  toolbarVisible,
  viewCommand,
  setNodeSizeVersion,
}: UseMindMapViewportInput) {
  const { fitView, zoomIn, zoomOut, setCenter } = useReactFlow()
  const pendingMeasuredNodeSizesRef = useRef<Map<string, NodeSize>>(new Map())
  const measureFrameRef = useRef<number | null>(null)
  const handledViewCommandNonceRef = useRef<number | null>(null)
  const lastPreviewFeedbackRef = useRef('')
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const isCanvasReady = canvasSize.width > 0 && canvasSize.height > 0
  const mobileGuidedActive =
    mobileViewPolicy === 'guided' ||
    (mobileViewPolicy === 'auto' &&
      readonly &&
      canvasSize.width > 0 &&
      canvasSize.width < 768)
  const childrenByParent = useMemo(() => {
    const next = new Map<string, string[]>()
    for (const node of graphNodes) {
      if (!node.parentId) continue
      const children = next.get(node.parentId) ?? []
      children.push(node.id)
      next.set(node.parentId, children)
    }
    return next
  }, [graphNodes])
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const nodesByColumn = useMemo(() => {
    const next = new Map<number, Node[]>()
    for (const node of nodes) {
      const column = Math.round(node.position.x)
      const columnNodes = next.get(column) ?? []
      columnNodes.push(node)
      next.set(column, columnNodes)
    }
    return next
  }, [nodes])

  const runFitView = useCallback(
    (duration = 300) => {
      if (!isCanvasReady) return
      requestAnimationFrame(() => {
        fitView({
          duration,
          padding: mobileGuidedActive ? 0.18 : focusMode ? 0.03 : 0.06,
          includeHiddenNodes: true,
          minZoom: mobileGuidedActive ? 0.34 : 0.42,
          maxZoom: mobileGuidedActive ? 1.02 : 1.15,
        })
      })
    },
    [fitView, focusMode, isCanvasReady, mobileGuidedActive],
  )

  const centerNodeInCanvas = useCallback(
    (nodeId: string | null | undefined, duration = 240) => {
      if (!nodeId || !isCanvasReady) return
      const target = nodes.find((node) => node.id === nodeId)
      if (!target) return
      const size = getResolvedNodeSize(target, undefined, measuredNodeSizesRef.current)
      setCenter(
        target.position.x + size.width / 2,
        target.position.y + size.height / 2,
        {
          duration,
          zoom: mobileGuidedActive ? 1.02 : undefined,
        },
      )
    },
    [isCanvasReady, measuredNodeSizesRef, mobileGuidedActive, nodes, setCenter],
  )

  useLayoutEffect(() => {
    const element = frameRef.current
    if (!element) return

    const updateSize = () => {
      setCanvasSize({
        width: element.clientWidth,
        height: Math.max(
          element.clientHeight - (toolbarVisible ? TOOLBAR_HEIGHT : 0),
          0,
        ),
      })
    }

    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [frameRef, toolbarVisible])

  const checkOverlap = useCallback(
    (dragId: string, draggedNode?: Node, event?: unknown): PreviewState | null | undefined => {
      const dragNode = nodesById.get(dragId)
      const activeNode = draggedNode ?? dragNode
      if (!activeNode) return undefined

      const measuredSizes = measuredNodeSizesRef.current
      const activeSize = getResolvedNodeSize(activeNode, undefined, measuredSizes)
      const cx = activeNode.position.x + activeSize.width / 2
      const cy = activeNode.position.y + activeSize.height / 2
      let closest: { id: string; dist: number; mode: DropMode } | null = null
      const blockedIds = new Set<string>()
      const stack = [...(childrenByParent.get(dragId) ?? [])]
      while (stack.length > 0) {
        const currentId = stack.pop()!
        if (blockedIds.has(currentId)) continue
        blockedIds.add(currentId)
        stack.push(...(childrenByParent.get(currentId) ?? []))
      }
      const candidates = new Map<string, Node>()
      for (const [column, columnNodes] of nodesByColumn) {
        if (Math.abs(column - activeNode.position.x) <= COLUMN_PROBE_PX) {
          for (const node of columnNodes) {
            candidates.set(node.id, node)
          }
        }
      }

      for (const node of candidates.values()) {
        if (node.id === dragId) continue
        if (blockedIds.has(node.id)) continue
        const { width, height } = getResolvedNodeSize(node, undefined, measuredSizes)
        const nx = node.position.x + width / 2
        const ny = node.position.y + height / 2
        const distSquared = (cx - nx) ** 2 + (cy - ny) ** 2
        const withinX =
          cx >= node.position.x - DROP_HIT_PADDING_X &&
          cx <= node.position.x + width + DROP_HIT_PADDING_X
        const withinY =
          cy >= node.position.y - DROP_HIT_PADDING_Y &&
          cy <= node.position.y + height + DROP_HIT_PADDING_Y
        const hitRadius = Math.max(width, 96)
        if ((withinX && withinY) || distSquared < hitRadius ** 2) {
          const relativeY = cy - node.position.y
          const mode =
            relativeY < height * 0.28
              ? 'before'
              : relativeY > height * 0.72
                ? 'after'
                : 'inside'
          if (!closest || distSquared < closest.dist) {
            closest = { id: node.id, dist: distSquared, mode }
          }
        }
      }

      const nextSignature = closest ? `${dragId}:${closest.id}:${closest.mode}` : ''
      if (nextSignature === lastPreviewFeedbackRef.current) {
        return undefined
      }
      if (nextSignature) {
        dispatchGlobalFeedback('node_move', {
          point: getEventFeedbackPoint(event),
          origin: 'node',
        })
      }
      lastPreviewFeedbackRef.current = nextSignature
      return closest ? { sourceId: dragId, targetId: closest.id, mode: closest.mode } : null
    },
    [childrenByParent, measuredNodeSizesRef, nodesByColumn, nodesById],
  )

  const flushPendingMeasuredNodeSizes = useCallback(() => {
    if (measureFrameRef.current !== null) {
      cancelAnimationFrame(measureFrameRef.current)
      measureFrameRef.current = null
    }
    if (pendingMeasuredNodeSizesRef.current.size === 0) return false

    let changed = false
    for (const [nodeId, size] of pendingMeasuredNodeSizesRef.current) {
      if (hasMeaningfulSizeChange(measuredNodeSizesRef.current, nodeId, size)) {
        measuredNodeSizesRef.current.set(nodeId, size)
        changed = true
      }
    }
    pendingMeasuredNodeSizesRef.current.clear()
    if (changed) {
      setNodeSizeVersion((version) => version + 1)
    }
    return changed
  }, [measuredNodeSizesRef, setNodeSizeVersion])

  const scheduleMeasuredNodeSizeFlush = useCallback(() => {
    if (measureFrameRef.current !== null) return
    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = null
      flushPendingMeasuredNodeSizes()
    })
  }, [flushPendingMeasuredNodeSizes])

  const handleNodeMeasure = useCallback((nodeId: string, size: NodeSize) => {
    if (!hasMeaningfulSizeChange(measuredNodeSizesRef.current, nodeId, size)) {
      return
    }
    if (isDraggingNodeRef.current) {
      if (hasMeaningfulSizeChange(pendingMeasuredNodeSizesRef.current, nodeId, size)) {
        pendingMeasuredNodeSizesRef.current.set(nodeId, size)
      }
      return
    }

    if (hasMeaningfulSizeChange(pendingMeasuredNodeSizesRef.current, nodeId, size)) {
      pendingMeasuredNodeSizesRef.current.set(nodeId, size)
      scheduleMeasuredNodeSizeFlush()
    }
  }, [isDraggingNodeRef, measuredNodeSizesRef, scheduleMeasuredNodeSizeFlush])

  const resetPreviewFeedback = useCallback(() => {
    lastPreviewFeedbackRef.current = ''
  }, [])

  const zoomInCanvas = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'ZOOM',
    })
    zoomIn({ duration: 180 })
  }, [zoomIn])

  const zoomOutCanvas = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'ZOOM',
    })
    zoomOut({ duration: 180 })
  }, [zoomOut])

  useEffect(() => {
    if (!mobileGuidedActive || !isCanvasReady || graphNodes.length === 0) return
    runFitView(180)
  }, [graphNodes.length, isCanvasReady, mobileGuidedActive, runFitView])

  useEffect(() => {
    if (!viewCommand || !isCanvasReady) return
    if (handledViewCommandNonceRef.current === viewCommand.nonce) return
    handledViewCommandNonceRef.current = viewCommand.nonce
    if (viewCommand.type === 'fit') {
      runFitView(220)
      return
    }
    centerNodeInCanvas(viewCommand.nodeId, 220)
  }, [centerNodeInCanvas, isCanvasReady, runFitView, viewCommand])

  useEffect(() => {
    return () => {
      if (measureFrameRef.current !== null) {
        cancelAnimationFrame(measureFrameRef.current)
      }
    }
  }, [])

  return {
    canvasSize,
    isCanvasReady,
    mobileGuidedActive,
    runFitView,
    centerNodeInCanvas,
    checkOverlap,
    handleNodeMeasure,
    flushPendingMeasuredNodeSizes,
    resetPreviewFeedback,
    zoomInCanvas,
    zoomOutCanvas,
  }
}
