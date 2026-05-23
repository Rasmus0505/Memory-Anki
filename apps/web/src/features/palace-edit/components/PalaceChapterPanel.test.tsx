import { fireEvent, render, screen } from '@testing-library/react'
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
]

describe('PalaceChapterPanel', () => {
  it('renders primary and inherited badges with hierarchical labels', () => {
    const onToggleChapter = vi.fn()
    render(
      <PalaceChapterPanel
        chapterOptions={options}
        explicitChapterIds={[11]}
        inheritedChapterIds={[10]}
        primaryChapterId={11}
        onToggleChapter={onToggleChapter}
      />,
    )

    expect(screen.getByText('第十章')).toBeTruthy()
    expect(screen.getByText('第一节 第十章小节')).toBeTruthy()
    expect(screen.getByText('继承关联')).toBeTruthy()
    expect(screen.getByText('命名来源')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(onToggleChapter).toHaveBeenCalledWith(11)
  })
})
