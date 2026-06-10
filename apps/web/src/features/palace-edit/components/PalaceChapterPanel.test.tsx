import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PalaceChapterPanel } from '@/features/palace-edit/components/PalaceChapterPanel'
import type { ChapterOption } from '@/features/palace-edit/hooks/usePalaceEditPage'

const options: ChapterOption[] = [
  {
    id: 10,
    name: '第十章',
    depth: 0,
    subjectId: 1,
    subjectName: '中国教育史',
    parentId: null,
    children: [
      {
        id: 11,
        name: '第一节 第十章小节',
        depth: 1,
        subjectId: 1,
        subjectName: '中国教育史',
        parentId: 10,
        children: [],
      },
    ],
  },
  {
    id: 20,
    name: '第1章外国古代教育',
    depth: 0,
    subjectId: 2,
    subjectName: '外国教育史',
    parentId: null,
    children: [
      {
        id: 21,
        name: '第一节 东方文明古国的教育',
        depth: 1,
        subjectId: 2,
        subjectName: '外国教育史',
        parentId: 20,
        children: [],
      },
    ],
  },
]

describe('PalaceChapterPanel', () => {
  it('renders a summary card by default instead of the full tree', () => {
    render(
      <PalaceChapterPanel
        chapterOptions={options}
        explicitChapterIds={[11, 21]}
        inheritedChapterIds={[10, 20]}
        primaryChapterId={21}
        onToggleChapter={vi.fn()}
      />,
    )

    expect(screen.getByText('章节关联')).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择章节' })).toBeTruthy()
    expect(screen.getByText('已关联章节')).toBeTruthy()
    expect(screen.getByText('当前命名来源')).toBeTruthy()
    expect(screen.getByText('涉及学科')).toBeTruthy()
    expect(screen.getByText('中国教育史 1')).toBeTruthy()
    expect(screen.getByText('外国教育史 1')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText('第十章')).toBeNull()
  })

  it('opens a grouped chapter picker dialog and keeps hierarchical badges', () => {
    render(
      <PalaceChapterPanel
        chapterOptions={options}
        explicitChapterIds={[11]}
        inheritedChapterIds={[10]}
        primaryChapterId={11}
        onToggleChapter={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '选择章节' }))

    const dialogHeading = screen.getByRole('heading', { name: '选择章节关联' })
    const dialogContent = dialogHeading.closest('.max-w-5xl')
    expect(dialogContent).toBeTruthy()
    expect(within(dialogContent as HTMLElement).getAllByText('中国教育史').length).toBeGreaterThan(0)
    expect(within(dialogContent as HTMLElement).getAllByText('外国教育史').length).toBeGreaterThan(0)
    expect(within(dialogContent as HTMLElement).getByText('第十章')).toBeTruthy()
    expect(within(dialogContent as HTMLElement).getByText('第一节 第十章小节')).toBeTruthy()
    expect(within(dialogContent as HTMLElement).getByText('继承关联')).toBeTruthy()
    expect(within(dialogContent as HTMLElement).getByText('命名来源')).toBeTruthy()
  })

  it('marks linked child chapters green and completed parent chapters deeper green', () => {
    render(
      <PalaceChapterPanel
        chapterOptions={options}
        explicitChapterIds={[11]}
        inheritedChapterIds={[10]}
        primaryChapterId={11}
        onToggleChapter={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '选择章节' }))

    const dialogHeading = screen.getByRole('heading', { name: '选择章节关联' })
    const dialogContent = dialogHeading.closest('.max-w-5xl')
    const parentCard = within(dialogContent as HTMLElement).getByText('第十章').closest('label')
    const childCard = within(dialogContent as HTMLElement).getByText('第一节 第十章小节').closest('label')

    expect(parentCard?.className).toContain('bg-emerald-100')
    expect(parentCard?.className).toContain('border-emerald-500')
    expect(childCard?.className).toContain('bg-emerald-50')
    expect(childCard?.className).toContain('border-emerald-300')
  })

  it('toggles chapters from the dialog and disables controls while pending', () => {
    const onToggleChapter = vi.fn()
    const { rerender } = render(
      <PalaceChapterPanel
        chapterOptions={options}
        explicitChapterIds={[11]}
        inheritedChapterIds={[10]}
        primaryChapterId={11}
        onToggleChapter={onToggleChapter}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '选择章节' }))
    const foreignSection = screen.getAllByText('外国教育史')[0]?.closest('section')
    expect(foreignSection).toBeTruthy()
    const foreignCheckbox = within(foreignSection as HTMLElement).getAllByRole('checkbox')[1]

    fireEvent.click(foreignCheckbox)
    expect(onToggleChapter).toHaveBeenCalledWith(21)

    rerender(
      <PalaceChapterPanel
        chapterOptions={options}
        explicitChapterIds={[11]}
        inheritedChapterIds={[10]}
        primaryChapterId={11}
        selectionPending
        onToggleChapter={onToggleChapter}
      />,
    )

    expect((screen.getByRole('button', { name: '保存中…' }) as HTMLButtonElement).disabled).toBe(true)
    const disabledCheckboxes = screen.getAllByRole('checkbox')
    expect(disabledCheckboxes.every((checkbox) => (checkbox as HTMLInputElement).disabled)).toBe(true)
  })
})
