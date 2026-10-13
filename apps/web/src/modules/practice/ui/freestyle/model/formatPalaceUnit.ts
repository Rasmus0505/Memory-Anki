/**
 * Shared "宫殿/复习单元" figure used on the start page, the day recap and the settlement.
 * 复习单元 = one review unit cut by the permanent marks, i.e. one rated unit in 随心.
 * Returns an em dash when either figure is unknown so a missing value never reads as zero.
 */
export function formatPalaceUnit(palaces: number | null | undefined, units: number | null | undefined): string {
  if (palaces == null || units == null) return '—'
  return `${palaces}/${units}`
}
