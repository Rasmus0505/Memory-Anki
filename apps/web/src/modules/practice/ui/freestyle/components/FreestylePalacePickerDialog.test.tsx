import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestylePalacePickerDialog } from './FreestylePalacePickerDialog'

const subjects = [{
  key: 'subject:1',
  id: 1,
  title: '教育学',
  chapters: [{
    key: 'chapter:9',
    id: 9,
    title: '第9章现代欧美教育思想',
    children: [],
    palaces: [
      { id: 11, title: '第二节进步教育运动', resolved_title: '第二节进步教育运动' },
    ] as never,
    palaceIds: [11],
  }],
  ungrouped: {
    key: 'ungrouped',
    title: '未归类宫殿',
    palaces: [
      { id: 22, title: 'Palace B', resolved_title: 'Palace B' },
    ] as never,
    palaceIds: [22],
  },
}]

function checkbox(name: string) {
  return screen.getByRole('checkbox', { name }) as HTMLInputElement
}

describe('FreestylePalacePickerDialog', () => {
  it('can collapse an entire subject', () => {
    render(<FreestylePalacePickerDialog open subjects={subjects} value={[]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '收起教育学' }))
    expect(screen.queryByText('第二节进步教育运动')).toBeNull()
    expect(screen.getByRole('button', { name: '展开教育学' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '展开教育学' }))
    expect(screen.getByText('第二节进步教育运动')).toBeTruthy()
  })

  it('opens as a large picker and confirms selected ids', () => {
    const onConfirm = vi.fn()
    render(<FreestylePalacePickerDialog open subjects={subjects} value={[]} onOpenChange={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByText('第二节进步教育运动')).toBeTruthy()
    const content = screen.getByRole('dialog')
    expect(content.className).toContain('max-w-none')
    expect(screen.getByText('第二节进步教育运动').closest('div.overflow-y-auto')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect(screen.getByRole('button', { name: '全选' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }))
    expect(onConfirm).toHaveBeenCalledWith([11, 22])
  })

  it('keeps local unchecks when the parent recreates value while open', () => {
    const { rerender } = render(
      <FreestylePalacePickerDialog open subjects={subjects} value={[11, 22]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    )

    fireEvent.click(checkbox('选择宫殿第二节进步教育运动'))
    expect(checkbox('选择宫殿第二节进步教育运动').checked).toBe(false)

    rerender(
      <FreestylePalacePickerDialog open subjects={subjects} value={[11, 22]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    )

    expect(checkbox('选择宫殿第二节进步教育运动').checked).toBe(false)
    expect(checkbox('选择宫殿Palace B').checked).toBe(true)
  })

  it('toggles a palace by clicking its title', () => {
    render(<FreestylePalacePickerDialog open subjects={subjects} value={[11]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    fireEvent.click(screen.getByText('第二节进步教育运动'))
    expect(checkbox('选择宫殿第二节进步教育运动').checked).toBe(false)
  })

  it('toggles a chapter by clicking its title', () => {
    render(<FreestylePalacePickerDialog open subjects={subjects} value={[11]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    fireEvent.click(screen.getByText('第9章现代欧美教育思想'))
    expect(checkbox('选择章节第9章现代欧美教育思想').checked).toBe(false)
    expect(checkbox('选择宫殿第二节进步教育运动').checked).toBe(false)
  })
})
