import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestyleSettingsDialog } from './FreestyleSettingsDialog'
import { TodayTrainingSettingsDialog } from './TodayTrainingSettingsDialog'
import { DEFAULT_FREESTYLE_CONFIG } from '@/features/freestyle/model/freestyle'
import { DEFAULT_TODAY_TRAINING_CONFIG } from '@/features/freestyle/model/today-training'

describe('freestyle progress cleanup settings', () => {
  it('exposes progress cleanup in freestyle settings', () => {
    const onClearProgress = vi.fn()
    render(
      <FreestyleSettingsDialog
        open
        config={DEFAULT_FREESTYLE_CONFIG}
        palaceOptions={[]}
        onOpenChange={vi.fn()}
        onConfigChange={vi.fn()}
        onClearProgress={onClearProgress}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '清空当前模式进度' }))
    expect(onClearProgress).toHaveBeenCalledTimes(1)
  })

  it('exposes progress cleanup in today training settings', () => {
    const onClearProgress = vi.fn()
    render(
      <TodayTrainingSettingsDialog
        open
        config={DEFAULT_TODAY_TRAINING_CONFIG}
        onOpenChange={vi.fn()}
        onConfigChange={vi.fn()}
        onClearProgress={onClearProgress}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '清空当前模式进度' }))
    expect(onClearProgress).toHaveBeenCalledTimes(1)
  })
})