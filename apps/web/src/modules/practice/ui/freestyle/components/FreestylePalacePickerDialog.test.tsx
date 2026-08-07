import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestylePalacePickerDialog } from './FreestylePalacePickerDialog'

const subjects = [{
  key: 'subject:1',
  id: 1,
  title: '教育学',
  chapters: [],
  ungrouped: {
    key: 'ungrouped',
    title: '未归类宫殿',
    palaces: [
      { id: 11, title: 'Palace A', resolved_title: 'Palace A' },
      { id: 22, title: 'Palace B', resolved_title: 'Palace B' },
    ] as never,
    palaceIds: [11, 22],
  },
}]

describe('FreestylePalacePickerDialog', () => {
  it('can collapse an entire subject', () => {
    render(<FreestylePalacePickerDialog open subjects={subjects} value={[]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '收起教育学' }))
    expect(screen.queryByText('Palace A')).toBeNull()
    expect(screen.getByRole('button', { name: '展开教育学' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '展开教育学' }))
    expect(screen.getByText('Palace A')).toBeTruthy()
  })

  it('opens as a large picker and confirms selected ids', () => {
    const onConfirm = vi.fn()
    render(<FreestylePalacePickerDialog open subjects={subjects} value={[]} onOpenChange={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByText('Palace A')).toBeTruthy()
    const content = screen.getByRole('dialog')
    expect(content.className).toContain('max-w-none')
    expect(screen.getByText('Palace A').closest('div.overflow-y-auto')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect(screen.getByRole('button', { name: '全选' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }))
    expect(onConfirm).toHaveBeenCalledWith([11, 22])
  })
})
