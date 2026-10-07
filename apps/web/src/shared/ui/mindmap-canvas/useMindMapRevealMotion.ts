import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { cue, openPlayback, rectCenter, type FxPlayback } from '@/shared/fx'
import { prefersReducedMotion } from '@/shared/lib/prefersReducedMotion'
import { themeMotion } from '@/shared/theme/themePacks'

const FLIP_ID = 'mindmap-reveal-flip'
/** The live theme pack sets the flip's length and landing overshoot. */
const flipMs = () => themeMotion().flipMs
/** Edge-on moment: the paper back is swapped for the answer face here. */
const FLIP_TURN = 0.42
const STEP_MS = 45
const MAX_SPREAD_MS = 540
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

/**
 * iOS webviews are killed — and reload into the same death — when one commit
 * turns over a restored palace. A tap or a small branch stays under the cap.
 */
export const MAX_ANIMATED_FLIPS = 8
export const MAX_ANIMATED_DEALS = 12
const GESTURE_WINDOW_MS = 800

export function shouldPlayRevealMotion(
  plan: RevealMotionPlan,
  options?: { userGesture?: boolean },
): boolean {
  if (plan.flips.length > MAX_ANIMATED_FLIPS || plan.deals.length > MAX_ANIMATED_DEALS) return false
  if (options?.userGesture === true) return true
  // A reload or a live echo has no fresh tap. One card is safe; a palace is not.
  return plan.flips.length <= 1 && plan.deals.length <= 1
}

let lastGestureAt = 0

function noteRevealGesture() {
  lastGestureAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function recentRevealGesture() {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return now - lastGestureAt < GESTURE_WINDOW_MS
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

function flipCard(card: HTMLElement, delay: number, burst: boolean, playback: FxPlayback) {
  const FLIP_MS = flipMs()
  const overshoot = themeMotion().flipOvershootDeg
  clearFx(card)
  // The paper face turns. The glyphs stay on the card and only fade, so a
  // rotate/scale never rasterizes them.
  const cover = fxElement('mindmap-flip-cover', card)
  const sheen = fxElement('mindmap-flip-sheen', cover)

  removeWhenDone(cover.animate(
    [
      { transform: `${PERSPECTIVE} rotateX(0deg) scale(1)`, opacity: 1, easing: 'cubic-bezier(0.55, 0, 0.85, 0.35)' },
      { transform: `${PERSPECTIVE} rotateX(-90deg) scale(1.06)`, opacity: 1, offset: FLIP_TURN },
      { transform: `${PERSPECTIVE} rotateX(90deg) scale(1.06)`, opacity: 1, offset: FLIP_TURN + 0.0001, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)' },
      { transform: `${PERSPECTIVE} rotateX(${-overshoot}deg) scale(1.03)`, opacity: 0.45, offset: 0.74 },
      { transform: 'none', opacity: 0 },
    ],
    { duration: FLIP_MS, delay, fill: 'both' },
  ), cover)
  card.querySelectorAll<HTMLElement>('.mindmap-node-text, .mindmap-node-concealed').forEach((text) => {
    text.animate(
      [
        { opacity: 1 },
        { opacity: 0, offset: FLIP_TURN },
        { opacity: 0, offset: FLIP_TURN + 0.0001 },
        { opacity: 1 },
      ],
      { duration: FLIP_MS, delay, fill: 'backwards' },
    )
  })
  removeWhenDone(sheen.animate(
    [
      { opacity: 0, backgroundPosition: '140% 0' },
      { opacity: 0, backgroundPosition: '140% 0', offset: 0.5 },
      { opacity: 1, backgroundPosition: '60% 0', offset: 0.66 },
      { opacity: 0, backgroundPosition: '-40% 0' },
    ],
    { duration: FLIP_MS + 180, delay, fill: 'both', easing: 'ease-out' },
  ), sheen)
  landCard(card, delay + FLIP_MS * 0.7, burst, playback)
}

function dealCard(card: HTMLElement, delay: number) {
  card.animate(
    [
      { opacity: 0, marginLeft: '-14px' },
      { opacity: 1, marginLeft: '4px', offset: 0.7 },
      { opacity: 1, marginLeft: '0px' },
    ],
    { duration: 420, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards', id: FLIP_ID },
  )
}

/** Gold dust settles as the card lands; its rect is read then, since the camera may be following. */
function landCard(card: HTMLElement, delay: number, burst: boolean, playback: FxPlayback) {
  playback.at(delay, () => {
    if (!card.isConnected || !playback.alive()) return
    if (burst) cue('map.land', { rect: card.getBoundingClientRect() })
    card.dispatchEvent(new CustomEvent(MINDMAP_CARD_LANDED_EVENT, { bubbles: true }))
  })
}

function retireRevealLayers(root: HTMLElement) {
  root.querySelectorAll('[data-mm-flip-fx]').forEach((element) => element.remove())
  root.querySelectorAll<HTMLElement>(
    '.mindmap-node-card, .mindmap-node-text, .mindmap-node-concealed, .react-flow__edge-path',
  ).forEach((element) => {
    element.getAnimations?.().forEach((animation) => animation.cancel())
  })
}

function bumpCard(card: Element | null) {
  if (!card || typeof (card as HTMLElement).animate !== 'function') return
  const ring = fxElement('mindmap-land-ring', card as HTMLElement)
  removeWhenDone(ring.animate(
    [
      { opacity: 0.85, transform: 'scale(0.98)' },
      { opacity: 0, transform: 'scale(1.06)' },
    ],
    { duration: 380, easing: 'ease-out', fill: 'both' },
  ), ring)
}

/**
 * Hidden children fold back into the card that hid them: a ghost of each leaving
 * node fades out while ink and gold are drawn in after it. The ghost is not
 * scaled — that transform is what softens the copied glyphs.
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
    const walked = new Set<string>()
    while (parent && !present.has(parent)) {
      if (walked.has(parent)) {
        parent = undefined
        break
      }
      walked.add(parent)
      parent = previousParents.get(parent)
    }
    if (parent) folds.push({ id, into: parent })
  }
  return folds
}

const nodeSelector = (id: string) => `.react-flow__node[data-id="${escapeId(id)}"]`

function foldNode(root: HTMLElement, id: string, into: string) {
  const node = root.querySelector<HTMLElement>(nodeSelector(id))
  const parentCard = root.querySelector<HTMLElement>(cardSelector(into))
  // `offsetWidth` and `getBoundingClientRect()` both read layout, and nothing
  // mutates the DOM between them, so the second read does not force a second
  // reflow. Collapsing them would not save a reflow — only a property access —
  // while changing the guard's meaning (`offsetWidth` ignores transforms and
  // rounds to whole pixels). Kept as-is deliberately.
  if (!node || !parentCard || !node.parentElement || node.offsetWidth === 0) return
  const rect = node.getBoundingClientRect()
  const ghost = node.cloneNode(true) as HTMLElement
  ghost.removeAttribute('data-id')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.pointerEvents = 'none'
  node.parentElement.appendChild(ghost)
  ghost.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: FOLD_MS, easing: 'cubic-bezier(0.6, 0, 0.8, 0.4)', fill: 'forwards' },
  ).finished.catch(() => undefined).then(() => ghost.remove())
  cue('map.fold', { rect, target: () => (parentCard.isConnected ? rectCenter(parentCard.getBoundingClientRect()) : null), onFirstArrive: () => bumpCard(parentCard) })
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
function runWhenMounted(
  root: HTMLElement,
  jobs: MountJob[],
  active: Set<() => void>,
  playback: FxPlayback,
) {
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
  playback.onCancel(stop)
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
  const batchRef = useRef<FxPlayback | null>(null)

  useEffect(() => {
    const mark = () => noteRevealGesture()
    window.addEventListener('pointerdown', mark, true)
    window.addEventListener('keydown', mark, true)
    const waits = activeWaits.current
    return () => {
      window.removeEventListener('pointerdown', mark, true)
      window.removeEventListener('keydown', mark, true)
      waits.forEach((stop) => stop())
      waits.clear()
      batchRef.current?.cancel()
      batchRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const previous = phases.current
    const previousParents = parents.current
    phases.current = new Map(nodes.map((node) => [node.id, readRevealPhase(node)]))
    parents.current = new Map(edges.map((edge) => [edge.target, edge.source]))
    const root = container.current
    if (!root) return
    // Sound is planned before the motion bail-out: with reduced motion (or no
    // Web Animations) the cascade still has to be audible, otherwise flipping is
    // silent for exactly the users who cannot see the stagger.
    const folds = planFoldBack(previous, previousParents, nodes)
    const willFold = folds.length > 0 && folds.length <= MAX_FOLDS_PER_BATCH
    const plan = planRevealMotion(previous, nodes)
    const play = shouldPlayRevealMotion(plan, { userGesture: recentRevealGesture() })
    if (willFold) cue('audio.pops', { role: 'fold', count: folds.length })
    if (play && plan.flips.length > 0) {
      cue('audio.pops', { role: 'reveal', count: Math.min(plan.flips.length, MAX_ANIMATED_FLIPS) })
    }
    if (play && plan.deals.length > 0) {
      cue('audio.pops', { role: 'deal', count: Math.min(plan.deals.length, MAX_ANIMATED_DEALS) })
    }
    if (prefersReducedMotion() || typeof root.animate !== 'function') return
    if (willFold) {
      folds.forEach(({ id, into }) => foldNode(root, id, into))
    }
    if (!play || (plan.flips.length === 0 && plan.deals.length === 0)) return

    // A new tap retires the previous batch. An unrelated React Flow render
    // (empty plan) must not, or the flip the learner just started never lands.
    batchRef.current?.cancel()
    activeWaits.current.forEach((stop) => stop())
    activeWaits.current.clear()
    retireRevealLayers(root)
    const playback = openPlayback('mindmap-reveal')
    batchRef.current = playback

    const incomingEdge = new Map(edges.map((edge) => [edge.target, edge.id]))
    const jobs: MountJob[] = []
    const flips = plan.flips.slice(0, MAX_ANIMATED_FLIPS)
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
        run: (card, elapsed) => flipCard(
          card as HTMLElement,
          Math.max(0, slot + lead - elapsed),
          index < MAX_BURSTS_PER_BATCH,
          playback,
        ),
      })
    })
    plan.deals.slice(0, MAX_ANIMATED_DEALS).forEach((id, index) => {
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
    runWhenMounted(root, jobs, activeWaits.current, playback)
    if (flips.length >= GOLD_RAIN_MIN_FLIPS) {
      const landMs = Math.round((flips.length - 1) * step) + INK_LEAD_MS + flipMs() * 0.74
      playback.at(landMs, () => {
        if (!root.isConnected || !playback.alive()) return
        cue('map.branch', { rect: root.getBoundingClientRect() })
      })
    }
  }, [container, edges, nodes])
}
