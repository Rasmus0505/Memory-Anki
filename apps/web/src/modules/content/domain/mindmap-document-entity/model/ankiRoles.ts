/**
 * Anki presentation roles on palace mind-map nodes.
 *
 * Default card: a front node + its direct children as backs (unless overridden).
 * Explicit roles are stored on node data as `ankiRole` / `ankiFrontUid`.
 */

export type AnkiRole = 'front' | 'back' | 'none'

export const ANKI_ROLE_KEY = 'ankiRole'
export const ANKI_FRONT_UID_KEY = 'ankiFrontUid'

export type AnkiRoleCycle = AnkiRole

export function normalizeAnkiRole(value: unknown): AnkiRole {
  if (value === 'front' || value === 'back' || value === 'none') return value
  return 'none'
}

export function readExplicitAnkiRole(data: Record<string, unknown> | null | undefined): AnkiRole | null {
  if (!data || typeof data !== 'object') return null
  const raw = data[ANKI_ROLE_KEY]
  if (raw === 'front' || raw === 'back' || raw === 'none') return raw
  return null
}

export function cycleAnkiRole(current: AnkiRole): AnkiRole {
  if (current === 'none') return 'front'
  if (current === 'front') return 'back'
  return 'none'
}

export function nextExplicitAnkiRole(data: Record<string, unknown> | null | undefined): AnkiRole {
  const explicit = readExplicitAnkiRole(data)
  return cycleAnkiRole(explicit ?? 'none')
}

export interface AnkiCardBinding {
  frontUid: string
  backUids: string[]
}

export interface AnkiTreeNode {
  uid: string
  parentUid: string | null
  children: string[]
  /** Explicit role when set; null/undefined means infer. */
  explicitRole?: AnkiRole | null
  /** Optional explicit front for a back node. */
  ankiFrontUid?: string | null
  text?: string
}

/**
 * Resolve effective role for a node given parent + explicit marks.
 * - explicit front/back/none wins
 * - else if parent is (effective) front and node is direct child → back
 * - else none
 */
export function resolveEffectiveAnkiRole(
  uid: string,
  nodes: Record<string, AnkiTreeNode>,
  memo: Map<string, AnkiRole> = new Map(),
): AnkiRole {
  if (memo.has(uid)) return memo.get(uid)!
  const node = nodes[uid]
  if (!node) {
    memo.set(uid, 'none')
    return 'none'
  }
  const explicit = node.explicitRole ?? null
  if (explicit === 'front' || explicit === 'back' || explicit === 'none') {
    memo.set(uid, explicit)
    return explicit
  }
  const parentUid = node.parentUid
  if (parentUid && nodes[parentUid]) {
    const parentRole = resolveEffectiveAnkiRole(parentUid, nodes, memo)
    if (parentRole === 'front' && (nodes[parentUid].children || []).includes(uid)) {
      memo.set(uid, 'back')
      return 'back'
    }
  }
  memo.set(uid, 'none')
  return 'none'
}

/** Collect anki cards: each explicit/inferred front with its back set. */
export function collectAnkiCards(nodes: Record<string, AnkiTreeNode>): AnkiCardBinding[] {
  const memo = new Map<string, AnkiRole>()
  const fronts: string[] = []
  for (const uid of Object.keys(nodes)) {
    if (resolveEffectiveAnkiRole(uid, nodes, memo) === 'front') fronts.push(uid)
  }
  return fronts.map((frontUid) => {
    const front = nodes[frontUid]
    const childBacks = (front?.children || []).filter(
      (childUid) => resolveEffectiveAnkiRole(childUid, nodes, memo) === 'back',
    )
    // Explicit backs that point at this front but are not direct children.
    const extraBacks = Object.values(nodes)
      .filter((node) => {
        if (node.uid === frontUid) return false
        if (childBacks.includes(node.uid)) return false
        if (resolveEffectiveAnkiRole(node.uid, nodes, memo) !== 'back') return false
        const linked = String(node.ankiFrontUid || '').trim()
        return linked === frontUid
      })
      .map((node) => node.uid)
    return {
      frontUid,
      backUids: [...childBacks, ...extraBacks],
    }
  })
}

export function applyAnkiRoleToNodeData(
  data: Record<string, unknown>,
  role: AnkiRole,
  options?: { frontUid?: string | null },
): Record<string, unknown> {
  const next = { ...data }
  if (role === 'none') {
    delete next[ANKI_ROLE_KEY]
    delete next[ANKI_FRONT_UID_KEY]
    return next
  }
  next[ANKI_ROLE_KEY] = role
  if (role === 'back' && options?.frontUid) {
    next[ANKI_FRONT_UID_KEY] = options.frontUid
  } else {
    delete next[ANKI_FRONT_UID_KEY]
  }
  return next
}

/** Visual tokens for Anki edit mode. */
export const ANKI_ROLE_VISUAL = {
  front: {
    borderColor: '#2563eb',
    label: '正面',
    chipTone: 'info' as const,
  },
  back: {
    borderColor: '#d97706',
    label: '反面',
    chipTone: 'warning' as const,
  },
  none: {
    borderColor: null as string | null,
    label: '',
    chipTone: 'neutral' as const,
  },
} as const
