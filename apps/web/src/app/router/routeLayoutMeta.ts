/**
 * 路由布局元数据：决定壳层如何为某个页面排版。
 *
 * - standard：常规页面，侧栏 + 内容区 + 标准内边距。
 * - immersive：沉浸式卡片流（随心、解题复习），无环境层与页面转场，内容贴边；
 *   同时属于 mindmap 宿主，侧栏与主区按全屏宿主排版。
 * - mindmap：思维导图宿主页（知识树、宫殿查看/编辑），侧栏贴窗口边缘，内容区铺满。
 *
 * 规则按顺序匹配，首个命中的生效；未命中即 standard。
 */
export type AppLayoutMode = 'standard' | 'immersive' | 'mindmap'

export interface AppRouteLayoutMeta {
  pattern: RegExp
  layoutMode: Exclude<AppLayoutMode, 'standard'>
}

export const APP_ROUTE_LAYOUT_META: readonly AppRouteLayoutMeta[] = [
  { pattern: /^\/freestyle(?:\/|$)/, layoutMode: 'immersive' },
  { pattern: /^\/freestyle-2(?:\/|$)/, layoutMode: 'immersive' },
  { pattern: /^\/palaces\/\d+\/review$/, layoutMode: 'immersive' },
  { pattern: /^\/knowledge$/, layoutMode: 'mindmap' },
  { pattern: /^\/palaces\/\d+(?:\/edit)?$/, layoutMode: 'mindmap' },
]

export function resolveAppLayoutMode(pathname: string): AppLayoutMode {
  return APP_ROUTE_LAYOUT_META.find((meta) => meta.pattern.test(pathname))?.layoutMode ?? 'standard'
}
