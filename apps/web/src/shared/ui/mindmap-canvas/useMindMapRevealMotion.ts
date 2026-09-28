import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { emitFoldTrail, emitGoldDustSettle, emitGoldRain, rectCenter } from '@/shared/feedback/particles'

const FLIP_ID = 'mindmap-reveal-flip'
const FLIP_MS = 560
/** Edge-on moment: the paper back is swapped for the answer face here. */
const FLIP_TURN = 0.42
const STEP_MS = 45
const MAX_SPREAD_MS = 540
const MAX_CARDS_PER_BATCH = 40
const MAX_BURSTS_PER_BATCH = 6
/** A reveal this wide is a whole branch landing: finish it with gold rain over the map. */
const GOLD_RAIN_MIN_FLIPS = 2
/** Bubbled from a card when its flip lands, so hosts can relay particles to their own HUD. */
export const MINDMAP_CARD_LANDED_EVENT = 'memory-anki:mindmap-card-landed'
const FOLD_MS = 420
const MAX_FOLDS_PER_BATCH = 24
const INK_LEAD_MS = 110
/** React Flow mounts new nodes (and their edges, after measuring) a few frames later. */
const MOUNT_WAIT_MS = 1200
const PERSPECTIVE = 'perspective(680px)'

export type RevealPhase = 'hidden' | 'revealed' | 'other'

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

/** 'other' = no reveal state at all (edit mode), which never animates. */
export function readRevealPhase(node: Node): RevealPhase {
  const visual = readMetadata(node).visual
  if (visual?.concealText) return 'hidden'
  if (visual?.revealed) return 'revealed'
  return 'other'
}

export interface RevealMotionPlan {
  /** Cards that turn over to their answer, in domino order. */
  flips: string[]
  /** New 待回忆 cards that are dealt onto the map. */
  deals: string[]
}

/**
 * A card flips when it turns from 待回忆 into its answer, or when it comes back
 * already revealed (a folded-away branch re-opening removes and re-adds its nodes).
 * The first projection never animates.
 */
export function planRevealMotion(
  previous: ReadonlyMap<string, RevealPhase> | null,
  nodes: readonly Node[],
): RevealMotionPlan {
  if (!previous || previous.size === 0) return { flips: [], deals: [] }
  const flips: Node[] = []
  const deals: Node[] = []
  for (const node of nodes) {
    const before = previous.get(node.id)
    const now = readRevealPhase(node)
    if (now === 'revealed' && (before === 'hidden' || before === undefined)) flips.push(node)
    else if (now === 'hidden' && before === undefined) deals.push(node)
  }
  const order = (a: Node, b: Node) =>
    Number(readMetadata(a).depth ?? 0) - Number(readMetadata(b).depth ?? 0)
    || (a.position?.y ?? 0) - (b.position?.y ?? 0)
  return { flips: flips.sort(order).map((node) => node.id), deals: deals.sort(order).map((node) => node.id) }
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function escapeId(id: string) {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/"/g, '\\"')
}

const cardSelector = (id: string) => `.react-flow__node[data-id="${escapeId(id)}"] .mindmap-node-card`
const edgeSelector = (id: string) => `.react-flow__edge[data-id="${escapeId(id)}"] .react-flow__edge-path`

function fxElement(className: string, parent: HTMLElement) {
  const element = document.createElement('span')
  element.dataset.mmFlipFx = 'true'
  element.className = className
  element.setAttribute('aria-hidden', 'true')
  parent.appendChild(element)
  return element
}

function removeWhenDone(animation: Animation, element: Element) {
  animation.finished.catch(() => undefined).then(() => element.remove())
}

function clearFx(card: HTMLElement) {
  card.getAnimations?.().forEach((animation) => {
    if (animation.id === FLIP_ID) animation.cancel()
  })
  card.querySelectorAll('[data-mm-flip-fx]').forEach((element) => element.remove())
}

function flipCard(card: HTMLElement, delay: number, burst: boolean) {
  clearFx(card)
  const cover = fxElement('mindmap-flip-cover', card)
  cover.innerHTML = '<span class="mindmap-node-concealed">待回忆</span>'
  const sheen = fxElement('mindmap-flip-sheen', card)

  card.animate(
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
  removeWhenDone(cover.animate(
    [{ opacity: 1 }, { opacity: 1, offset: FLIP_TURN }, { opacity: 0, offset: FLIP_TURN + 0.0001 }, { opacity: 0 }],
    { duration: FLIP_MS, delay, fill: 'both' },
  ), cover)
  removeWhenDone(sheen.animate(
    [
      { opacity: 0, backgroundPosition: '140% 0' },
      { opacity: 0, backgroundPosition: '140% 0', offset: 0.5 },
      { opacity: 1, backgroundPosition: '60% 0', offset: 0.66 },
      { opacity: 0, backgroundPosition: '-40% 0' },
    ],
    { duration: FLIP_MS + 180, delay, fill: 'both', easing: 'ease-out' },
  ), sheen)
  landCard(card, delay + FLIP_MS * 0.7, burst)
}

function dealCard(card: HTMLElement, delay: number) {
  card.animate(
    [
      { opacity: 0, transformOrigin: '0% 50%', transform: 'perspective(700px) rotateY(-68deg) translateX(-14px) scale(0.9)' },
      { opacity: 1, transformOrigin: '0% 50%', transform: 'perspective(700px) rotateY(9deg) translateX(0) scale(1.02)', offset: 0.68 },
      { opacity: 1, transformOrigin: '0% 50%', transform: 'perspective(700px) rotateY(0deg) translateX(0) scale(1)' },
    ],
    { duration: 420, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards', id: FLIP_ID },
  )
}

/** Gold dust settles as the card lands; its rect is read then, since the camera may be following. */
function landCard(card: HTMLElement, delay: number, burst: boolean) {
  window.setTimeout(() => {
    if (!card.isConnected) return
    if (burst) emitGoldDustSettle(card.getBoundingClientRect())
    card.dispatchEvent(new CustomEvent(MINDMAP_CARD_LANDED_EVENT, { bubbles: true }))
  }, delay)
}

function bumpCard(card: Element | null) {
  if (!card || typeof (card as HTMLElement).animate !== 'function') return
  // Standalone scale composes with the flip/positioning transforms instead of replacing them.
  ;(card as HTMLElement).animate([{ scale: '1' }, { scale: '1.1' }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(0.2, 1.5, 0.4, 1)' })
}

/**
 * Hidden children fold back into the card that hid them: a ghost of each leaving
 * node shrinks onto its surviving ancestor while ink and gold are drawn in after it.
 * Runs in the same commit the nodes leave, while React Flow still has their DOM.
 */
export function planFoldBack(
  previous: ReadonlyMap<string, RevealPhase> | null,
  previousParents: ReadonlyMap<string, string>,
  nodes: readonly Node[],
) {
  if (!previous || previous.size === 0) return []
  const present = new Set(nodes.map((node) => node.id))
  const folds: Array<{ id: string; into: string }> = []
  for (const [id, phase] of previous) {
    if (present.has(id) || phase === 'other') continue
    let parent = previousParents.get(id)
    while (parent && !present.has(parent)) parent = previousParents.get(parent)
    if (parent) folds.push({ id, into: parent })
  }
  return folds
}

const nodeSelector = (id: string) => `.react-flow__node[data-id="${escapeId(id)}"]`

function foldNode(root: HTMLElement, id: string, into: string) {
  const node = root.querySelector<HTMLElement>(nodeSelector(id))
  const parentCard = root.querySelector<HTMLElement>(cardSelector(into))
  if (!node || !parentCard || !node.parentElement || node.offsetWidth === 0) return
  const rect = node.getBoundingClientRect()
  const zoom = rect.width / node.offsetWidth || 1
  const from = rectCenter(rect)
  const to = rectCenter(parentCard.getBoundingClientRect())
  const ghost = node.cloneNode(true) as HTMLElement
  ghost.removeAttribute('data-id')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.pointerEvents = 'none'
  const inner = document.createElement('div')
  while (ghost.firstChild) inner.appendChild(ghost.firstChild)
  ghost.appendChild(inner)
  node.parentElement.appendChild(ghost)
  const dx = (to.x - from.x) / zoom
  const dy = (to.y - from.y) / zoom
  inner.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0 },
    ],
    { duration: FOLD_MS, easing: 'cubic-bezier(0.6, 0, 0.8, 0.4)', fill: 'forwards' },
  ).finished.catch(() => undefined).then(() => ghost.remove())
  emitFoldTrail(rect, () => (parentCard.isConnected ? rectCenter(parentCard.getBoundingClientRect()) : null), () => bumpCard(parentCard))
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

interface MountJob {
  selector: string
  /** `elapsed` = ms since the batch was planned, so late mounts keep the domino timing. */
  run: (element: Element, elapsed: number) => void
}

/** Runs each job as soon as its element exists (MutationObserver fires before paint). */
function runWhenMounted(root: HTMLElement, jobs: MountJob[], active: Set<() => void>) {
  const started = performance.now()
  const pending = new Set(jobs)
  const sweep = () => {
    for (const job of pending) {
      const element = root.querySelector(job.selector)
      if (!element) continue
      pending.delete(job)
      job.run(element, performance.now() - started)
    }
    return pending.size === 0
  }
  if (sweep() || typeof MutationObserver === 'undefined') return
  const observer = new MutationObserver(() => {
    if (sweep()) stop()
  })
  const timer = window.setTimeout(stop, MOUNT_WAIT_MS)
  function stop() {
    observer.disconnect()
    window.clearTimeout(timer)
    active.delete(stop)
  }
  observer.observe(root, { childList: true, subtree: true })
  active.add(stop)
}

/**
 * Review/practice card motion: recalled cards turn over like paper (domino order,
 * incoming edge inked just before), and new 待回忆 cards are dealt in on a hinge.
 */
export function useMindMapRevealMotion(
  container: RefObject<HTMLElement | null>,
  nodes: readonly Node[],
  edges: readonly Edge[],
) {
  const phases = useRef<Map<string, RevealPhase> | null>(null)
  const parents = useRef<Map<string, string>>(new Map())
  const activeWaits = useRef(new Set<() => void>())

  useEffect(() => {
    const waits = activeWaits.current
    return () => waits.forEach((stop) => stop())
  }, [])

  useLayoutEffect(() => {
    const previous = phases.current
    const previousParents = parents.current
    phases.current = new Map(nodes.map((node) => [node.id, readRevealPhase(node)]))
    parents.current = new Map(edges.map((edge) => [edge.target, edge.source]))
    const root = container.current
    if (!root || prefersReducedMotion() || typeof root.animate !== 'function') return
    const folds = planFoldBack(previous, previousParents, nodes)
    if (folds.length > 0 && folds.length <= MAX_FOLDS_PER_BATCH) {
      folds.forEach(({ id, into }) => foldNode(root, id, into))
    }
    const plan = planRevealMotion(previous, nodes)
    if (plan.flips.length === 0 && plan.deals.length === 0) return

    const incomingEdge = new Map(edges.map((edge) => [edge.target, edge.id]))
    const jobs: MountJob[] = []
    const flips = plan.flips.slice(0, MAX_CARDS_PER_BATCH)
    const step = flips.length > 1 ? Math.min(STEP_MS, MAX_SPREAD_MS / (flips.length - 1)) : 0
    flips.forEach((id, index) => {
      const slot = Math.round(index * step)
      const edgeId = incomingEdge.get(id)
      if (edgeId) {
        jobs.push({
          selector: edgeSelector(edgeId),
          run: (path, elapsed) => inkEdge(path as SVGPathElement, Math.max(0, slot - elapsed)),
        })
      }
      const lead = edgeId ? INK_LEAD_MS : 0
      jobs.push({
        selector: cardSelector(id),
        run: (card, elapsed) => flipCard(card as HTMLElement, Math.max(0, slot + lead - elapsed), index < MAX_BURSTS_PER_BATCH),
      })
    })
    plan.deals.slice(0, MAX_CARDS_PER_BATCH).forEach((id, index) => {
      const slot = Math.min(index * 32, 320)
      const edgeId = incomingEdge.get(id)
      if (edgeId) {
        jobs.push({
          selector: edgeSelector(edgeId),
          run: (path, elapsed) => inkEdge(path as SVGPathElement, Math.max(0, slot - elapsed)),
        })
      }
      jobs.push({
        selector: cardSelector(id),
        run: (card, elapsed) => dealCard(card as HTMLElement, Math.max(0, slot - elapsed)),
      })
    })
    runWhenMounted(root, jobs, activeWaits.current)
    if (flips.length >= GOLD_RAIN_MIN_FLIPS) {
      const landMs = Math.round((flips.length - 1) * step) + INK_LEAD_MS + FLIP_MS * 0.74
      const branchRoot = parents.current.get(flips[0])
      window.setTimeout(() => {
        if (!root.isConnected) return
        const rootCard = branchRoot ? root.querySelector(cardSelector(branchRoot)) : null
        emitGoldRain(root.getBoundingClientRect(), 0, rootCard ? rectCenter(rootCard.getBoundingClientRect()) : undefined)
      }, landMs)
    }
  }, [container, edges, nodes])
}
