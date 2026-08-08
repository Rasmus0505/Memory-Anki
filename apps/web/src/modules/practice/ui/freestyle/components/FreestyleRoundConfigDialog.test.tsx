import { act, fireEvent, render, screen } from '@testing-library/react'
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
  queue_length: 50,
  specific_palace_ids: [],
  question_type: 'all',
  weak_quiz_priority: true,
  seed: 17,
} as unknown as FreestyleFeedConfig

function renderDialog(onSaveConfig = vi.fn()) {
  render(
    <FreestyleRoundConfigDialog
      open
      config={config}
      onOpenChange={vi.fn()}
      onSaveConfig={onSaveConfig}
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

    await screen.findByText('快捷预设')
    fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    expect(onSaveConfig).toHaveBeenCalledTimes(1)
  })

  it('applies a quick preset into the saved config', async () => {
    const { onSaveConfig } = renderDialog()

    await screen.findByRole('button', { name: /^刷题/ })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^刷题/ }))
      await Promise.resolve()
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    })
    expect(onSaveConfig.mock.calls[0][0]).toMatchObject({
      mix_mode: 'quiz_only',
      content: { mindmap_branch: false, anki_card: false, quiz_question: true },
    })
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

    expect(onSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
      streams: expect.objectContaining({
        memory_palace: expect.objectContaining({ specific_palace_ids: [11] }),
      }),
    }))
  })
})
