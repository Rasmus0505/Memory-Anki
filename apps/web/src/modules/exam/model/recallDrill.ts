import type { MindMapDoc, MindMapDocNode } from '@/shared/api/contracts'

export interface DrillNode {
  uid: string
  text: string
  /** Ancestor texts from root to parent. */
  path: string[]
  children: string[]
  depth: number
}

export interface NodeRecallPrompt {
  kind: 'node'
  node: DrillNode
}

export interface PathQuestion {
  kind: 'path'
  node: DrillNode
  options: string[]
  answer: string
}

function plainText(value: unknown): string {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseDoc(raw: MindMapDoc | Record<string, unknown> | string | null | undefined): MindMapDoc | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as MindMapDoc
    } catch {
      return null
    }
  }
  return raw as MindMapDoc
}

export function flattenDoc(doc: MindMapDoc | null): DrillNode[] {
  const nodes: DrillNode[] = []
  const walk = (node: MindMapDocNode, path: string[], depth: number, index: string) => {
    const text = plainText(node.data?.text)
    const children = (node.children ?? []).filter(Boolean)
    const uid = String(node.data?.uid ?? index)
    nodes.push({
      uid,
      text,
      path,
      depth,
      children: children.map((child) => plainText(child.data?.text)).filter(Boolean),
    })
    children.forEach((child, childIndex) => walk(child, [...path, text], depth + 1, `${index}.${childIndex}`))
  }
  if (doc?.root) walk(doc.root, [], 0, '0')
  return nodes.filter((node) => node.text)
}

/** Deterministic PRNG so a given seed always yields the same drill. */
function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(items: T[], random: () => number): T | undefined {
  return items.length ? items[Math.floor(random() * items.length)] : undefined
}

export function buildNodeRecall(nodes: DrillNode[], seed: number): NodeRecallPrompt | null {
  const node = pick(
    nodes.filter((item) => item.depth > 0 && item.children.length > 0),
    mulberry32(seed),
  )
  return node ? { kind: 'node', node } : null
}

export function buildPathQuestion(nodes: DrillNode[], seed: number): PathQuestion | null {
  const random = mulberry32(seed)
  const branches = [...new Set(nodes.filter((item) => item.depth === 1).map((item) => item.text))]
  if (branches.length < 2) return null
  const node = pick(
    nodes.filter((item) => item.depth >= 2 && item.children.length === 0 && item.path[1]),
    random,
  )
  if (!node) return null
  const answer = node.path[1]!
  const distractors = branches.filter((text) => text !== answer).sort(() => random() - 0.5).slice(0, 3)
  const options = [answer, ...distractors].sort(() => random() - 0.5)
  return { kind: 'path', node, options, answer }
}
