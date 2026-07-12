/**
 * 思维导图分支统一色板。
 *
 * 之前存在两套冲突的定义：layout.ts 的柔和马卡龙 5 色 与 NodeCard.tsx 的高饱和 8 色，
 * 导致同一组件在不同数据下视觉风格漂移。这里收敛为单一数据源。
 *
 * 8 色、色相等间距分布、统一中等饱和度与明度，兼顾区分度与舒适感。
 * 顺序与旧的 PAPER_BRANCH_COLORS 对齐，保证既有宫殿的分支着色尽量不变。
 */
export const BRANCH_COLORS: readonly string[] = [
  '#2563eb', // 蓝
  '#059669', // 翠绿
  '#d97706', // 琥珀
  '#7c3aed', // 紫
  '#dc2626', // 红
  '#0891b2', // 青
  '#4f46e5', // 靛
  '#be185d', // 玫红
] as const

export function getBranchColor(index: number): string {
  return BRANCH_COLORS[index % BRANCH_COLORS.length]
}
