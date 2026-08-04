/**
 * 路由元数据单一数据源。
 *
 * 此前同一套“路径 → 导航分区 / 历史分区 / 历史键 / 回退目标”规则分散在
 * 四处手工锁步维护（app/shell/navSections.ts、shared/page-history/
 * navigationSection.ts、shared/page-history/pageHistoryRoute.ts、
 * app/router/appRoutes.tsx 的回退清单）。现在它们全部从本文件派生；
 * 新增路由只需在这里登记一条。
 *
 * JSX 路由表（appRoutes.tsx 的 <Routes>）仍人工维护，由
 * appRoutes.manifest.test 与本文件对账。
 *
 * 两套分区键空间刻意不同：
 * - NavSectionKey：侧栏/底栏 5 个导航分区（'knowledge' 是“创建”分区的
 *   历史遗留键名，与 /knowledge 路由无关；重命名列为后续任务）。
 * - PageHistorySectionKey：页面历史的 9 键空间（见 page-history 模块）。
 */
import type { PageHistorySectionKey } from '@/shared/page-history/pageHistoryTypes'

export type NavSectionKey =
  | 'freestyle'
  | 'palaces'
  | 'english'
  | 'knowledge'
  | 'review'

export interface ExactRouteEntry {
  path: string
  nav: NavSectionKey | null
  history: PageHistorySectionKey
  /** 省略时回退为 `route:${pathname}`。 */
  historyKey?: string
  /** 设置后出现在命令面板（Ctrl+K）的"页面"组中。 */
  commandLabel?: string
}

export interface DynamicRouteEntry {
  pattern: RegExp
  nav: NavSectionKey | null
  history: PageHistorySectionKey
  historyKey?: (match: RegExpMatchArray) => string
  /** false 表示只用于历史键归类，不算已注册路由（不参与回退保留判断）。 */
  registered?: boolean
}

export interface PrefixRule {
  prefix: string
  nav: NavSectionKey | null
  history: PageHistorySectionKey
  /** 未知子路径的回退目标；省略则继续走默认回退（/freestyle）。 */
  fallbackTarget?: string
}

export const EXACT_ROUTES: ExactRouteEntry[] = [
  { path: '/', nav: 'review', history: 'dashboard' },
  { path: '/dashboard', nav: 'review', history: 'dashboard', historyKey: 'dashboard' },
  { path: '/today', nav: 'review', history: 'dashboard', historyKey: 'today:workspace', commandLabel: '今日工作台' },
  { path: '/freestyle', nav: 'freestyle', history: 'freestyle', historyKey: 'freestyle' },
  { path: '/palaces', nav: 'palaces', history: 'palaces', historyKey: 'palace:shelf' },
  { path: '/palaces/list', nav: 'palaces', history: 'palaces', historyKey: 'palace:list', commandLabel: '宫殿列表' },
  { path: '/palaces/new', nav: 'knowledge', history: 'palaces', historyKey: 'palace:new' },
  { path: '/batch-generation', nav: 'knowledge', history: 'other' },
  { path: '/knowledge', nav: 'palaces', history: 'knowledge', historyKey: 'knowledge:workspace', commandLabel: '知识树' },
  { path: '/english', nav: 'english', history: 'english', historyKey: 'english:hub' },
  { path: '/english/listening', nav: 'english', history: 'english', historyKey: 'english:listening', commandLabel: '英语听力' },
  { path: '/english/reading', nav: 'english', history: 'english', historyKey: 'english:reading', commandLabel: '英语阅读' },
  { path: '/english/patterns', nav: 'english', history: 'english', historyKey: 'english:patterns', commandLabel: '英语句型' },
  { path: '/english/vocab', nav: 'english', history: 'english', historyKey: 'english:vocab', commandLabel: '英语词汇' },
  { path: '/profile', nav: null, history: 'profile', historyKey: 'profile:overview', commandLabel: '设置' },
  { path: '/profile/timer', nav: null, history: 'profile', historyKey: 'profile:timer' },
  { path: '/profile/feedback', nav: null, history: 'profile', historyKey: 'profile:feedback' },
  { path: '/profile/ai', nav: null, history: 'profile', historyKey: 'profile:ai' },
  { path: '/profile/backups', nav: null, history: 'profile', historyKey: 'profile:backups' },
  { path: '/timer-overlay', nav: null, history: 'other' },
]

export const DYNAMIC_ROUTES: DynamicRouteEntry[] = [
  {
    pattern: /^\/palaces\/(\d+)$/,
    nav: 'palaces',
    history: 'palaces',
    historyKey: (match) => `palace:view:${match[1]}`,
  },
  {
    pattern: /^\/palaces\/(\d+)\/edit$/,
    nav: 'knowledge',
    history: 'palaces',
    historyKey: (match) => `palace:edit:${match[1]}`,
  },
  {
    pattern: /^\/palaces\/(\d+)\/quiz$/,
    nav: 'knowledge',
    history: 'palaces',
    historyKey: (match) => `palace:quiz:${match[1]}`,
  },
  {
    pattern: /^\/english\/listening\/courses\/(\d+)$/,
    nav: 'english',
    history: 'english',
    historyKey: (match) => `english:course:${match[1]}`,
  },
  {
    pattern: /^\/english\/reading\/materials\/(\d+)$/,
    nav: 'english',
    history: 'english',
    historyKey: (match) => `english:material:${match[1]}`,
  },
  // 仅历史键归类：未知 /profile/* 落到 profile:<sub>，与既有行为一致。
  {
    pattern: /^\/profile\/(.+)$/,
    nav: null,
    history: 'profile',
    historyKey: (match) => `profile:${match[1]}`,
    registered: false,
  },
]

/** 已注册动态路由未知后代的“前缀提取”回退（顺序即匹配优先级）。 */
export const DYNAMIC_PREFIX_FALLBACKS: Array<{
  match: RegExp
  build: (id: string) => string
}> = [
  { match: /^\/palaces\/(\d+)(?:\/.*)?$/, build: (id) => `/palaces/${id}` },
  {
    match: /^\/english\/listening\/courses\/(\d+)(?:\/.*)?$/,
    build: (id) => `/english/listening/courses/${id}`,
  },
  {
    match: /^\/english\/reading\/materials\/(\d+)(?:\/.*)?$/,
    build: (id) => `/english/reading/materials/${id}`,
  },
]

/** 顶层前缀规则（顺序即匹配优先级）。 */
export const PREFIX_RULES: PrefixRule[] = [
  { prefix: '/knowledge/', nav: 'palaces', history: 'knowledge', fallbackTarget: '/knowledge' },
  { prefix: '/freestyle/', nav: null, history: 'other', fallbackTarget: '/freestyle' },
  { prefix: '/profile/', nav: null, history: 'profile', fallbackTarget: '/profile' },
  { prefix: '/english/', nav: 'english', history: 'english', fallbackTarget: '/english' },
  { prefix: '/palaces/', nav: null, history: 'palaces', fallbackTarget: '/palaces' },
  { prefix: '/timer-overlay/', nav: null, history: 'other', fallbackTarget: '/timer-overlay' },
]

/** 导航分区根路径（侧栏第二次点击的目标），与 navSections[].to 对齐。 */
export const NAV_SECTION_ROOTS: Record<NavSectionKey, string> = {
  freestyle: '/freestyle',
  palaces: '/palaces',
  english: '/english',
  knowledge: '/palaces/new',
  review: '/dashboard',
}

/** 命令面板"页面"组的可发现页面清单（manifest 驱动）。 */
export const COMMAND_PAGES: Array<{ path: string; label: string }> = EXACT_ROUTES.filter(
  (entry): entry is ExactRouteEntry & { commandLabel: string } => Boolean(entry.commandLabel),
).map((entry) => ({ path: entry.path, label: entry.commandLabel }))

const exactByPath = new Map(EXACT_ROUTES.map((entry) => [entry.path, entry]))

function matchDynamic(pathname: string) {
  for (const entry of DYNAMIC_ROUTES) {
    const match = pathname.match(entry.pattern)
    if (match) return { entry, match }
  }
  return null
}

function matchPrefix(pathname: string) {
  return PREFIX_RULES.find((rule) => pathname.startsWith(rule.prefix)) ?? null
}

/** 判断路径归属哪个导航分区（null = 不属于任何分区）。 */
export function resolveNavSection(pathname: string): NavSectionKey | null {
  const exact = exactByPath.get(pathname)
  if (exact) return exact.nav
  const dynamic = matchDynamic(pathname)
  if (dynamic) return dynamic.entry.nav
  return matchPrefix(pathname)?.nav ?? null
}

/** 生成某个导航分区的 matches 断言（供 navSections 派生）。 */
export function createNavSectionMatcher(section: NavSectionKey) {
  return (pathname: string) => resolveNavSection(pathname) === section
}

/** 页面历史分区（9 键空间）。 */
export function resolveHistorySection(pathname: string): PageHistorySectionKey {
  const exact = exactByPath.get(pathname)
  if (exact) return exact.history
  const dynamic = matchDynamic(pathname)
  if (dynamic) return dynamic.entry.history
  return matchPrefix(pathname)?.history ?? 'other'
}

/** 页面历史键（快照去重标识）。 */
export function resolveHistoryKey(pathname: string): string {
  const exact = exactByPath.get(pathname)
  if (exact?.historyKey) return exact.historyKey
  if (!exact) {
    const dynamic = matchDynamic(pathname)
    if (dynamic?.entry.historyKey) return dynamic.entry.historyKey(dynamic.match)
  }
  return `route:${pathname}`
}

function normalizePathname(pathname: string) {
  if (!pathname || pathname === '/') return '/'
  return pathname.replace(/\/+$/, '') || '/'
}

/**
 * 未命中 JSX 路由表时的回退目标：
 * 已注册路径原样保留 → 动态前缀提取 → 分区前缀根 → /freestyle。
 */
export function resolveRouteFallbackTarget(pathname: string): string {
  const normalizedPathname = normalizePathname(pathname)

  if (exactByPath.has(normalizedPathname)) return normalizedPathname
  const dynamic = matchDynamic(normalizedPathname)
  if (dynamic && dynamic.entry.registered !== false) return normalizedPathname

  for (const { match, build } of DYNAMIC_PREFIX_FALLBACKS) {
    const matched = normalizedPathname.match(match)
    if (matched) return build(matched[1])
  }

  const prefixRule = matchPrefix(normalizedPathname)
  if (prefixRule?.fallbackTarget) return prefixRule.fallbackTarget

  return '/freestyle'
}
