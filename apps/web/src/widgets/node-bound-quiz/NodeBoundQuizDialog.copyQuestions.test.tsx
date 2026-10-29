// Must be imported before the widget: it registers the `vi.mock` calls for the
// widget's API dependencies, and ESM imports run in source order.
import { primeQuestionMocks } from './NodeBoundQuizDialog.harness'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQuizSessionProgress } from '@/modules/quiz/public'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { NodeBoundQuizDialog } from '@/widgets/node-bound-quiz'

describe('NodeBoundQuizDialog 复制题目', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearQuizSessionProgress()
    resetClientPreferenceCacheForTest()
    vi.clearAllMocks()
    primeQuestionMocks()
  })

  it('copies every question in the window with options, answer and analysis', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const toastMock = await import('@/shared/feedback/toast')
    render(
      <NodeBoundQuizDialog
        open
        onOpenChange={() => {}}
        palaceId={1}
        nodeUid="node-1"
        questionIds={[42, 43]}
        onQuestionCompleted={() => {}}
      />,
    )

    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    fireEvent.click(screen.getByRole('button', { name: '复制题目' }))

    await vi.waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls.at(-1)?.[0]).toBe([
      '1. 下列哪一项是细胞膜的主要成分？',
      '   A. 磷脂',
      '   B. 纤维素',
      '   C. 淀粉',
      '   D. 糖原',
      '   答案：A. 磷脂',
      '   解析：细胞膜主要由磷脂双分子层构成。',
      '',
      '2. 第二道关联题目',
      '   A. 磷脂',
      '   B. 纤维素',
      '   C. 淀粉',
      '   D. 糖原',
      '   答案：A. 磷脂',
      '   解析：细胞膜主要由磷脂双分子层构成。',
    ].join('\n'))
    expect(toastMock.toast.success).toHaveBeenCalledWith('已复制 2 道题，含选项、答案与解析。')
  })
})
