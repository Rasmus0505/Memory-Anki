import { describe, expect, it } from 'vitest'
import { buildQuestionMenu } from './questionMenu'

function labels(items: ReturnType<typeof buildQuestionMenu>): string[] {
  return items
    .filter((item) => item.kind === 'item')
    .map((item) => (item as { label: string }).label)
}

describe('buildQuestionMenu', () => {
  it('keeps the same order in every host', () => {
    const items = buildQuestionMenu({
      edit: { onSelect: () => undefined },
      redo: { onSelect: () => undefined },
      mark: { marked: false, onSelect: () => undefined },
      copyStem: { stem: '题干' },
      remove: { onSelect: () => undefined },
    })

    expect(labels(items)).toEqual(['编辑题目', '再做一次', '标记题目', '复制题干', '删除题目'])
    expect(items.some((item) => item.kind === 'separator')).toBe(true)
  })

  it('flips mark and select labels from the current state', () => {
    expect(labels(buildQuestionMenu({
      mark: { marked: true, onSelect: () => undefined },
      select: { selected: true, onSelect: () => undefined },
    }))).toEqual(['取消标记', '取消选择'])
  })

  it('drops verbs the host cannot support', () => {
    expect(labels(buildQuestionMenu({ copyStem: { stem: '题干' } }))).toEqual(['复制题干'])
  })

  it('carries disabled state through', () => {
    const items = buildQuestionMenu({
      edit: { onSelect: () => undefined, disabled: true },
      remove: { onSelect: () => undefined, disabled: true },
    })
    expect(items.filter((item) => item.kind === 'item')).toMatchObject([
      { label: '编辑题目', disabled: true },
      { label: '删除题目', disabled: true },
    ])
  })
})
