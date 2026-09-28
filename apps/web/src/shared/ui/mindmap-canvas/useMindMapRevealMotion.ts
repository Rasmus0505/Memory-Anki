import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { Edge, Node } from '@xyflow/react'

const FLIP_ID = 'mindmap-reveal-flip'
const FLIP_MS = 560
/** Edge-on moment: the paper back is swapped for the answer face here. */
const FLIP_TURN = 0.42
const STEP_MS = 45
const MAX_SPREAD_MS = 540
const MAX_FLIPS_PER_BATCH = 40
const MAX_BURSTS_PER_BATCH = 6
const INK_LEAD_MS = 110
const PERSPECTIVE = 'perspective(680px)'

type RevealPhase = 'hidden' | 'revealed' | 'other'

interface NodeVisualLike {
  concealText?: boolean
  revealed?: boolean
}

function readMetadata(node: Node) {
  return ((node.data as { metadata?: Record<string, unknown> } | undefined)?.metadata ?? {}) as {
    depth?: number
    visual?: NodeVisualLike
  }
}

function phaseOf(node: Node): RevealPhase {
  const visual = readMetadata(node).visual
  if (visual?.concealText) return 'hidden'
  // Edit mode drops reveal state entirely ('other'), so leaving review never flips.
  if (visual?.revealed) return 'revealed'
  return 'other'
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function escapeId(id: string) {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/"/g, '\\"')
}

function clearFx(card: HTMLElement) {
  card.getAnimations?.().forEach((animation) => {
    if (animation.id === FLIP_ID) animation.cancel()
  })
  card.querySelectorAll('[data-mm-flip-fx]').forEach((element) => element.remove())
}

function fxElement(className: string, parent: HTMLElement) {
  const element = document.createElement('span')
  element.dataset.mmFlipFx = 'true'
  element.className = className
  element.setAttribute('aria-hidden', 'true')
  parent.appendChild(element)
  return element
}

function removeWhenDone(animation: Animation, elements: Element[]) {
  animation.finished
    .catch(() => undefined)
    .then(() => elements.forEach((element) => element.remove()))
}

function flipCard(card: HTMLElement, delay: number, burst: boolean) {
  clearFx(card)
  const cover = fxElement('mindmap-flip-cover', card)
  cover.innerHTML = '<span class="mindmap-node-concealed">待回忆</span>'
  const sheen = fxElement('mindmap-flip-sheen', card)

  const flip = card.animate(
    [
      { transform: `${PERSPECTIVE} rotateX(0deg) scale(1)`, easing: 'cubic-bezier(0.55, 0, 0.85, 0.35)' },
      { transform: `${PERSPECTIVE} rotateX(-90deg) scale(1.07)`, offset: FLIP_TURN },
      // Same edge-on pose from the other side: the jump is invisible and the rotation reads as continuous.
      { transform: `${PERSPECTIVE} rotateX(90deg) scale(1.07)`, offset: FLIP_TURN + 0.0001, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)' },
      { transform: `${PERSPECTIVE} rotateX(-13deg) scale(1.035)`, offset: 0.74, easing: 'cubic-bezier(0.4, 0, 0.3, 1)' },
      { transform: `${PERSPECTIVE} rotateX(4deg) scale(1)`, offset: 0.88 },
      { transform: `${PERSPECTIVE} rotateX(0deg) scale(1)` },
    ],
    { duration: FLIP_MS, delay, fill: 'backwards', id: FLIP_ID },
  )
  const base = getComputedStyle(card).boxShadow
  const resting = base && base !== 'none' ? base : '0 0 0 0 transparent'
  card.animate(
    [
      { boxShadow: resting },
      { boxShadow: '0 3px 6px -2px rgb(120 60 10 / 0.2)', offset: FLIP_TURN },
      {
        boxShadow: '0 20px 36px -12px rgb(150 70 10 / 0.5), 0 0 0 2px rgb(232 135 42 / 0.55), 0 0 26px rgb(232 135 42 / 0.35)',
        offset: 0.74,
      },
      { boxShadow: resting },
    ],
    { duration: FLIP_MS + 260, delay, id: FLIP_ID, easing: 'ease-out' },
  )
  const coverAnimation = cover.animate(
    [{ opacity: 1 }, { opacity: 1, offset: FLIP_TURN }, { opacity: 0, offset: FLIP_TURN + 0.0001 }, { opacity: 0 }],
    { duration: FLIP_MS, delay, fill: 'both' },
  )
  const sheenAnimation = sheen.animate(
    [
      { opacity: 0, backgroundPosition: '140% 0' },
      { opacity: 0, backgroundPosition: '140% 0', offset: 0.5 },
      { opacity: 1, backgroundPosition: '60% 0', offset: 0.66 },
      { opacity: 0, backgroundPosition: '-40% 0' },
    ],
    { duration: FLIP_MS + 180, delay, fill: 'both', easing: 'ease-out' },
  )
  removeWhenDone(coverAnimation, [cover])
  removeWhenDone(sheenAnimation, [sheen])
  if (burst) sparkBurst(card, delay + FLIP_MS * 0.7)
}

function sparkBurst(card: HTMLElement, delay: number) {
  const count = 7
  for (let index = 0; index < count; index += 1) {
    const spark = fxElement('mindmap-flip-spark', card)
    const angle = (Math.PI * 2 * index) / count + (Math.random() - 0.5) * 0.6
    const distance = 22 + Math.random() * 16
    const x = Math.cos(angle) * distance
    const y = Math.sin(angle) * distance * 0.7
    const animation = spark.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.4)' },
        { opacity: 1, transform: `translate(calc(-50% + ${x * 0.5}px), calc(-50% + ${y * 0.5}px)) scale(1.1)`, offset: 0.3 },
        { opacity: 0, transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(0.3)` },
      ],
      { duration: 520 + Math.random() * 180, delay, fill: 'both', easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
    )
    removeWhenDone(animation, [spark])
  }
}

function inkEdge(path: SVGPathElement, delay: number) {
  if (typeof path.getTotalLength !== 'function' || typeof path.animate !== 'function') return
  const length = Math.max(1, Math.ceil(path.getTotalLength()))
  path.animate(
    [
      { strokeDasharray: `${length} ${length}`, strokeDashoffset: length, stroke: 'rgb(232 135 42)', strokeWidth: 3 },
      { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0, stroke: 'rgb(232 135 42)', strokeWidth: 3, offset: 0.62 },
      { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0 },
    ],
    { duration: 520, delay, fill: 'backwards', easing: 'cubic-bezier(0.65, 0, 0.35, 1)' },
  )
}

/**
 * 3D paper flip for nodes that go from concealed to revealed. A branch reveal flips
 * like dominoes (depth, then top-to-bottom), and each incoming edge is inked in just
 * before its card turns over.
 */
export function useMindMapRevealMotion(
  container: RefObject<HTMLElement | null>,
  nodes: readonly Node[],
  edges: readonly Edge[],
) {
  const phases = useRef<Map<string, RevealPhase> | null>(null)

  useLayoutEffect(() => {
    const previous = phases.current
    const next = new Map<string, RevealPhase>()
    for (const node of nodes) next.set(node.id, phaseOf(node))
    phases.current = next
    if (!previous) return
    const root = container.current
    if (!root || prefersReducedMotion()) return

    const flipped = nodes.filter((node) => previous.get(node.id) === 'hidden' && next.get(node.id) === 'revealed')
    if (flipped.length === 0) return

    const targets = flipped.slice(0, MAX_FLIPS_PER_BATCH).flatMap((node) => {
      const card = root.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${escapeId(node.id)}"] .mindmap-node-card`,
      )
      if (!card || typeof card.animate !== 'function') return []
      return [{ node, card, depth: Number(readMetadata(node).depth ?? 0), top: card.getBoundingClientRect().top }]
    })
    targets.sort((a, b) => a.depth - b.depth || a.top - b.top)
    const step = targets.length > 1 ? Math.min(STEP_MS, MAX_SPREAD_MS / (targets.length - 1)) : 0

    targets.forEach((target, index) => {
      const delay = Math.round(index * step)
      const incoming = edges.find((edge) => edge.target === target.node.id)
      const path = incoming
        ? root.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${escapeId(incoming.id)}"] .react-flow__edge-path`)
        : null
      if (path) {
        inkEdge(path, delay)
        flipCard(target.card, delay + INK_LEAD_MS, index < MAX_BURSTS_PER_BATCH)
      } else {
        flipCard(target.card, delay, index < MAX_BURSTS_PER_BATCH)
      }
    })
  }, [container, edges, nodes])
}
