import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  useReactFlow,
  type Node,
  type OnMove,
  type Viewport,
} from '@xyflow/react'
import type { GraphData } from './adapter'
import { getEventFeedbackPoint, hasMeaningfulSizeChange } from './mindMapCanvasGeometry'
import {
  DROP_HIT_PADDING_X,
  DROP_HIT_PADDING_Y,
  DROP_LEAVE_EXTRA_PX,
  DROP_NEAR_THRESHOLD_PX,
  getResolvedNodeSize,
  isWithinStructureDropLeaveZone,
  resolveStructureDropMode,
  type DropMode,
  type NodeSize,
  type PreviewState,
} from './layout'
import type {
  MindMapCanvasViewCommand,
  MindMapContentChangeViewportPolicy,
  MindMapMobileViewPolicy,
} from './MindMapCanvas'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'

interface UseMindMapViewportInput {
  canvasRef: RefObject<HTMLDivElement | null>
  controlledViewport: Viewport
  onControlledViewportChange: (viewport: Viewport) => void
  graphNodes: GraphData['nodes']
  nodes: Node[]
  measuredNodeSizesRef: RefObject<Map<string, NodeSize>>
  isDraggingNodeRef: RefObject<boolean>
  focusMode: boolean
  readonly: boolean
  mobileViewPolicy: MindMapMobileViewPolicy
  contentChangeViewportPolicy: MindMapContentChangeViewportPolicy
  viewCommand: MindMapCanvasViewCommand | null
  setNodeSizeVersion: (updater: (version: number) => number) => void
}

export function useMindMapViewport({
  canvasRef,
  controlledViewport,
  onControlledViewportChange,
  graphNodes,
  nodes,
  measuredNodeSizesRef,
  isDraggingNodeRef,
  focusMode,
  readonly,
  mobileViewPolicy,
  contentChangeViewportPolicy,
  viewCommand,
  setNodeSizeVersion,
}: UseMindMapViewportInput) {
  const { fitView, getViewport, setViewport, zoomIn, zoomOut, setCenter, screenToFlowPosition } =
    useReactFlow()
  const pendingMeasuredNodeSizesRef = useRef<Map<string, NodeSize>>(new Map())
  const measureFrameRef = useRef<number | null>(null)
  const handledViewCommandNonceRef = useRef<number | null>(null)
  const lastPreviewFeedbackRef = useRef('')
  const lastPreviewStateRef = useRef<PreviewState | null>(null)
  const preservedViewportRef = useRef<Viewport>(controlledViewport)
  const restoreViewportFrameRef = useRef<number | null>(null)
  const explicitViewportChangeRef = useRef(false)
  const manualViewportGestureRef = useRef(false)
  const explicitViewportTimeoutRef = useRef<number | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const isCanvasReady = canvasSize.width > 0 && canvasSize.height > 0
  const mobileGuidedActive =
    mobileViewPolicy === 'guided' ||
    (mobileViewPolicy === 'auto' &&
      readonly &&
      canvasSize.width > 0 &&
      canvasSize.width < 768)
  const preserveViewport = contentChangeViewportPolicy === 'preserve'
  const graphContentSignature = useMemo(() => JSON.stringify(graphNodes), [graphNodes])

  useLayoutEffect(() => {
    // Never let a mid-restore / programmatic camera write overwrite the lock.
    if (explicitViewportChangeRef.current) return
    preservedViewportRef.current = controlledViewport
  }, [controlledViewport])

  const restorePreservedViewport = useCallback((currentViewport?: Viewport) => {
    if (!preserveViewport || explicitViewportChangeRef.current) return
    if (manualViewportGestureRef.current) return
    const current = currentViewport ?? getViewport()
    const preserved = preservedViewportRef.current
    if (
      Math.abs(current.x - preserved.x) < 0.01 &&
      Math.abs(current.y - preserved.y) < 0.01 &&
      Math.abs(current.zoom - preserved.zoom) < 0.0001
    ) {
      return
    }
    if (restoreViewportFrameRef.current !== null) {
      cancelAnimationFrame(restoreViewportFrameRef.current)
    }
    // Mark explicit so RF move callbacks do not treat the correction as a new
    // "drift" and thrash between intermediate layout viewports.
    restoreViewportFrameRef.current = requestAnimationFrame(() => {
      restoreViewportFrameRef.current = null
      if (manualViewportGestureRef.current) return
      const locked = preservedViewportRef.current
      explicitViewportChangeRef.current = true
      void setViewport(locked, { duration: 0 })
      // Re-assert controlled source of truth on the next frame after RF applies.
      requestAnimationFrame(() => {
        const still = getViewport()
        if (
          Math.abs(still.x - locked.x) >= 0.01 ||
          Math.abs(still.y - locked.y) >= 0.01 ||
          Math.abs(still.zoom - locked.zoom) >= 0.0001
        ) {
          void setViewport(locked, { duration: 0 })
        }
        onControlledViewportChange(locked)
        preservedViewportRef.current = locked
        explicitViewportChangeRef.current = false
      })
    })
  }, [getViewport, onControlledViewportChange, preserveViewport, setViewport])

  const handleMoveStart = useCallback<OnMove>((event) => {
    if (!preserveViewport) return
    // RF passes a DOM event for pointer/wheel pans; programmatic moves use null/undefined.
    // Also accept WheelEvent-like objects so panOnScroll does not get yanked by restore.
    if (event) {
      manualViewportGestureRef.current = true
    }
  }, [preserveViewport])

  const handleViewportChange = useCallback((viewport: Viewport) => {
    // Programmatic restore / fit / center: ignore intermediate RF reports so they
    // cannot corrupt the locked camera that we are trying to re-assert.
    if (explicitViewportChangeRef.current) return
    if (!preserveViewport || manualViewportGestureRef.current) {
      preservedViewportRef.current = viewport
      onControlledViewportChange(viewport)
    }
    // In preserve mode without a user gesture, drop RF-driven drift entirely.
  }, [onControlledViewportChange, preserveViewport])

  const handleMove = useCallback<OnMove>((event, viewport) => {
    if (!preserveViewport) return
    if (explicitViewportChangeRef.current) return
    // Wheel pan sometimes skips a solid moveStart; treat any event-backed move as manual.
    if (event) {
      manualViewportGestureRef.current = true
    }
    if (manualViewportGestureRef.current) {
      preservedViewportRef.current = viewport
      onControlledViewportChange(viewport)
      return
    }
    restorePreservedViewport(viewport)
  }, [onControlledViewportChange, preserveViewport, restorePreservedViewport])

  const handleMoveEnd = useCallback<OnMove>((event, viewport) => {
    if (!preserveViewport) return
    if (explicitViewportChangeRef.current) {
      manualViewportGestureRef.current = false
      return
    }
    if (event) {
      manualViewportGestureRef.current = true
    }
    if (manualViewportGestureRef.current) {
      preservedViewportRef.current = viewport
      onControlledViewportChange(viewport)
    } else {
      restorePreservedViewport(viewport)
    }
    manualViewportGestureRef.current = false
  }, [onControlledViewportChange, preserveViewport, restorePreservedViewport])

  const runExplicitViewportChange = useCallback((change: () => void, duration: number) => {
    explicitViewportChangeRef.current = true
    if (explicitViewportTimeoutRef.current !== null) {
      window.clearTimeout(explicitViewportTimeoutRef.current)
    }
    change()
    explicitViewportTimeoutRef.current = window.setTimeout(() => {
      const viewport = getViewport()
      preservedViewportRef.current = viewport
      onControlledViewportChange(viewport)
      explicitViewportChangeRef.current = false
      explicitViewportTimeoutRef.current = null
    }, duration + 40)
  }, [getViewport, onControlledViewportChange])
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

  const runFitView = useCallback(
    (duration = 300) => {
      if (!isCanvasReady) return
      requestAnimationFrame(() => {
        runExplicitViewportChange(() => void fitView({
          duration,
          padding: mobileGuidedActive ? 0.18 : focusMode ? 0.03 : 0.06,
          includeHiddenNodes: true,
          minZoom: mobileGuidedActive ? 0.34 : 0.42,
          maxZoom: mobileGuidedActive ? 1.02 : 1.15,
        }), duration)
      })
    },
    [fitView, focusMode, isCanvasReady, mobileGuidedActive, runExplicitViewportChange],
  )

  const centerNodeInCanvas = useCallback(
    (nodeId: string | null | undefined, duration = 240) => {
      if (!nodeId || !isCanvasReady) return
      const target = nodes.find((node) => node.id === nodeId)
      if (!target) return
      const size = getResolvedNodeSize(target, undefined, measuredNodeSizesRef.current)
      runExplicitViewportChange(() => void setCenter(
        target.position.x + size.width / 2,
        target.position.y + size.height / 2,
        {
          duration,
          zoom: mobileGuidedActive ? 1.02 : undefined,
        },
      ), duration)
    },
    [isCanvasReady, measuredNodeSizesRef, mobileGuidedActive, nodes, runExplicitViewportChange, setCenter],
  )

  useLayoutEffect(() => {
    if (!preserveViewport || !isCanvasReady) return
    restorePreservedViewport()
  }, [isCanvasReady, preserveViewport, restorePreservedViewport])

  useLayoutEffect(() => {
    // Structure / graph payload changes re-layout nodes; keep the user's camera.
    restorePreservedViewport()
  }, [graphContentSignature, restorePreservedViewport])

  // Measure-driven re-layout rewrites node positions without changing graph
  // payload identity. Re-assert camera only when not mid node-drag.
  const layoutFingerprint = useMemo(
    () =>
      nodes
        .map((node) => `${node.id}:${Math.round(node.position.x)}:${Math.round(node.position.y)}`)
        .join('|'),
    [nodes],
  )

  useLayoutEffect(() => {
    if (!preserveViewport || !isCanvasReady) return
    if (isDraggingNodeRef.current) return
    // Never fight the user mid pan/zoom/wheel — that causes a one-frame camera flash.
    if (manualViewportGestureRef.current) return
    restorePreservedViewport()
  }, [isCanvasReady, isDraggingNodeRef, layoutFingerprint, preserveViewport, restorePreservedViewport])

  useLayoutEffect(() => {
    const element = canvasRef.current
    if (!element) return

    const updateSize = () => {
      const width = element.clientWidth
      const height = element.clientHeight
      // 窗口失焦、切换全屏或系统工作区变化时可能短暂读到 0，保留最后一次有效尺寸以免卸载画布。
      if (width <= 0 || height <= 0) return
      setCanvasSize({ width, height })
    }

    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [canvasRef])

  const checkOverlap = useCallback(
    (
      dragId: string,
      draggedNode?: Node,
      event?: unknown,
      dragSourceIds: readonly string[] = [dragId],
    ): PreviewState | null | undefined => {
      const dragNode = nodesById.get(dragId)
      const activeNode = draggedNode ?? dragNode
      if (!activeNode) return undefined

      const measuredSizes = measuredNodeSizesRef.current
      const activeSize = getResolvedNodeSize(activeNode, undefined, measuredSizes)
      // Prefer pointer position (matches where the user is aiming). Fall back to card center.
      const pointer = getEventFeedbackPoint(event)
      let probeX = activeNode.position.x + activeSize.width / 2
      let probeY = activeNode.position.y + activeSize.height / 2
      if (pointer) {
        try {
          const flowPoint = screenToFlowPosition({ x: pointer.x, y: pointer.y })
          probeX = flowPoint.x
          probeY = flowPoint.y
        } catch {
          // Keep card-center fallback if RF transform is unavailable mid-unmount.
        }
      }

      const sourceIds = dragSourceIds.length > 0 ? [...dragSourceIds] : [dragId]
      const sourceIdSet = new Set(sourceIds)

      // Block targets that are any dragged source or descendants of any source.
      const blockedIds = new Set<string>(sourceIds)
      for (const sourceId of sourceIds) {
        const stack = [...(childrenByParent.get(sourceId) ?? [])]
        while (stack.length > 0) {
          const currentId = stack.pop()!
          if (blockedIds.has(currentId)) continue
          blockedIds.add(currentId)
          stack.push(...(childrenByParent.get(currentId) ?? []))
        }
      }

      let closest: { id: string; dist: number; mode: DropMode; bodyHit: boolean } | null = null

      for (const node of nodes) {
        if (sourceIdSet.has(node.id) || blockedIds.has(node.id)) continue
        const { width, height } = getResolvedNodeSize(node, undefined, measuredSizes)
        const rect = {
          x: node.position.x,
          y: node.position.y,
          width,
          height,
        }
        const graphParentId = graphNodes.find((item) => item.id === node.id)?.parentId
        const isRoot = graphParentId == null
        const mode = resolveStructureDropMode(probeX, probeY, rect, {
          isRoot,
          nearThresholdPx: DROP_NEAR_THRESHOLD_PX,
        })
        if (!mode) continue

        const bodyHit =
          probeX >= rect.x &&
          probeX <= rect.x + width &&
          probeY >= rect.y &&
          probeY <= rect.y + height

        // Prefer body hits; score near-gap candidates by distance to unpadded card.
        const left = rect.x - DROP_HIT_PADDING_X
        const right = rect.x + width + DROP_HIT_PADDING_X
        const top = rect.y - DROP_HIT_PADDING_Y
        const bottom = rect.y + height + DROP_HIT_PADDING_Y
        const dx =
          probeX < left ? left - probeX : probeX > right ? probeX - right : 0
        const dy =
          probeY < top ? top - probeY : probeY > bottom ? probeY - bottom : 0
        const edgeDist = Math.hypot(dx, dy)
        const score = bodyHit ? edgeDist * 0.25 : edgeDist + 8
        if (
          !closest ||
          (bodyHit && !closest.bodyHit) ||
          (bodyHit === closest.bodyHit && score < closest.dist)
        ) {
          closest = { id: node.id, dist: score, mode, bodyHit }
        }
      }

      const nextPreview: PreviewState | null = closest
        ? {
            sourceId: dragId,
            sourceIds,
            targetId: closest.id,
            mode: closest.mode,
          }
        : null

      // Leave hysteresis: one-frame misses should not wipe the active placeholder.
      if (!nextPreview && lastPreviewStateRef.current) {
        const previous = lastPreviewStateRef.current
        if (!blockedIds.has(previous.targetId) && !sourceIdSet.has(previous.targetId)) {
          const previousNode = nodesById.get(previous.targetId)
          if (previousNode) {
            const { width, height } = getResolvedNodeSize(previousNode, undefined, measuredSizes)
            const isRoot =
              graphNodes.find((item) => item.id === previous.targetId)?.parentId == null
            if (
              isWithinStructureDropLeaveZone(
                probeX,
                probeY,
                {
                  x: previousNode.position.x,
                  y: previousNode.position.y,
                  width,
                  height,
                },
                previous.mode,
                {
                  isRoot,
                  nearThresholdPx: DROP_NEAR_THRESHOLD_PX,
                  leaveExtraPx: DROP_LEAVE_EXTRA_PX,
                },
              )
            ) {
              return undefined
            }
          }
        }
      }

      const sourceKey = sourceIds.slice().sort().join(',')
      const nextSignature = nextPreview
        ? `${sourceKey}:${nextPreview.targetId}:${nextPreview.mode}`
        : ''
      if (nextSignature === lastPreviewFeedbackRef.current) {
        return undefined
      }
      // No hover audio here — node_move on every target change spams during drag.
      lastPreviewFeedbackRef.current = nextSignature
      lastPreviewStateRef.current = nextPreview
      return nextPreview
    },
    [childrenByParent, graphNodes, measuredNodeSizesRef, nodes, nodesById, screenToFlowPosition],
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
    lastPreviewStateRef.current = null
  }, [])

  const zoomInCanvas = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'ZOOM',
    })
    runExplicitViewportChange(() => void zoomIn({ duration: 180 }), 180)
  }, [runExplicitViewportChange, zoomIn])

  const zoomOutCanvas = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'ZOOM',
    })
    runExplicitViewportChange(() => void zoomOut({ duration: 180 }), 180)
  }, [runExplicitViewportChange, zoomOut])

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
      if (restoreViewportFrameRef.current !== null) {
        cancelAnimationFrame(restoreViewportFrameRef.current)
      }
      if (explicitViewportTimeoutRef.current !== null) {
        window.clearTimeout(explicitViewportTimeoutRef.current)
      }
    }
  }, [])

  return {
    canvasSize,
    isCanvasReady,
    mobileGuidedActive,
    preserveViewport,
    controlledViewport,
    handleMoveStart,
    handleMove,
    handleMoveEnd,
    handleViewportChange,
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
