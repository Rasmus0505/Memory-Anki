import { describe, expect, it } from 'vitest'
import { buildMindMapOutlineText } from './mindMapOutlineText'

const palaceDoc = {
  root: {
    data: { text: '科举制度', note: '隋唐选官制度' },
    children: [
      {
        data: { text: '创立' },
        children: [
          { data: { text: '隋文帝', note: '分科考试\n废九品中正' }, children: [] },
        ],
      },
      {
        data: { text: '完善', note: '<span data-emphasis="highlight">唐太宗</span><br>增加科目' },
        children: [],
      },
    ],
  },
}

describe('buildMindMapOutlineText', () => {
  it('keeps only the text hierarchy with notes and two spaces per level', () => {
    expect(buildMindMapOutlineText(palaceDoc, { title: '第三节 科举制度' })).toBe([
      '记忆宫殿：第三节 科举制度',
      '',
      '- 科举制度',
      '  备注：隋唐选官制度',
      '  - 创立',
      '    - 隋文帝',
      '      备注：分科考试',
      '      废九品中正',
      '  - 完善',
      '    备注：唐太宗',
      '    增加科目',
    ].join('\n'))
  })

  it('does not repeat the palace title when it is already the root card', () => {
    expect(buildMindMapOutlineText(palaceDoc, { title: '科举制度' })).toBe([
      '- 科举制度',
      '  备注：隋唐选官制度',
      '  - 创立',
      '    - 隋文帝',
      '      备注：分科考试',
      '      废九品中正',
      '  - 完善',
      '    备注：唐太宗',
      '    增加科目',
    ].join('\n'))
  })

  it('accepts the serialized editor doc and strips card markup', () => {
    const text = buildMindMapOutlineText(JSON.stringify({
      root: {
        data: { text: '细胞<span data-emphasis="highlight">结构</span><br>第二行' },
        children: [],
      },
    }))
    expect(text).toBe('- 细胞结构 第二行')
  })

  it('promotes children of an empty card instead of inventing a title', () => {
    expect(buildMindMapOutlineText({
      root: {
        data: { text: '根' },
        children: [{ data: {}, children: [{ data: { text: '子卡片' }, children: [] }] }],
      },
    })).toBe('- 根\n  - 子卡片')
  })

  it('falls back to a placeholder root when the document has no text', () => {
    expect(buildMindMapOutlineText({ root: { data: {}, children: [] } })).toBe('- 未命名导图')
  })

  it('returns an empty string when there is no mind map', () => {
    expect(buildMindMapOutlineText(null)).toBe('')
    expect(buildMindMapOutlineText('not json')).toBe('')
    expect(buildMindMapOutlineText({})).toBe('')
  })
})
