import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import {
  getMindMapNodeStoredText,
  getMindMapNodeUid,
  type MindMapNode,
} from './document'

/**
 * 正文字数统计，口径对齐 Obsidian 状态栏：
 * - `words`：汉字逐字计，英文/数字按词计（中文读者口中的“字数”）；
 * - `chars`：不计空白的可见字符数（含标点）。
 */
export interface MindMapTextMetrics {
  words: number
  chars: number
}

/** 单个节点的统计结果，连同取数时的原文，供缓存判断是否需要重算。 */
export interface MindMapNodeTextMetrics extends MindMapTextMetrics {
  text: string
}

export type MindMapTextMetricsCache = Map<string, MindMapNodeTextMetrics>

export interface MindMapTextMetricsSnapshot extends MindMapTextMetrics {
  /** 卡片数（含根卡）。 */
  cards: number
  byUid: Map<string, MindMapNodeTextMetrics>
}

// 汉字、假名、谚文逐字计数；拉丁字母/数字连续串按一个词计数。
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const LATIN_WORD_RE = /[A-Za-z0-9]+(?:['.-][A-Za-z0-9]+)*/g

export function countTextMetrics(plainText: string): MindMapTextMetrics {
  if (typeof plainText !== 'string' || !plainText) return { words: 0, chars: 0 }
  const cjk = plainText.match(CJK_CHAR_RE)?.length ?? 0
  const latin = plainText.match(LATIN_WORD_RE)?.length ?? 0
  // Array.from 让 emoji 等代理对按一个字符计。
  const chars = Array.from(plainText.replace(/\s+/g, '')).length
  return { words: cjk + latin, chars }
}

/**
 * 卡片正文 → 可计数字的纯文本。
 *
 * `stripMindMapHtml` 只处理 `<br>`：`<div>甲</div><div>乙</div>` 直接拼接会把
 * 两段英文粘成一个词。这里先给块级标签补上换行，再做统一的标签/实体清洗。
 */
export function mindMapTextToCountableText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return stripMindMapHtml(
    value
      .replace(/<\/(?:div|p|li|h[1-6])>/gi, '\n')
      .replace(/<(?:div|p|li|h[1-6])\b[^>]*>/gi, '\n'),
  )
}

export function countMindMapTextMetrics(value: unknown): MindMapTextMetrics {
  return countTextMetrics(mindMapTextToCountableText(value))
}

/**
 * 遍历整份文档统计正文。根卡也计入（它也是画布上看得到的文字）。
 *
 * `document` 必须是已规范化的 editor_doc：这里刻意不调用
 * `normalizeMindMapDocument`（它会 structuredClone 整份文档），
 * 因为这段统计会跟着每次文档变更重算。
 *
 * 传入 `cache` 时按 uid 复用未改动节点的结果，大图提交后重算只扫改过的卡。
 */
export function collectMindMapTextMetrics(
  document: { root?: MindMapNode } | null | undefined,
  cache?: MindMapTextMetricsCache,
): MindMapTextMetricsSnapshot {
  const byUid = new Map<string, MindMapNodeTextMetrics>()
  let words = 0
  let chars = 0
  let cards = 0

  const walk = (node: MindMapNode | null | undefined, fallbackUid: string) => {
    if (!node || typeof node !== 'object') return
    const uid = getMindMapNodeUid(node, fallbackUid)
    const text = getMindMapNodeStoredText(node)
    const cached = cache?.get(uid)
    const metrics: MindMapNodeTextMetrics =
      cached && cached.text === text
        ? cached
        : { text, ...countMindMapTextMetrics(text) }
    if (cache && metrics !== cached) cache.set(uid, metrics)
    byUid.set(uid, metrics)
    words += metrics.words
    chars += metrics.chars
    cards += 1
    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child, index) => walk(child, `${fallbackUid}-${index}`))
  }

  walk(document?.root, 'root')
  // 长时间编辑会删卡：顺手清掉已不存在 uid 的缓存，避免 Map 无限长。
  if (cache && cache.size > byUid.size + 128) {
    for (const uid of cache.keys()) {
      if (!byUid.has(uid)) cache.delete(uid)
    }
  }
  return { words, chars, cards, byUid }
}
