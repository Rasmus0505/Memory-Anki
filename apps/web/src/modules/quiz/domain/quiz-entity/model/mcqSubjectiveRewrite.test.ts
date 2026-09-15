import { describe, expect, it } from 'vitest'
import { rewriteMcqForSubjective } from './mcqSubjectiveRewrite'

const ushinskyOptions = [
  { id: 'A', text: '教育应培养全面和谐发展的个人' },
  { id: 'B', text: '教育的最终目的在于满足社会的要求' },
  { id: 'C', text: '教学要适应儿童的年龄特征' },
  { id: 'D', text: '教育具有民族性' },
]

const hebrewOptions = [
  { id: 'A', text: '学习律法并落实到生活' },
  { id: 'B', text: '以竞技训练为中心' },
  { id: 'C', text: '只培养演说家' },
  { id: 'D', text: '取消家庭教育' },
]

describe('rewriteMcqForSubjective', () => {
  it('rewrites an except-stem into a recall-all question', () => {
    const result = rewriteMcqForSubjective({
      stem: '以下哪项不符合乌申斯基的教育观点',
      options: ushinskyOptions,
      correctOptionId: 'B',
    })
    expect(result.kind).toBe('except')
    expect(result.stem).toBe('乌申斯基的教育观点有哪些')
    expect(result.referenceAnswer).toBe(
      '教育应培养全面和谐发展的个人；教学要适应儿童的年龄特征；教育具有民族性',
    )
    expect(result.referenceAnswer).not.toContain('满足社会的要求')
  })

  it('rewrites a “which statement is correct” stem toward the topic demand', () => {
    const result = rewriteMcqForSubjective({
      stem: '下列有关古希伯来学校教育实践的表述中正确的是()',
      options: hebrewOptions,
      correctOptionId: 'A',
    })
    expect(result.kind).toBe('positive')
    expect(result.stem).toBe('古希伯来学校教育实践要求什么')
    expect(result.referenceAnswer).toBe('学习律法并落实到生活')
  })

  it('rewrites “不正确的是” as an except recall', () => {
    expect(
      rewriteMcqForSubjective({
        stem: '下列关于启发式教学的表述中，不正确的是',
        options: [
          { id: 'A', text: '引导学生思考' },
          { id: 'B', text: '只要求学生记结论' },
        ],
        correctOptionId: 'B',
      }),
    ).toMatchObject({
      kind: 'except',
      stem: '启发式教学有哪些',
      referenceAnswer: '引导学生思考',
    })
  })

  it('turns “下列哪一项是” into an identity question, not a remaining which-item stem', () => {
    const result = rewriteMcqForSubjective({
      stem: '下列哪一项是细胞膜的主要成分？',
      options: [
        { id: 'A', text: '磷脂' },
        { id: 'B', text: '纤维素' },
      ],
      correctOptionId: 'A',
    })
    expect(result.stem).toBe('细胞膜的主要成分是什么')
    expect(result.stem).not.toMatch(/哪(?:一)?[项个种]/)
    expect(result.referenceAnswer).toBe('磷脂')
  })

  it('uses 有哪些 for viewpoint / principle topics', () => {
    expect(
      rewriteMcqForSubjective({
        stem: '关于夸美纽斯的教育思想，下列说法正确的是',
        options: [{ id: 'A', text: '教育适应自然' }],
        correctOptionId: 'A',
      }).stem,
    ).toBe('夸美纽斯的教育思想有哪些')
  })

  it('falls back without leaving option scaffolding', () => {
    const result = rewriteMcqForSubjective({
      stem: '下面正确的是()',
      options: [{ id: 'A', text: '要点' }],
      correctOptionId: 'A',
    })
    expect(result.stem).not.toMatch(/哪(?:一)?[项个种]|下列|以下|正确的是/)
    expect(result.referenceAnswer).toBe('要点')
  })

  it('keeps an already open-ended stem unchanged', () => {
    expect(
      rewriteMcqForSubjective({
        stem: '乌申斯基的教育观点有哪些',
        options: ushinskyOptions,
        correctOptionId: 'B',
      }).stem,
    ).toBe('乌申斯基的教育观点有哪些')
  })
})
