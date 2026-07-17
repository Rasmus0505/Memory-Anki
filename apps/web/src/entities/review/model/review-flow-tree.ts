import type {
  MindMapDoc,
  MindMapDocNode,
  MindMapEditorState,
} from '@/shared/api/contracts'
import type { MindMapSelection } from '@/entities/mindmap-document'
import type { RevealState } from '@/entities/session/model'

export interface ReviewMindMapNode {
  id: string
  text: string
  note: string
  parentId: string | null
  /** Parent reveal auto-shows this node's body (skip placeholder). */
  isQuestionCard: boolean
  children: ReviewMindMapNode[]
}

export interface ReviewFlowSnapshot {
  revealMap: Record<string, RevealState>
  redNodeIds: string[]
  completed: boolean
}

export type RevealFlowMode = 'standard' | 'segment-checkpoint'

export interface RevealFlowOptions {
  mode?: RevealFlowMode
  checkpointIds?: Iterable<string>
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

const DEFAULT_THEME = { template: 'default' as const, config: {} as const }

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

function normalizeNode(
  node: MindMapDocNode | undefined,
  fallbackId: string,
  parentId: string | null,
): ReviewMindMapNode {
  const data = node?.data ?? {}
  const children = Array.isArray(node?.children) ? node.children : []
  const id = getNodeId(node, fallbackId)

  return {
    id,
    text: plainText(data.text),
    note: plainText(data.note),
    parentId,
    isQuestionCard: data.memoryAnkiQuestionCard === true,
    children: children.map((child, index) =>
      normalizeNode(child, `${fallbackId}-${index}`, id),
    ),
  }
}

export function buildReviewTree(
  doc: MindMapDoc | null,
  fallbackTitle: string,
): ReviewMindMapNode {
  if (!doc?.root) {
    return {
      id: 'root',
      text: fallbackTitle || '未命名导图',
      note: '',
      parentId: null,
      isQuestionCard: false,
      children: [],
    }
  }
  return normalizeNode(doc.root, 'root', null)
}

export function flattenNodes(
  root: ReviewMindMapNode,
): Map<string, ReviewMindMapNode> {
  const map = new Map<string, ReviewMindMapNode>()
  const walk = (node: ReviewMindMapNode) => {
    map.set(node.id, node)
    node.children.forEach(walk)
  }
  walk(root)
  return map
}

export function sanitizeCheckpointNodeIds(
  root: ReviewMindMapNode,
  checkpointIds: Iterable<string>,
) {
  const validIds = new Set(collectNodeIds(root))
  validIds.delete(root.id)
  const result: string[] = []
  for (const value of checkpointIds) {
    const id = String(value || '').trim()
    if (id && validIds.has(id) && !result.includes(id)) {
      result.push(id)
    }
  }
  return result
}

function buildCheckpointRevealState(
  root: ReviewMindMapNode,
  checkpointIds: Iterable<string>,
  previous: Record<string, RevealState> | null = null,
) {
  const checkpoints = new Set(sanitizeCheckpointNodeIds(root, checkpointIds))
  const next: Record<string, RevealState> = {}

  function walk(node: ReviewMindMapNode, blocked: boolean): void {
    if (node.id === root.id) {
      next[node.id] = 'revealed'
    } else if (blocked) {
      next[node.id] = 'hidden'
    } else if (!checkpoints.has(node.id)) {
      next[node.id] = 'revealed'
    } else {
      const previousState = previous?.[node.id]
      next[node.id] = previousState === 'revealed' ? 'revealed' : 'placeholder'
      if (next[node.id] !== 'revealed') {
        blocked = true
      }
    }
    for (const child of node.children) {
      walk(child, blocked)
    }
  }

  walk(root, false)
  return next
}

/**
 * When a parent is revealed, any direct child marked as a question card
 * becomes revealed immediately (skipping "待回忆"). Cascades while stable.
 */
export function applyQuestionCardAutoReveal(
  nodeMap: Map<string, ReviewMindMapNode>,
  revealMap: Record<string, RevealState>,
): Record<string, RevealState> {
  let next = revealMap
  let changed = true
  while (changed) {
    changed = false
    let working = next
    for (const node of nodeMap.values()) {
      if ((working[node.id] ?? 'hidden') !== 'revealed') continue
      for (const child of node.children) {
        if (!child.isQuestionCard) continue
        if ((working[child.id] ?? 'hidden') === 'revealed') continue
        if (working === next) working = { ...next }
        working[child.id] = 'revealed'
        changed = true
      }
    }
    next = working
  }
  return next
}

export function buildInitialRevealState(
  root: ReviewMindMapNode,
  previous: Record<string, RevealState> | null = null,
  options: RevealFlowOptions = {},
) {
  if (options.mode === 'segment-checkpoint') {
    const checkpointState = buildCheckpointRevealState(
      root,
      options.checkpointIds ?? [],
      previous,
    )
    return applyQuestionCardAutoReveal(flattenNodes(root), checkpointState)
  }
  const next: Record<string, RevealState> = {}
  const walk = (node: ReviewMindMapNode) => {
    const previousState = previous?.[node.id]
    next[node.id] = previousState ?? 'hidden'
    node.children.forEach(walk)
  }
  walk(root)
  next[root.id] = 'revealed'
  return applyQuestionCardAutoReveal(flattenNodes(root), next)
}

export function buildAllRevealedState(root: ReviewMindMapNode) {
  const next: Record<string, RevealState> = {}
  const walk = (node: ReviewMindMapNode) => {
    next[node.id] = 'revealed'
    node.children.forEach(walk)
  }
  walk(root)
  return next
}

export function collectNodeIds(root: ReviewMindMapNode) {
  const ids: string[] = []
  const walk = (node: ReviewMindMapNode) => {
    ids.push(node.id)
    node.children.forEach(walk)
  }
  walk(root)
  return ids
}

export function hideNodeAndDescendants(
  nodeId: string,
  nodeMap: Map<string, ReviewMindMapNode>,
  revealMap: Record<string, RevealState>,
): Record<string, RevealState> {
  const next = { ...revealMap }
  const root = nodeMap.get(nodeId)
  if (!root) return next
  const walk = (node: ReviewMindMapNode) => {
    next[node.id] = 'hidden'
    node.children.forEach(walk)
  }
  root.children.forEach(walk)
  return next
}

export function sanitizeRedNodeIds(
  root: ReviewMindMapNode,
  previous: Iterable<string>,
) {
  const validIds = new Set(collectNodeIds(root))
  validIds.delete(root.id)
  return new Set([...previous].filter((id) => validIds.has(id)))
}

export function countNodes(node: ReviewMindMapNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0)
}

export function findNextHiddenChild(
  node: ReviewMindMapNode,
  revealMap: Record<string, RevealState>,
) {
  return (
    node.children.find((child) => (revealMap[child.id] ?? 'hidden') === 'hidden') ??
    null
  )
}

export function advanceRevealStateForNodeClick(
  nodeId: string,
  nodeMap: Map<string, ReviewMindMapNode>,
  revealMap: Record<string, RevealState>,
): Record<string, RevealState> {
  const node = nodeMap.get(nodeId)
  if (!node) return revealMap
  const state = revealMap[nodeId] ?? 'hidden'
  if (state === 'placeholder') {
    return applyQuestionCardAutoReveal(nodeMap, { ...revealMap, [nodeId]: 'revealed' })
  }
  if (state !== 'revealed') return revealMap
  const nextChild = findNextHiddenChild(node, revealMap)
  if (!nextChild) return revealMap
  // Question cards never land on placeholder; auto-reveal cascade handles them.
  const childState: RevealState = nextChild.isQuestionCard ? 'revealed' : 'placeholder'
  return applyQuestionCardAutoReveal(nodeMap, { ...revealMap, [nextChild.id]: childState })
}

export function hideRevealStateBranch(
  nodeId: string,
  nodeMap: Map<string, ReviewMindMapNode>,
  revealMap: Record<string, RevealState>,
): Record<string, RevealState> {
  return hideNodeAndDescendants(nodeId, nodeMap, revealMap)
}

export function pourCheckpointRevealState(
  startNodeId: string,
  root: ReviewMindMapNode,
  nodeMap: Map<string, ReviewMindMapNode>,
  checkpointIds: Iterable<string>,
  revealMap: Record<string, RevealState>,
): Record<string, RevealState> {
  const startNode = nodeMap.get(startNodeId)
  if (!startNode) return revealMap

  const checkpoints = new Set(sanitizeCheckpointNodeIds(root, checkpointIds))
  const next = { ...revealMap }
  let frontier = [...startNode.children]

  while (frontier.length > 0) {
    const nextFrontier: ReviewMindMapNode[] = []

    for (const node of frontier) {
      const state = next[node.id] ?? 'hidden'

      if (state === 'revealed') {
        nextFrontier.push(...node.children)
        continue
      }

      if (checkpoints.has(node.id)) {
        next[node.id] = 'placeholder'
        continue
      }

      next[node.id] = 'revealed'
      nextFrontier.push(...node.children)
    }

    frontier = nextFrontier
  }

  return applyQuestionCardAutoReveal(nodeMap, next)
}

export function buildSelectionNodeId(node: MindMapSelection | null): string | null {
  if (!node) return null
  if (node.uid) return String(node.uid)
  if (node.memoryAnkiId != null) return String(node.memoryAnkiId)
  return null
}

const REVIEW_NODE_PADDING_Y = 9

const PLACEHOLDER_NODE_STYLE = {
  fillColor: '#fffbeb',
  borderColor: '#f59e0b',
  borderWidth: 2,
  color: '#92400e',
  paddingY: REVIEW_NODE_PADDING_Y,
}

const REVEALED_NODE_STYLE = {
  fillColor: '#ecfdf5',
  borderColor: '#10b981',
  borderWidth: 2,
  color: '#065f46',
  paddingY: REVIEW_NODE_PADDING_Y,
}

const RED_NODE_STYLE = {
  fillColor: '#fff1f2',
  borderColor: '#e11d48',
  borderWidth: 2,
  color: '#881337',
  paddingY: REVIEW_NODE_PADDING_Y,
}

const ROOT_NODE_STYLE = {
  fillColor: '#18181b',
  borderColor: '#09090b',
  borderWidth: 2,
  color: '#fafafa',
  fontWeight: 'bold',
}

const EXPANDING_LINE_STYLE = {
  lineColor: '#d97706',
  lineWidth: 2,
}

const DIRECT_LEVEL_VISIBLE_LINE_STYLE = {
  lineColor: '#2563eb',
  lineWidth: 4,
}

const SUBTREE_REVEALED_LINE_STYLE = {
  lineColor: '#059669',
  lineWidth: 6,
}

function cardSlotHasAppeared(state: RevealState | undefined) {
  return state === 'placeholder' || state === 'revealed'
}

function buildLineStylesByParentId(
  root: ReviewMindMapNode,
  revealMap: Record<string, RevealState>,
) {
  const styles = new Map<string, Record<string, string | number>>()

  const walk = (node: ReviewMindMapNode): boolean => {
    const childrenAndDescendantsRevealed = node.children.map(walk)
    if (node.children.length > 0) {
      const directLevelVisible = node.children.every(
        (child) => cardSlotHasAppeared(revealMap[child.id]),
      )
      const subtreeRevealed = childrenAndDescendantsRevealed.every(Boolean)
      styles.set(
        node.id,
        subtreeRevealed
          ? SUBTREE_REVEALED_LINE_STYLE
          : directLevelVisible
            ? DIRECT_LEVEL_VISIBLE_LINE_STYLE
            : EXPANDING_LINE_STYLE,
      )
    }
    return (
      (revealMap[node.id] ?? 'hidden') === 'revealed' &&
      childrenAndDescendantsRevealed.every(Boolean)
    )
  }

  walk(root)
  return styles
}

function getNodeVisualStyle(
  state: RevealState,
  isRoot: boolean,
  lineStyle: Record<string, string | number>,
  redMarked: boolean,
): Record<string, string | number> {
  const nodeStyle = isRoot
    ? ROOT_NODE_STYLE
    : redMarked
      ? RED_NODE_STYLE
      : state === 'placeholder'
        ? PLACEHOLDER_NODE_STYLE
        : REVEALED_NODE_STYLE
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

/** Layout / hide flags to drop when a card is revealed — keep text + richText (yellow emphasis). */
const REVEALED_STRIP_KEYS = [
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

function stripRevealedLayoutFields(data: Record<string, unknown>) {
  const nextData = { ...data }
  REVEALED_STRIP_KEYS.forEach((key) => {
    delete nextData[key]
  })
  return nextData
}

function hasYellowEmphasisMarkup(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return (
    value.includes('data-emphasis="highlight"')
    || value.includes("data-emphasis='highlight'")
  )
}

export function buildVisibleEditorDoc(
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
      layout: 'mindMap',
      theme: DEFAULT_THEME,
    }
  }

  const reviewRoot = nodeMap.get(getNodeId(source.root, 'root'))
  const lineStylesByParentId = reviewRoot
    ? buildLineStylesByParentId(reviewRoot, revealMap)
    : new Map<string, Record<string, string | number>>()

  const walk = (
    node: MindMapDocNode | undefined,
    fallbackId: string,
    forceVisible = false,
  ): MindMapDocNode | null => {
    if (!node) return null
    const id = getNodeId(node, fallbackId)
    const revealState = revealMap[id] ?? 'hidden'
    if (!forceVisible && revealState === 'hidden') return null

    const nextNode = structuredClone(node)
    let nextData = { ...(nextNode.data ?? {}) }

    if (forceVisible || revealState === 'revealed') {
      // Keep stored text (including yellow emphasis HTML) so highlights show in
      // review / practice / any reveal-based mind-map mode — not only in the editor.
      nextData = stripRevealedLayoutFields(nextData)
      if (!plainText(nextData.text)) {
        nextData.text =
          fallbackId === 'root'
            ? fallbackTitle || '未命名导图'
            : nodeMap.get(id)?.text || ''
      }
      if (hasYellowEmphasisMarkup(nextData.text)) {
        nextData.richText = true
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
        lineStylesByParentId.get(nodeMap.get(id)?.parentId ?? '') ?? EXPANDING_LINE_STYLE,
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
    layout: 'mindMap',
    theme: DEFAULT_THEME,
    ...structuredClone(source),
    root: walk(source.root, 'root', true) ?? {
      data: { text: fallbackTitle || '未命名导图' },
      children: [],
    },
    view: null,
  }
}

export function revealRemainingNodes(
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

export function allNodesRevealed(
  root: ReviewMindMapNode,
  revealMap: Record<string, RevealState>,
) {
  const ids = collectNodeIds(root).filter((id) => id !== root.id)
  return (
    ids.length > 0 &&
    ids.every((id) => (revealMap[id] ?? 'hidden') === 'revealed')
  )
}

export function checkpointNodesRevealed(
  root: ReviewMindMapNode,
  checkpointIds: Iterable<string>,
  revealMap: Record<string, RevealState>,
) {
  const checkpoints = sanitizeCheckpointNodeIds(root, checkpointIds)
  return (
    checkpoints.length > 0 &&
    checkpoints.every((id) => (revealMap[id] ?? 'hidden') === 'revealed')
  )
}

export function buildVisibleEditorState(
  editorState: MindMapEditorState,
  parsedDoc: MindMapDoc | null,
  revealMap: Record<string, RevealState>,
  nodeMap: Map<string, ReviewMindMapNode>,
  title: string,
  redNodeIds: Set<string>,
): MindMapEditorState {
  return {
    editor_doc: buildVisibleEditorDoc(
      parsedDoc,
      revealMap,
      nodeMap,
      title,
      redNodeIds,
    ),
    editor_config: structuredClone(editorState.editor_config ?? {}),
    editor_local_config: structuredClone(editorState.editor_local_config ?? {}),
    lang: editorState.lang || 'zh',
  }
}

function collectAncestorIds(
  focusIds: Set<string>,
  nodeMap: Map<string, ReviewMindMapNode>,
): Set<string> {
  const visibleIds = new Set<string>()
  focusIds.forEach((id) => {
    let current = nodeMap.get(id) ?? null
    while (current) {
      visibleIds.add(current.id)
      current = current.parentId ? (nodeMap.get(current.parentId) ?? null) : null
    }
  })
  return visibleIds
}

export function buildFocusRevealState(
  root: ReviewMindMapNode,
  focusNodeIds: Iterable<string>,
  nodeMap: Map<string, ReviewMindMapNode>,
  previous: Record<string, RevealState> | null = null,
) {
  const focusIds = sanitizeRedNodeIds(root, focusNodeIds)
  const visibleIds = collectAncestorIds(focusIds, nodeMap)
  // Build base without double-applying auto-reveal mid-walk; cascade once at the end.
  const next: Record<string, RevealState> = {}
  const walk = (node: ReviewMindMapNode) => {
    next[node.id] = 'hidden'
    node.children.forEach(walk)
  }
  walk(root)
  next[root.id] = 'revealed'
  collectNodeIds(root).forEach((id) => {
    if (id === root.id) {
      next[id] = 'revealed'
      return
    }
    if (!visibleIds.has(id)) {
      next[id] = 'hidden'
      return
    }
    if (!focusIds.has(id)) {
      next[id] = 'revealed'
      return
    }
    const previousState = previous?.[id]
    next[id] = previousState === 'revealed' ? 'revealed' : 'placeholder'
  })
  return applyQuestionCardAutoReveal(nodeMap, next)
}
