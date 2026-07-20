import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReviewScheduleSummary } from '@/shared/api/contracts'
import {
  getReviewSessionApi,
  getReviewSessionCompletionSummaryApi,
  getReviewSessionProgressApi,
  saveReviewSessionProgressApi,
  submitReviewSessionApi,
} from '@/features/review/api'
import { ReviewSessionContainer, type ReviewSessionContainerSession } from '@/widgets/mindmap-review-flow'
import { buildReviewOverviewPath } from '@/entities/review'

export function toContainerSession(session: ReviewScheduleSummary): ReviewSessionContainerSession {
  return {
    id: session.id,
    palace_id: session.palace_id,
    algorithm_used: 'FSRS',
    review_type: 'fsrs',
    review_number: 0,
    palace: session.palace,
    frozen_due_node_uids: session.frozen_due_node_uids ?? [],
    due_node_count: session.due_node_count,
    memory_summary: session.memory_summary,
    review_entry_mode: session.review_entry_mode ?? null,
    review_entry_label: session.review_entry_label ?? null,
    primary_branch_uid: session.primary_branch_uid ?? null,
    primary_branch_title: session.primary_branch_title ?? null,
  }
}

export function buildReviewTitle(session: ReviewSessionContainerSession) {
  const palaceTitle = session.palace?.title || '未命名宫殿'
  if (session.review_entry_mode === 'node' && session.primary_branch_title) {
    return `${palaceTitle} · ${session.primary_branch_title}`
  }
  return palaceTitle
}

export function buildReviewEyebrow(session: ReviewSessionContainerSession) {
  if (session.review_entry_mode === 'node') {
    return session.review_entry_label?.trim() || '节点复习'
  }
  return session.review_entry_label?.trim() || '正式复习'
}

function asEditorDoc(value: unknown): string | Record<string, unknown> | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') return value as Record<string, unknown>
  return null
}

/**
 * Flip-card view always uses the full palace map.
 * Node mode only changes entry labeling / frozen due scope: non-due cards auto-reveal via
 * focusNodeIds; due cards stay as manual flip targets. Do not clip to primary_branch_uid —
 * other branches must remain visible context.
 */
export function buildReviewEditorState(session: ReviewSessionContainerSession) {
  return {
    editor_doc: asEditorDoc(session.palace?.editor_doc ?? null),
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
  }
}

/** Full palace tree for subtree rating cascade (same document as flip-card view). */
export function buildRatingTreeEditorState(session: ReviewSessionContainerSession) {
  return {
    editor_doc: asEditorDoc(session.palace?.editor_doc ?? null),
    editor_config: {},
    editor_local_config: {},
    lang: 'zh' as const,
  }
}

export default function ReviewSession() {
  const navigate = useNavigate()
  const loadReviewSession = useCallback(async (sessionId: string | number) => {
    try {
      const response = await getReviewSessionApi(sessionId)
      if (String(response.id) !== String(sessionId)) navigate(`/review/session/${response.id}`, { replace: true })
      return toContainerSession(response)
    } catch (error) {
      if ((error as { status?: number }).status === 404) navigate(buildReviewOverviewPath(), { replace: true })
      throw error
    }
  }, [navigate])
  return (
    <ReviewSessionContainer
      eyebrow={buildReviewEyebrow}
      buildTitle={buildReviewTitle}
      buildReviewEditorState={buildReviewEditorState}
      buildRatingTreeEditorState={buildRatingTreeEditorState}
      loadSession={loadReviewSession}
      loadProgress={getReviewSessionProgressApi}
      saveProgress={saveReviewSessionProgressApi}
      loadCompletionSummary={getReviewSessionCompletionSummaryApi}
      submitSession={submitReviewSessionApi}
      onSubmitted={(result) => navigate(`/review/completed/${result.review_log_id}`, { replace: true })}
      backHref={buildReviewOverviewPath}
    />
  )
}
