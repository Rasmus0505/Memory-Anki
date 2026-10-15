import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { cue, openPlayback, type FxPlayback } from '@/shared/fx'
import { prefersReducedMotion } from '@/shared/lib/prefersReducedMotion'
import { themeMotion } from '@/shared/theme/themePacks'

const FLIP_ID = 'mindmap-reveal-flip'
/** The live theme pack sets the flip's length and landing overshoot. */
const flipMs = () => themeMotion().flipMs
/** Edge-on moment: the paper back is swapped for the answer face here. */
const FLIP_TURN = 0.3
const STEP_MS = 35
const MAX_SPREAD_MS = 140
/** Bubbled from a card when its flip lands, for hosts that react to a landed card. */
export const MINDMAP_CARD_LANDED_EVENT = 'memory-anki:mindmap-card-landed'
/** A fold is the card itself travelling back into its parent, not a faded copy. */
const FOLD_MS = 320
const FOLD_STAGGER_MS = 22
const FOLD_MAX_SPREAD_MS = 90
/** The parent's jelly pop lands as the first child reaches it. */
const FOLD_PARENT_POP_MS = 240
const MAX_FOLDS_PER_BATCH = 24
/** Ink leads the paper turn by a short beat, so the click reads as an immediate answer. */
const INK_LEAD_MS = 40
/** Landing rebound as a share of the theme's overshoot: a jelly wobble, not a swing. */
const REBOUND_SHARE = 0.4
/** React Flow mounts new nodes (and their edges, after measuring) a few frames later. */
const MOUNT_WAIT_MS = 1200
const PERSPECTIVE = 'perspective(680px)'
/** Sparks thrown off a flipped card: few and small, so the warm light wave stays the lead. */
const FLIP_SPARK_COUNT = 8

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
/**
 * Layout springs on node left/top and edge `d` run for 360ms. While they run,
 * the card slides out from under a rapid click (pointerup misses) and the path
 * tween stalls the main thread. Hold them off a little longer than that spring
 * so a burst of reveal clicks lands on a still card.
 */
export const REVEAL_LAYOUT_HOLD_MS = 480

export interface RevealLayoutHold {
  poke(root: HTMLElement): void
  cancel(): void
}

export function createRevealLayoutHold(): RevealLayoutHold {
  let timer = 0
  let root: HTMLElement | null = null
  return {
    poke(next) {
      root = next
      next.dataset.revealMotion = 'true'
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = 0
        if (root === next) delete next.dataset.revealMotion
      }, REVEAL_LAYOUT_HOLD_MS)
    },
    cancel() {
      window.clearTimeout(timer)
      timer = 0
      if (root) delete root.dataset.revealMotion
      root = null
    },
  }
}

export function shouldPlayRevealMotion(
  plan: RevealMotionPlan,
  options?: { userGesture?: boolean },
): boolean {
  if (plan.flips.length > MAX_ANIMATED_FLIPS || plan.deals.length > MAX_ANIMATED_DEALS) return false
  if (options?.userGesture === true) return true
  // A reload or a live echo has no fresh tap. One card is safe; a palace is not.
  return plan.flips.length <= 1 && plan.deals.length <= 1
}

/** A second reveal this soon skips the paper turn so the next press is instant. */
export const RAPID_REVEAL_MS = 280

let lastGestureAt = 0
let lastGestureGap = Number.POSITIVE_INFINITY

export function resetRevealGestureTiming() {
  lastGestureAt = 0
  lastGestureGap = Number.POSITIVE_INFINITY
}

function noteRevealGesture() {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  lastGestureGap = lastGestureAt === 0 ? Number.POSITIVE_INFINITY : now - lastGestureAt
  lastGestureAt = now
}

/** True when this reveal is a burst press, not the first card of a quiet pause. */
export function shouldSnapRapidReveal(gapMs = lastGestureGap) {
  return gapMs >= 0 && gapMs < RAPID_REVEAL_MS
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

function flipCard(card: HTMLElement, delay: number, playback: FxPlayback) {
  const FLIP_MS = flipMs()
  const rebound = themeMotion().flipOvershootDeg * REBOUND_SHARE
  clearFx(card)
  // The paper face turns. The glyphs stay on the card and only fade, so a
  // rotate/scale never rasterizes them. Every keyframe carries the same
  // transform functions so the cover interpolates per function, not as a matrix.
  const cover = fxElement('mindmap-flip-cover', card)
  const sheen = fxElement('mindmap-flip-sheen', cover)

  // Press squish → fast start (no ease-in dead time) → spring through edge-on →
  // landing wobble. The press pose matches the CSS :active squish, so the cover
  // takes over from the pressed card without a jump.
  removeWhenDone(cover.animate(
    [
      { transform: `${PERSPECTIVE} rotateX(0deg) translateY(0px) scale(1.02, 0.95)`, opacity: 1, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
      { transform: `${PERSPECTIVE} rotateX(-90deg) translateY(-10px) scale(1.04)`, opacity: 1, offset: FLIP_TURN },
      { transform: `${PERSPECTIVE} rotateX(90deg) translateY(-10px) scale(1.04)`, opacity: 1, offset: FLIP_TURN + 0.0001, easing: 'cubic-bezier(0.34, 1.3, 0.64, 1)' },
      { transform: `${PERSPECTIVE} rotateX(${-rebound}deg) translateY(0px) scale(0.97, 1.06)`, opacity: 1, offset: 0.62, easing: 'ease-out' },
      { transform: `${PERSPECTIVE} rotateX(${rebound * 0.2}deg) translateY(0px) scale(1.03, 0.96)`, opacity: 1, offset: 0.84, easing: 'ease-in-out' },
      { transform: `${PERSPECTIVE} rotateX(0deg) translateY(0px) scale(1)`, opacity: 0 },
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
  // Light wave: a warm bloom swells behind the turn, then sparks leave the card's centre.
  const glow = fxElement('mindmap-flip-glow', card)
  removeWhenDone(glow.animate(
    [
      { opacity: 0, transform: 'scale(0.6)' },
      { opacity: 0.9, transform: 'scale(1.1)', offset: FLIP_TURN },
      { opacity: 0, transform: 'scale(1.6)' },
    ],
    { duration: FLIP_MS + 160, delay, fill: 'both', easing: 'ease-out' },
  ), glow)
  for (let index = 0; index < FLIP_SPARK_COUNT; index += 1) {
    const spark = fxElement('mindmap-flip-spark', card)
    const angle = (Math.PI * 2 * index) / FLIP_SPARK_COUNT + (Math.random() - 0.5) * 0.5
    const distance = 24 + Math.random() * 22
    removeWhenDone(spark.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.4)' },
        { opacity: 1, offset: 0.2 },
        { opacity: 0, transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(1)` },
      ],
      { duration: 520, delay: delay + FLIP_MS * FLIP_TURN, fill: 'both', easing: 'cubic-bezier(.2,.7,.3,1)' },
    ), spark)
  }
  landCard(card, delay + FLIP_MS * 0.7, playback)
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

function landCard(card: HTMLElement, delay: number, playback: FxPlayback) {
  playback.at(delay, () => {
    if (!card.isConnected || !playback.alive()) return
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

/**
 * Hidden children fold back into the card that hid them: each leaving card is
 * pulled into its parent and shrinks away. See `foldNode`.
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

function centerOf(element: Element) {
  const rect = element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/** The i-th card of a fold batch: spaced out, but the whole batch lands within FOLD_MAX_SPREAD_MS. */
export function foldStaggerMs(index: number, count: number) {
  return index * Math.min(FOLD_STAGGER_MS, FOLD_MAX_SPREAD_MS / Math.max(1, count - 1))
}

/** The parent gives one jelly pop per batch, as its first child arrives. */
function popParent(parentCard: HTMLElement, delay: number) {
  if (typeof parentCard.animate !== 'function') return
  parentCard.animate(
    [
      { transform: 'scale(1, 1)' },
      { transform: 'scale(1.06, 0.92)', offset: 0.3 },
      { transform: 'scale(0.97, 1.04)', offset: 0.62 },
      { transform: 'scale(1, 1)' },
    ],
    { duration: 440, delay, easing: 'ease-out' },
  )
}

/**
 * The folding card travels back into the card that hid it and shrinks away.
 * React Flow has already dropped the node, so the clone stands in for it. Only
 * the clone's card moves: the React Flow wrapper keeps the node's own translate.
 * Glyphs are scaled only on the way out, while they fade, so the softening is brief.
 */
function foldNode(root: HTMLElement, id: string, into: string, delay: number): HTMLElement | null {
  const node = root.querySelector<HTMLElement>(nodeSelector(id))
  const parentCard = root.querySelector<HTMLElement>(cardSelector(into))
  const nodeCard = node?.querySelector<HTMLElement>('.mindmap-node-card') ?? null
  // `offsetWidth` and `getBoundingClientRect()` both read layout, and nothing
  // mutates the DOM between them, so the second read does not force a second
  // reflow. Collapsing them would not save a reflow — only a property access —
  // while changing the guard's meaning (`offsetWidth` ignores transforms and
  // rounds to whole pixels). Kept as-is deliberately.
  if (!node || !nodeCard || !parentCard || !node.parentElement || node.offsetWidth === 0) return null
  // Translate is in the card's local px, which React Flow's zoom scales on screen.
  const zoom = nodeCard.getBoundingClientRect().width / Math.max(1, nodeCard.offsetWidth)
  if (!(zoom > 0)) return null
  const from = centerOf(nodeCard)
  const to = centerOf(parentCard)
  const dx = (to.x - from.x) / zoom
  const dy = (to.y - from.y) / zoom

  const ghost = node.cloneNode(true) as HTMLElement
  ghost.removeAttribute('data-id')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.pointerEvents = 'none'
  node.parentElement.appendChild(ghost)
  const ghostCard = ghost.querySelector<HTMLElement>('.mindmap-node-card')
  if (!ghostCard || typeof ghostCard.animate !== 'function') {
    ghost.remove()
    return null
  }
  ghostCard.animate(
    [
      { transform: 'translate(0px, 0px) scale(1, 1)', opacity: 1, easing: 'cubic-bezier(0.3, 0, 0.7, 1)' },
      // Anticipation: a small squash away from the parent before it is pulled in.
      { transform: 'translate(0px, -6px) scale(1.05, 0.93)', opacity: 1, offset: 0.22, easing: 'cubic-bezier(0.55, 0, 0.9, 0.5)' },
      { transform: `translate(${dx * 0.92}px, ${dy * 0.92}px) scale(0.28)`, opacity: 0, offset: 1 },
    ],
    { duration: FOLD_MS, delay, fill: 'both' },
  ).finished.catch(() => undefined).then(() => ghost.remove())
  return parentCard
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
  const layoutHold = useRef<RevealLayoutHold | null>(null)
  if (layoutHold.current == null) layoutHold.current = createRevealLayoutHold()

  useEffect(() => {
    const mark = (event: Event) => {
      const root = container.current
      const target = event.target
      const inside = Boolean(root && target instanceof globalThis.Node && root.contains(target))
      // Only presses on the map (or a keyboard reveal) count. A click in the
      // toolbar must not make the next card skip its flip.
      if (event.type === 'keydown' || inside) noteRevealGesture()
      if (inside && root) layoutHold.current?.poke(root)
    }
    window.addEventListener('pointerdown', mark, true)
    window.addEventListener('keydown', mark, true)
    const waits = activeWaits.current
    const hold = layoutHold.current
    return () => {
      window.removeEventListener('pointerdown', mark, true)
      window.removeEventListener('keydown', mark, true)
      waits.forEach((stop) => stop())
      waits.clear()
      batchRef.current?.cancel()
      batchRef.current = null
      hold?.cancel()
    }
  }, [container])

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
    // A burst press cancels the paper still turning and does not start another
    // 500ms+ turn. The reveal state has already committed; the animation was
    // what made the next click feel like it had to wait.
    const snapRapid = recentRevealGesture() && shouldSnapRapidReveal()
      && (plan.flips.length > 0 || plan.deals.length > 0 || willFold)
    const play = !snapRapid && shouldPlayRevealMotion(plan, { userGesture: recentRevealGesture() })
    if (snapRapid) {
      batchRef.current?.cancel()
      activeWaits.current.forEach((stop) => stop())
      activeWaits.current.clear()
      retireRevealLayers(root)
      if (plan.flips.length > 0 || plan.deals.length > 0) {
        cue('audio.pops', { role: plan.flips.length > 0 ? 'reveal' : 'deal', count: 1 })
      }
    }
    if (recentRevealGesture() && (snapRapid || willFold || (play && (plan.flips.length > 0 || plan.deals.length > 0)))) {
      layoutHold.current?.poke(root)
    }
    if (willFold) cue('audio.pops', { role: 'fold', count: folds.length })
    if (play && plan.flips.length > 0) {
      cue('audio.pops', { role: 'reveal', count: Math.min(plan.flips.length, MAX_ANIMATED_FLIPS) })
    }
    if (play && plan.deals.length > 0) {
      cue('audio.pops', { role: 'deal', count: Math.min(plan.deals.length, MAX_ANIMATED_DEALS) })
    }
    if (snapRapid || prefersReducedMotion() || typeof root.animate !== 'function') return
    if (willFold) {
      const parents = new Set<string>()
      folds.forEach(({ id, into }, index) => {
        const parentCard = foldNode(root, id, into, foldStaggerMs(index, folds.length))
        if (parentCard && !parents.has(into)) {
          parents.add(into)
          popParent(parentCard, FOLD_PARENT_POP_MS)
        }
      })
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
  }, [container, edges, nodes])
}
