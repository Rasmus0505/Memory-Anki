import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DYNAMIC_ROUTES,
  EXACT_ROUTES,
  NAV_SECTION_ROOTS,
  resolveHistoryKey,
  resolveHistorySection,
  resolveNavSection,
  resolveRouteFallbackTarget,
} from './routeManifest'

const appRoutesSource = readFileSync(
  resolve(process.cwd(), 'src/app/router/appRoutes.tsx'),
  'utf8',
)

/** JSX 路由表中的重定向占位路由，不要求在 manifest 登记。 */
const REDIRECT_ONLY_JSX_PATHS = new Set(['/palaces/quiz'])
/** manifest 中不出现在 <Routes> 里的路径（/timer-overlay 在 App.tsx 硬分支）。 */
const NON_JSX_MANIFEST_PATHS = new Set(['/timer-overlay'])
/** dev-only 路由不参与对账。 */
const DEV_ONLY_JSX_PATHS = new Set(['/dev/tokens'])

function jsxRoutePaths(): string[] {
  return Array.from(appRoutesSource.matchAll(/path="([^"]+)"/g), (match) => match[1]).filter(
    (path) => path !== '*',
  )
}

function toSamplePath(jsxPath: string): string {
  return jsxPath.replace(/:[A-Za-z]+/g, '42')
}

describe('routeManifest ⇄ appRoutes JSX 对账', () => {
  it('JSX 路由表的每条路径都能在 manifest 中命中（回退时原样保留）', () => {
    for (const jsxPath of jsxRoutePaths()) {
      if (REDIRECT_ONLY_JSX_PATHS.has(jsxPath) || DEV_ONLY_JSX_PATHS.has(jsxPath)) continue
      const sample = toSamplePath(jsxPath)
      expect(resolveRouteFallbackTarget(sample), `JSX 路由 ${jsxPath} 未在 manifest 登记`).toBe(
        sample,
      )
    }
  })

  it('manifest 的每条精确路径都有对应 JSX 路由', () => {
    const jsxPaths = new Set(jsxRoutePaths())
    for (const entry of EXACT_ROUTES) {
      if (NON_JSX_MANIFEST_PATHS.has(entry.path)) continue
      expect(jsxPaths.has(entry.path), `manifest 路径 ${entry.path} 缺少 JSX 路由`).toBe(true)
    }
  })

  it('导航分区根路径都已在 manifest 登记且归属对应分区', () => {
    for (const [section, root] of Object.entries(NAV_SECTION_ROOTS)) {
      expect(resolveNavSection(root), `${section} 根路径 ${root}`).toBe(section)
    }
  })
})

describe('routeManifest 行为快照（与统一前的四处实现对拍）', () => {
  it.each([
    ['/', 'review', 'dashboard', 'route:/'],
    ['/dashboard', 'review', 'dashboard', 'dashboard'],
    ['/today', 'review', 'dashboard', 'today:workspace'],
    ['/freestyle', 'freestyle', 'freestyle', 'freestyle'],
    ['/palaces', 'palaces', 'palaces', 'palace:shelf'],
    ['/palaces/list', 'palaces', 'palaces', 'palace:list'],
    ['/palaces/new', 'knowledge', 'palaces', 'palace:new'],
    ['/batch-generation', 'knowledge', 'other', 'route:/batch-generation'],
    ['/knowledge', 'palaces', 'knowledge', 'knowledge:workspace'],
    ['/knowledge/chapter/9', 'palaces', 'knowledge', 'route:/knowledge/chapter/9'],
    ['/english', 'english', 'english', 'english:hub'],
    ['/english/listening', 'english', 'english', 'english:listening'],
    ['/palaces/42', 'palaces', 'palaces', 'palace:view:42'],
    ['/palaces/42/edit', 'knowledge', 'palaces', 'palace:edit:42'],
    ['/palaces/42/quiz', 'knowledge', 'palaces', 'palace:quiz:42'],
    ['/english/listening/courses/3', 'english', 'english', 'english:course:3'],
    ['/english/reading/materials/5', 'english', 'english', 'english:material:5'],
    ['/profile', null, 'profile', 'profile:overview'],
    ['/profile/timer', null, 'profile', 'profile:timer'],
    ['/profile/unknown', null, 'profile', 'profile:unknown'],
    ['/timer-overlay', null, 'other', 'route:/timer-overlay'],
    ['/totally-unknown', null, 'other', 'route:/totally-unknown'],
    ['/freestyle/legacy', null, 'other', 'route:/freestyle/legacy'],
  ] as const)('%s → nav=%s history=%s key=%s', (pathname, nav, history, key) => {
    expect(resolveNavSection(pathname)).toBe(nav)
    expect(resolveHistorySection(pathname)).toBe(history)
    expect(resolveHistoryKey(pathname)).toBe(key)
  })

  it('registered:false 的动态条目不参与回退保留', () => {
    const unregistered = DYNAMIC_ROUTES.filter((entry) => entry.registered === false)
    expect(unregistered.length).toBeGreaterThan(0)
    expect(resolveRouteFallbackTarget('/profile/unknown')).toBe('/profile')
  })

  it('does not register the retired standalone review pages', () => {
    expect(resolveRouteFallbackTarget('/review')).toBe('/freestyle')
    expect(resolveRouteFallbackTarget('/review/session/9')).toBe('/freestyle')
    expect(resolveRouteFallbackTarget('/review/completed/4')).toBe('/freestyle')
    expect(resolveNavSection('/review')).toBeNull()
  })
})
