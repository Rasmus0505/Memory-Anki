import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FREESTYLE_FEED_CONFIG,
  sanitizeFreestyleFeedConfig,
} from '@/modules/practice/domain/feedConfig'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'
import { FreestyleFeedSettingsDialog } from './FreestyleFeedSettingsDialog'

const getPalacesGroupedApiMock = vi.fn()
const getSubjectTreeApiMock = vi.fn()

vi.mock('@/modules/content/public', () => ({
  getPalacesGroupedApi: (...args: unknown[]) => getPalacesGroupedApiMock(...args),
  getSubjectTreeApi: (...args: unknown[]) => getSubjectTreeApiMock(...args),
}))

function buildConfig(overrides: Partial<FreestyleFeedConfig> = {}) {
  return sanitizeFreestyleFeedConfig({
    ...DEFAULT_FREESTYLE_FEED_CONFIG,
    ...overrides,
  })
}

function withMemoryPalaces(ids: number[]) {
  const config = buildConfig({
    training_mode: 'memory_palace',
    mixed_modes: ['memory_palace'],
  })
  return {
    ...config,
    streams: {
      ...config.streams,
      memory_palace: {
        ...config.streams.memory_palace,
        specific_palace_ids: ids,
      },
    },
  }
}

describe('FreestyleFeedSettingsDialog', () => {
  beforeEach(() => {
    getSubjectTreeApiMock.mockReset().mockResolvedValue({ chapters: [], subject: { id: 1, name: 'Subject' } })
    getPalacesGroupedApiMock.mockReset().mockResolvedValue({
      subjects: [{
        subject: { id: 1, name: 'Subject', color: null },
        chapter_groups: [],
        ungrouped_palaces: [
          { id: 11, title: 'Palace A', resolved_title: 'Palace A', resolved_subject: null, primary_chapter: null },
          { id: 22, title: 'Palace B', resolved_title: 'Palace B', resolved_subject: null, primary_chapter: null },
        ],
      }],
    })
  })

  it('shows training direction first and only shows the selected stream fields', async () => {
    render(
      <FreestyleFeedSettingsDialog
        open
        config={withMemoryPalaces([])}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(await screen.findByRole('radiogroup', { name: '训练方向' })).toBeTruthy()
    expect(screen.getByText('宫殿内单元顺序')).toBeTruthy()
    expect(screen.queryByText('题目掌握度')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: /^刷题/ }))
    expect(screen.getByText('题目掌握度')).toBeTruthy()
    expect(screen.queryByText('宫殿内单元顺序')).toBeNull()
  })

  it('keeps palace selection scoped to the stream that opened the picker', async () => {
    const onSave = vi.fn()
    render(
      <FreestyleFeedSettingsDialog
        open
        config={withMemoryPalaces([])}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '选择宫殿' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择宫殿Palace A' }))
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }))
    fireEvent.click(screen.getByRole('button', { name: '保存并重排剩余队列' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      streams: expect.objectContaining({
        memory_palace: expect.objectContaining({ specific_palace_ids: [11] }),
      }),
    }))
  })

  it('turns a mixed configuration into its remaining stream when one is unchecked', async () => {
    const onSave = vi.fn()
    render(
      <FreestyleFeedSettingsDialog
        open
        config={buildConfig({ training_mode: 'mixed', mixed_modes: ['memory_palace', 'quiz'] })}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    )

    expect(await screen.findByText('混合内容')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '刷题' }))
    expect(screen.queryByText('混合内容')).toBeNull()
    expect(screen.getByText('宫殿内单元顺序')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存并重排剩余队列' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      training_mode: 'memory_palace',
      mixed_modes: ['memory_palace'],
    }))
  })

  it('shows only English-palace configuration for English mode', async () => {
    render(
      <FreestyleFeedSettingsDialog
        open
        config={buildConfig({ training_mode: 'english', mixed_modes: ['english'] })}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(await screen.findByText('只从英语学科宫殿生成结构复习卡。')).toBeTruthy()
    expect(screen.queryByText('题目掌握度')).toBeNull()
    expect(screen.getByText('宫殿内单元顺序')).toBeTruthy()
  })
})
