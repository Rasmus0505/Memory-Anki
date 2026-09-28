/**
 * 思维导图分支统一色板（单一数据源）。
 *
 * 暖纸画布上的 8 色：色相错开、饱和度压低、明度统一，
 * 保证分支可区分又不刺眼。索引语义不变：分支仍按序号取色。
 */
export const BRANCH_COLORS: readonly string[] = [
  '#c0673f', // 赤陶
  '#d28a2c', // 琥珀
  '#7d8c3c', // 橄榄
  '#4e8c7c', // 青苔
  '#88598a', // 梅子
  '#b85f68', // 玫瑰陶
  '#a88638', // 赭石
  '#4d7b8a', // 暖青石
] as const

export function getBranchColor(index: number): string {
  return BRANCH_COLORS[index % BRANCH_COLORS.length]
}
