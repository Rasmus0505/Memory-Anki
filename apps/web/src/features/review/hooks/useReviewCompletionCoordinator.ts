import * as React from 'react'
import type { CompleteFlowPayload } from '@/features/review/model/mind-map-review-flow'

export type ReviewCompletionStatus =
  | 'idle'
  | 'preparing'
  | 'awaiting_confirmation'
  | 'submitting'
  | 'failed'
  | 'completed'

interface CompletionDraft {
  payload: CompleteFlowPayload
  operationId: string
}

export type ReviewCompletionState<TTarget, TInput> =
  | { status: 'idle' }
  | { status: 'preparing'; draft: CompletionDraft }
  | { status: 'awaiting_confirmation'; draft: CompletionDraft; target: TTarget }
  | { status: 'submitting'; draft: CompletionDraft; target: TTarget; input: TInput }
  | { status: 'failed'; phase: 'prepare'; draft: CompletionDraft; error: string }
  | { status: 'failed'; phase: 'submit'; draft: CompletionDraft; target: TTarget; input: TInput; error: string }
  | { status: 'completed' }

export interface ReviewCompletionSubmitResult<TResult> {
  result: TResult
  persistTimeRecord?: boolean
}

function createCompletionOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `review-complete-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '完成提交失败，请重试。'
}

export function useReviewCompletionCoordinator<TTarget, TInput, TResult>({
  prepare,
  submit,
  onCompleted,
}: {
  prepare: () => Promise<TTarget>
  submit: (args: {
    target: TTarget
    input: TInput
    payload: CompleteFlowPayload
    operationId: string
  }) => Promise<ReviewCompletionSubmitResult<TResult>>
  onCompleted?: (result: TResult) => void | Promise<void>
}) {
  const [state, setState] = React.useState<ReviewCompletionState<TTarget, TInput>>({ status: 'idle' })
  const stateRef = React.useRef(state)
  const prepareRef = React.useRef(prepare)
  const submitRef = React.useRef(submit)
  const onCompletedRef = React.useRef(onCompleted)

  stateRef.current = state
  const transition = React.useCallback((next: ReviewCompletionState<TTarget, TInput>) => {
    stateRef.current = next
    setState(next)
  }, [])
  prepareRef.current = prepare
  submitRef.current = submit
  onCompletedRef.current = onCompleted

  React.useEffect(() => () => {
    const current = stateRef.current
    if (
      current.status !== 'idle' &&
      current.status !== 'completed' &&
      current.status !== 'submitting'
    ) {
      current.draft.payload.cancel()
    }
    stateRef.current = { status: 'idle' }
  }, [])

  const prepareDraft = React.useCallback(async (draft: CompletionDraft) => {
    transition({ status: 'preparing', draft })
    try {
      const target = await prepareRef.current()
      const current = stateRef.current
      if (current.status !== 'preparing' || current.draft.operationId !== draft.operationId) return
      transition({ status: 'awaiting_confirmation', draft, target })
    } catch (error) {
      const current = stateRef.current
      if (current.status !== 'preparing' || current.draft.operationId !== draft.operationId) return
      transition({ status: 'failed', phase: 'prepare', draft, error: errorMessage(error) })
    }
  }, [transition])

  const requestCompletion = React.useCallback(async (payload: CompleteFlowPayload) => {
    const currentStatus = stateRef.current.status
    if (currentStatus !== 'idle' && currentStatus !== 'completed') return
    const draft = { payload, operationId: createCompletionOperationId() }
    await prepareDraft(draft)
  }, [prepareDraft])

  const retryPreparation = React.useCallback(async () => {
    const current = stateRef.current
    // Allow refresh after bulk-rating while the dialog is still open.
    if (current.status === 'failed' && current.phase === 'prepare') {
      await prepareDraft(current.draft)
      return
    }
    if (current.status === 'awaiting_confirmation') {
      await prepareDraft(current.draft)
    }
  }, [prepareDraft])

  const performSubmission = React.useCallback(async (args: {
    draft: CompletionDraft
    target: TTarget
    input: TInput
  }) => {
    const { draft, target, input } = args
    transition({ status: 'submitting', draft, target, input })

    let submission: ReviewCompletionSubmitResult<TResult>
    try {
      submission = await submitRef.current({
        target,
        input,
        payload: draft.payload,
        operationId: draft.operationId,
      })
    } catch (error) {
      transition({
        status: 'failed',
        phase: 'submit',
        draft,
        target,
        input,
        error: errorMessage(error),
      })
      return
    }

    try {
      await draft.payload.finalize({ persistTimeRecord: submission.persistTimeRecord })
    } catch (error) {
      console.error('Review completion local finalization failed after submit succeeded.', error)
    }
    transition({ status: 'completed' })
    try {
      await onCompletedRef.current?.(submission.result)
    } catch (error) {
      console.error('Review completion callback failed after completion succeeded.', error)
    }
  }, [transition])

  const confirmCompletion = React.useCallback(async (input: TInput) => {
    const current = stateRef.current
    if (current.status !== 'awaiting_confirmation') return
    await performSubmission({ draft: current.draft, target: current.target, input })
  }, [performSubmission])

  const retrySubmission = React.useCallback(async () => {
    const current = stateRef.current
    if (current.status !== 'failed' || current.phase !== 'submit') return
    await performSubmission({ draft: current.draft, target: current.target, input: current.input })
  }, [performSubmission])

  const cancelCompletion = React.useCallback(() => {
    const current = stateRef.current
    if (current.status === 'idle' || current.status === 'completed' || current.status === 'submitting') return
    current.draft.payload.cancel()
    transition({ status: 'idle' })
  }, [transition])

  const target =
    state.status === 'awaiting_confirmation' ||
    state.status === 'submitting' ||
    (state.status === 'failed' && state.phase === 'submit')
      ? state.target
      : null
  const error = state.status === 'failed' ? state.error : null
  const durationSeconds =
    state.status === 'idle' || state.status === 'completed' ? undefined : state.draft.payload.durationSeconds

  return {
    state,
    status: state.status,
    target,
    error,
    durationSeconds,
    open: state.status !== 'idle' && state.status !== 'completed',
    preparing: state.status === 'preparing',
    preparationFailed: state.status === 'failed' && state.phase === 'prepare',
    submissionFailed: state.status === 'failed' && state.phase === 'submit',
    submitting: state.status === 'submitting',
    requestCompletion,
    retryPreparation,
    confirmCompletion,
    retrySubmission,
    cancelCompletion,
  }
}
