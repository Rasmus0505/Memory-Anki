import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { readRevealPhase } from './useMindMapRevealMotion'

const SETTLE_DELAY_MS = 650
const MAX_ANIMATED_PER_BATCH = 40

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function escapeId(id: string) {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/"/g, '\\"')
}

/**
 * Animates only ids that are new since the last render (expand, add child, extract).
 * Ids re-mounted by viewport virtualization are already "seen" and never replay.
 */
export function useMindMapEnterMotion(
  container: RefObject<HTMLElement | null>,
  nodes: readonly Node[],
  edges: readonly Edge[],
) {
  const [settled, setSettled] = useState(false)
  const seenNodes = useRef<Set<string> | null>(null)
  const seenEdges = useRef<Set<string> | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), SETTLE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const nodeIds = nodes.map((node) => node.id)
    const edgeIds = edges.map((edge) => edge.id)
    const previousNodes = seenNodes.current
    const previousEdges = seenEdges.current
    seenNodes.current = new Set([...(previousNodes ?? []), ...nodeIds])
    seenEdges.current = new Set([...(previousEdges ?? []), ...edgeIds])
    if (!settled || !previousNodes || !previousEdges) return
    const root = container.current
    if (!root || prefersReducedMotion()) return

    // Review/practice cards (and their incoming edges) are owned by useMindMapRevealMotion.
    const revealOwned = new Set(nodes.filter((node) => readRevealPhase(node) !== 'other').map((node) => node.id))
    const freshNodes = nodeIds
      .filter((id) => !previousNodes.has(id) && !revealOwned.has(id))
      .slice(0, MAX_ANIMATED_PER_BATCH)
    const freshEdges = edges
      .filter((edge) => !previousEdges.has(edge.id) && !revealOwned.has(edge.target))
      .map((edge) => edge.id)
      .slice(0, MAX_ANIMATED_PER_BATCH)
    if (freshNodes.length === 0 && freshEdges.length === 0) return

    const frame = requestAnimationFrame(() => {
      freshNodes.forEach((id, index) => {
        const card = root.querySelector<HTMLElement>(`.react-flow__node[data-id="${escapeId(id)}"] .mindmap-node-shell`)
        // Dealt from the parent side: the card swings open on its left hinge.
        card?.animate?.(
          [
            { opacity: 0, transformOrigin: '0% 50%', transform: 'perspective(700px) rotateY(-68deg) translateX(-14px) scale(0.9)' },
            { opacity: 1, transformOrigin: '0% 50%', transform: 'perspective(700px) rotateY(9deg) translateX(0) scale(1.02)', offset: 0.68 },
            { opacity: 1, transformOrigin: '0% 50%', transform: 'perspective(700px) rotateY(0deg) translateX(0) scale(1)' },
          ],
          { duration: 420, delay: Math.min(index * 32, 320), easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
        )
      })
      freshEdges.forEach((id, index) => {
        const path = root.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${escapeId(id)}"] .react-flow__edge-path`)
        if (!path || typeof path.getTotalLength !== 'function' || typeof path.animate !== 'function') return
        if (path.style.strokeDasharray) return
        const length = Math.max(1, Math.ceil(path.getTotalLength()))
        path.animate(
          [
            { strokeDasharray: `${length} ${length}`, strokeDashoffset: length },
            { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 },
          ],
          { duration: 420, delay: Math.min(index * 22, 260), easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'backwards' },
        )
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [container, edges, nodes, settled])

  return settled
}
