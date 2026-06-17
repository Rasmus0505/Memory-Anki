import type { PdfImportMode } from '@/shared/api/contracts'

export function uniqueSortedPages(values: number[]) {
  return Array.from(new Set(values.filter((value) => Number.isInteger(value) && value > 0))).sort(
    (left, right) => left - right,
  )
}

export function serializePageSelection(values: number[]) {
  return uniqueSortedPages(values).join(', ')
}

export function normalizePdfImportMode(value: unknown): PdfImportMode {
  return value === 'structured_merge' ? 'structured_merge' : 'direct_generation'
}

export function parsePageSelectionInput(
  value: string,
  maxPage: number | null,
): { pages: number[]; error: string } {
  const normalized = value.trim()
  if (!normalized) {
    return { pages: [], error: '' }
  }
  const segments = normalized
    .split(/[,，]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const pages: number[] = []
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      pages.push(Number(segment))
      continue
    }
    const rangeMatch = segment.match(/^(\d+)\s*-\s*(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (start > end) {
        return { pages: [], error: '页码范围格式无效，请使用从小到大的范围，例如 3-6。' }
      }
      for (let page = start; page <= end; page += 1) {
        pages.push(page)
      }
      continue
    }
    return { pages: [], error: '页码格式无效，请使用 1,3-5 这样的格式。' }
  }
  const normalizedPages = uniqueSortedPages(pages)
  if (normalizedPages.some((page) => page <= 0)) {
    return { pages: [], error: '页码必须从 1 开始。' }
  }
  if (maxPage != null && normalizedPages.some((page) => page > maxPage)) {
    return { pages: [], error: `存在超出 PDF 总页数的页码，当前资料共 ${maxPage} 页。` }
  }
  return { pages: normalizedPages, error: '' }
}

