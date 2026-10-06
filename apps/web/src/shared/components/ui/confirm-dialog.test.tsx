import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog'

describe('ConfirmDialog', () => {
  it('confirms with Enter and still cancels from the cancel button', () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="移入回收站"
        confirmText="移入回收站"
        onConfirm={onConfirm}
      />,
    )

    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
