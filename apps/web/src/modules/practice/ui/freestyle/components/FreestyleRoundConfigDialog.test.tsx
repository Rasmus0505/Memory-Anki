import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'
import { FreestyleRoundConfigDialog } from './FreestyleRoundConfigDialog'
import { getPalacesGroupedApi } from '@/modules/content/public'

vi.mock('@/modules/content/public', () => ({
  getPalacesGroupedApi: vi.fn(),
  getSubjectTreeApi: vi.fn().mockResolvedValue({ chapters: [] }),
}))

const config = {
  content: { mindmap_branch: true, anki_card: true, quiz_question: true },
  weights: { mindmap_branch: 2, anki_card: 2, quiz_question: 1 },
  mix_mode: 'ratio',
  mix_ratio: { mindmap: 2, quiz: 1 },
  bound_quiz_placement: 'into_mix',
  palace_order: 'finish_palace_then_next',
  due_policy: 'due_only',
  quiz_mastery_buckets: ['unseen', 'weak'],
  quiz_scope: 'cross_palace_random',
  specific_palace_ids: [],
  question_type: 'all',
  weak_quiz_priority: true,
  seed: 17,
} as unknown as FreestyleFeedConfig

function renderDialog(
  onSaveConfig = vi.fn(),
  mode: 'replan' | 'nextRound' = 'replan',
) {
  render(
    <FreestyleRoundConfigDialog
      open
      config={config}
      onOpenChange={vi.fn()}
      onSaveConfig={onSaveConfig}
      mode={mode}
    />,
  )
  return { onSaveConfig }
}

describe('FreestyleRoundConfigDialog', () => {
  beforeEach(() => {
    vi.mocked(getPalacesGroupedApi).mockReset().mockResolvedValue({ subjects: [] } as never)
  })

  it('saves the sanitized draft', async () => {
    const { onSaveConfig } = renderDialog()

    await screen.findByRole('button', { name: '保存配置并重排' })
    expect(screen.getByRole('radio', { name: /^记忆宫殿/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /^刷题/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /^混合模式/ })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /英语宫殿/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    expect(onSaveConfig).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: '保留，继续这一轮' }))
    expect(onSaveConfig).toHaveBeenCalledTimes(1)
    expect(onSaveConfig.mock.calls[0][1]).toBe('keep-overlap')
  })

  it('starts a fresh round when overlapping progress is discarded', async () => {
    const { onSaveConfig } = renderDialog()

    await screen.findByRole('button', { name: '保存配置并重排' })
    fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    fireEvent.click(await screen.findByRole('button', { name: '不保留，开启新一轮' }))

    expect(onSaveConfig).toHaveBeenCalledTimes(1)
    expect(onSaveConfig.mock.calls[0][1]).toBe('start-fresh')
  })

  it('cancels the save when the overlap reminder is dismissed', async () => {
    const { onSaveConfig } = renderDialog()

    await screen.findByRole('button', { name: '保存配置并重排' })
    fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    const prompt = await screen.findByTestId('freestyle-overlap-progress-dialog')
    fireEvent.click(within(prompt).getByRole('button', { name: '关闭弹窗' }))

    expect(onSaveConfig).not.toHaveBeenCalled()
    expect(screen.queryByTestId('freestyle-overlap-progress-dialog')).toBeNull()
  })

  it('uses next-round copy and CTA after settlement', async () => {
    const { onSaveConfig } = renderDialog(vi.fn(), 'nextRound')

    await screen.findByRole('button', { name: '开始下一轮' })
    expect(screen.getByText(/确认后开始全新一轮/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '开始下一轮' }))
    expect(screen.queryByTestId('freestyle-overlap-progress-dialog')).toBeNull()
    expect(onSaveConfig).toHaveBeenCalledTimes(1)
  })

  it('opens the palace picker without unmounting the configuration dialog', async () => {
    renderDialog()

    fireEvent.click((await screen.findAllByRole('button', { name: '选择宫殿' }))[0])

    expect(screen.getByRole('dialog', { name: /宫殿章节筛选/ })).toBeTruthy()
    // Radix aria-hides the outer dialog when a nested modal opens, but must not unmount it.
    expect(document.querySelector('[data-dialog-title="true"]')?.textContent).toMatch(/随心配置/)
  })

  it('saves the palace scope when the picker confirms', async () => {
    vi.mocked(getPalacesGroupedApi).mockResolvedValue({
      subjects: [{
        subject: { id: 1, name: '教育学', color: null },
        chapter_groups: [],
        ungrouped_palaces: [{
          id: 11,
          title: 'Palace A',
          resolved_title: 'Palace A',
          resolved_subject: null,
          primary_chapter: null,
          chapters: [],
        }],
      }],
    } as never)
    const { onSaveConfig } = renderDialog()

    fireEvent.click((await screen.findAllByRole('button', { name: '选择宫殿' }))[0])
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择宫殿Palace A' }))
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }))

    expect(onSaveConfig).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    fireEvent.click(await screen.findByRole('button', { name: '保留，继续这一轮' }))
    expect(onSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
      streams: expect.objectContaining({
        memory_palace: expect.objectContaining({ specific_palace_ids: [11] }),
        quiz: expect.objectContaining({ specific_palace_ids: [11] }),
      }),
    }), 'keep-overlap')
  })

  it('keeps quiz scope and order separate from palace scope, and drops the fixed order selects', async () => {
    renderDialog()

    await screen.findByRole('button', { name: '保存配置并重排' })
    expect(screen.getAllByRole('button', { name: '选择宫殿' })).toHaveLength(2)
    expect(screen.getByRole('radiogroup', { name: '刷题出题顺序' })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: '排序' })).toBeNull()
    expect(screen.queryByText('排序与新学')).toBeNull()
  })

  it('limits the quiz palace picker to the round palaces only', async () => {
    vi.mocked(getPalacesGroupedApi).mockResolvedValue({
      subjects: [
        {
          subject: { id: 1, name: '教育学', color: null },
          chapter_groups: [],
          ungrouped_palaces: [{ id: 11, title: 'Palace A', resolved_title: 'Palace A', chapters: [] }],
        },
        {
          subject: { id: 2, name: '英语', color: null },
          chapter_groups: [],
          ungrouped_palaces: [{ id: 22, title: 'English', resolved_title: 'English', chapters: [] }],
        },
      ],
    } as never)
    renderDialog()

    const [palaceButton] = await screen.findAllByRole('button', { name: '选择宫殿' })
    fireEvent.click(palaceButton)
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择宫殿Palace A' }))
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }))

    fireEvent.click((await screen.findAllByRole('button', { name: '选择宫殿' }))[1])
    expect(await screen.findByRole('checkbox', { name: '选择宫殿Palace A' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: '选择宫殿English' })).toBeNull()
  })

  it('summarizes what the round will produce', async () => {
    renderDialog()

    const summary = await screen.findByTestId('freestyle-config-summary')
    expect(within(summary).getByText('记忆宫殿 + 刷题（按比例穿插）')).toBeTruthy()
    expect(within(summary).getByText('先学没学过的单元，再复习到期单元；宫殿内按知识结构顺序出现')).toBeTruthy()
  })

  it('lets the user pick subjects from chips instead of an English training mode', async () => {
    vi.mocked(getPalacesGroupedApi).mockResolvedValue({
      subjects: [
        {
          subject: { id: 1, name: '教育学', color: null },
          chapter_groups: [],
          ungrouped_palaces: [{ id: 11, title: 'Palace A', resolved_title: 'Palace A', chapters: [] }],
        },
        {
          subject: { id: 2, name: '英语', color: null },
          chapter_groups: [],
          ungrouped_palaces: [{ id: 22, title: 'English', resolved_title: 'English', chapters: [] }],
        },
      ],
    } as never)
    const { onSaveConfig } = renderDialog()

    const [palaceSubjectGroup] = await screen.findAllByRole('group', { name: '学科' })
    fireEvent.click(await within(palaceSubjectGroup).findByRole('button', { name: '英语' }))
    fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    fireEvent.click(await screen.findByRole('button', { name: '保留，继续这一轮' }))

    expect(onSaveConfig.mock.calls[0][0]).toMatchObject({
      streams: {
        memory_palace: { subject_ids: [2], specific_palace_ids: [] },
        quiz: { subject_ids: [2], specific_palace_ids: [] },
      },
    })
    expect(onSaveConfig.mock.calls[0][0].training_mode).not.toBe('english')
    expect(onSaveConfig.mock.calls[0][0].mixed_modes).not.toContain('english')
  })
})
