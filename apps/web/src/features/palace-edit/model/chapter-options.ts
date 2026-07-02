import type { ChapterOption } from '@/features/palace-edit/hooks/usePalaceEditPage'

export function flattenChapterOptions(options: ChapterOption[]): ChapterOption[] {
  return options.flatMap((option) => [option, ...flattenChapterOptions(option.children)])
}
