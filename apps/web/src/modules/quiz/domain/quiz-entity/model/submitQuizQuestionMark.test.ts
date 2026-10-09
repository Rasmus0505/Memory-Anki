import { describe, expect, it, vi } from 'vitest'
import { setPalaceQuizQuestionMarkedApi } from '@/modules/quiz/domain/quiz-entity/api'
import {
  beginQuizQuestionMarkRequest,
  commitQuizQuestionMark,
} from './submitQuizQuestionMark'

vi.mock('@/modules/quiz/domain/quiz-entity/api', () => ({
  setPalaceQuizQuestionMarkedApi: vi.fn(),
}))

const setMarked = vi.mocked(setPalaceQuizQuestionMarkedApi)

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('commitQuizQuestionMark', () => {
  it('paints the mark before the save returns', async () => {
    const pending = deferred<{ item: { id: number; marked: boolean } }>()
    setMarked.mockReturnValue(pending.promise as ReturnType<typeof setPalaceQuizQuestionMarkedApi>)
    const apply = vi.fn()
    const token = beginQuizQuestionMarkRequest(41)
    const work = commitQuizQuestionMark({
      questionId: 41,
      marked: true,
      previousMarked: false,
      token,
      apply,
    })

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(true)
    pending.resolve({ item: { id: 41, marked: true } })
    await work
    expect(apply).toHaveBeenLastCalledWith(true, { id: 41, marked: true })
  })

  it('keeps the painted mark when storage is busy', async () => {
    setMarked.mockRejectedValue(Object.assign(new Error('busy'), { status: 503 }))
    const apply = vi.fn()
    const token = beginQuizQuestionMarkRequest(42)
    await commitQuizQuestionMark({
      questionId: 42,
      marked: true,
      previousMarked: false,
      token,
      apply,
    })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(true)
  })

  it('restores the previous mark when the save fails for another reason', async () => {
    setMarked.mockRejectedValue(new Error('保存标记失败'))
    const apply = vi.fn()
    const token = beginQuizQuestionMarkRequest(43)
    await expect(commitQuizQuestionMark({
      questionId: 43,
      marked: true,
      previousMarked: false,
      token,
      apply,
    })).rejects.toThrow('保存标记失败')
    expect(apply).toHaveBeenNthCalledWith(1, true)
    expect(apply).toHaveBeenNthCalledWith(2, false)
  })

  it('ignores a save that finished after a newer toggle', async () => {
    const pending = deferred<{ item: { id: number; marked: boolean } }>()
    setMarked.mockReturnValue(pending.promise as ReturnType<typeof setPalaceQuizQuestionMarkedApi>)
    const apply = vi.fn()
    const token = beginQuizQuestionMarkRequest(44)
    beginQuizQuestionMarkRequest(44)
    const work = commitQuizQuestionMark({
      questionId: 44,
      marked: true,
      previousMarked: false,
      token,
      apply,
    })
    pending.resolve({ item: { id: 44, marked: true } })
    await work
    expect(apply).toHaveBeenCalledTimes(1)
  })
})
