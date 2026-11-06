// Must be imported before the widget: this module registers the `vi.mock` calls
// for the widget's API dependencies, and an ESM import list is evaluated in
// source order, so importing the widget first would bind the real modules.
import {
  deletePalaceQuizQuestionApiMock,
  getPalaceQuizQuestionsApiMock,
  getPalaceQuizQuestionsByIdsApiMock,
  primeQuestionMocks,
  recordPalaceQuizChoiceAttemptApiMock,
  sampleQuestion,
  secondQuestion,
} from './NodeBoundQuizDialog.harness'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQuizSessionProgress, saveQuizAnswerMode } from '@/modules/quiz/public'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { NodeBoundQuizDialog } from '@/widgets/node-bound-quiz'

describe('NodeBoundQuizDialog · move to trash', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearQuizSessionProgress()
    resetClientPreferenceCacheForTest()
    saveQuizAnswerMode('choice')
    vi.clearAllMocks()
    primeQuestionMocks()
  })

  afterEach(() => {
    saveQuizAnswerMode('choice')
  })

  describe('move to trash', () => {
    it('removes the question from the queue after confirming', async () => {
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
      expect(screen.getByText('已答 0 / 2')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))

      await vi.waitFor(() => {
        expect(deletePalaceQuizQuestionApiMock).toHaveBeenCalledWith(42)
        expect(screen.getByText('第二道关联题目')).toBeTruthy()
      })
      expect(screen.queryByText('下列哪一项是细胞膜的主要成分？')).toBeNull()
      expect(toastMock.toast.success).toHaveBeenCalledWith('题目已移入回收站。')
    })

    it('keeps the question and reports when the delete fails', async () => {
      const toastMock = await import('@/shared/feedback/toast')
      deletePalaceQuizQuestionApiMock.mockRejectedValue(new Error('网络错误。'))
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42]}
          onQuestionCompleted={() => {}}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))

      await vi.waitFor(() => {
        expect(toastMock.toast.error).toHaveBeenCalledWith('网络错误。')
      })
      expect(screen.getByText('下列哪一项是细胞膜的主要成分？')).toBeTruthy()
    })

    it('removes a question the server already deleted without an error toast', async () => {
      const toastMock = await import('@/shared/feedback/toast')
      const onQuestionDeleted = vi.fn()
      deletePalaceQuizQuestionApiMock.mockRejectedValue(new Error('题目不存在。'))
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42, 43]}
          onQuestionCompleted={() => {}}
          onQuestionDeleted={onQuestionDeleted}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))

      await vi.waitFor(() => {
        expect(screen.getByText('第二道关联题目')).toBeTruthy()
        expect(screen.queryByText('下列哪一项是细胞膜的主要成分？')).toBeNull()
      })
      expect(toastMock.toast.error).not.toHaveBeenCalled()
      expect(toastMock.toast.success).toHaveBeenCalledWith('题目已移入回收站。')
      expect(onQuestionDeleted).toHaveBeenCalledWith(42)
    })

    it('does not restore a deleted question from a stale palace question list', async () => {
      const view = render(
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
      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
      await vi.waitFor(() => {
        expect(screen.queryByText('下列哪一项是细胞膜的主要成分？')).toBeNull()
      })

      getPalaceQuizQuestionsByIdsApiMock.mockResolvedValue({
        items: [secondQuestion],
        item_count: 1,
      })
      getPalaceQuizQuestionsApiMock.mockResolvedValue({
        items: [sampleQuestion, secondQuestion],
      })
      view.rerender(
        <NodeBoundQuizDialog
          open={false}
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42, 43]}
          onQuestionCompleted={() => {}}
        />,
      )
      view.rerender(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42, 43]}
          onQuestionCompleted={() => {}}
        />,
      )

      await vi.waitFor(() => {
        expect(screen.getByText('第二道关联题目')).toBeTruthy()
      })
      expect(screen.queryByText('下列哪一项是细胞膜的主要成分？')).toBeNull()
    })

    it('does not toast when an in-flight attempt learns the question was deleted', async () => {
      const toastMock = await import('@/shared/feedback/toast')
      let rejectAttempt: (error: Error) => void = () => {}
      recordPalaceQuizChoiceAttemptApiMock.mockImplementation(
        () => new Promise((_resolve, reject) => {
          rejectAttempt = reject
        }),
      )
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
      fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
      await vi.waitFor(() => {
        expect(screen.queryByText('下列哪一项是细胞膜的主要成分？')).toBeNull()
      })
      rejectAttempt(new Error('题目不存在。'))
      await vi.waitFor(() => {
        expect(deletePalaceQuizQuestionApiMock).toHaveBeenCalledWith(42)
      })
      expect(toastMock.toast.error).not.toHaveBeenCalled()
    })

    it('closes the dialog when the last question is deleted', async () => {
      const onOpenChange = vi.fn()
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={onOpenChange}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42]}
          onQuestionCompleted={() => {}}
        />,
      )

      await screen.findByText('下列哪一项是细胞膜的主要成分？')
      fireEvent.click(screen.getByRole('button', { name: '删除本题' }))
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))

      await vi.waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
    })

    it('scales the question body with ctrl+wheel and leaves the type badge alone', async () => {
      render(
        <NodeBoundQuizDialog
          open
          onOpenChange={() => {}}
          palaceId={1}
          nodeUid="node-1"
          questionIds={[42]}
          onQuestionCompleted={() => {}}
        />,
      )

      const stem = await screen.findByText('下列哪一项是细胞膜的主要成分？')
      const body = screen.getByTestId('quiz-font-scale-body')
      expect(body.contains(stem)).toBe(true)
      expect(body.contains(screen.getByText('选择题'))).toBe(false)
      const zoomIn = new WheelEvent('wheel', {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      act(() => {
        stem.dispatchEvent(zoomIn)
      })
      expect(zoomIn.defaultPrevented).toBe(true)
      expect(body.style.zoom).toBe('110%')
      expect(screen.getByTestId('quiz-font-scale-hint').textContent).toBe('110%')
    })
  })
})
