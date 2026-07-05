import { useEffect, useRef } from 'react'
import { logAiCall } from '@/shared/logs/model/appLogs'
import type { ImportHistoryItem } from '@/features/mindmap-import/model/mindmap-import'
import { formatMindMapImportError } from '@/features/mindmap-import/model/mindmap-import'
import {
  buildHistoryItemFromJob,
  describeImportFeature,
  getRequestId,
  loadLastJobId,
  persistLastJobId,
  wait,
} from '@/features/mindmap-import/hooks/mindmap-import-utils'
import {
  deleteImportJobApi,
  getImportJobApi,
  listImportJobsApi,
  pauseImportJobApi,
  runImportJobApi,
} from '@/entities/knowledge-import/api'
import type { ImportJobStateController } from '@/features/mindmap-import/hooks/import-job/useImportJobState'
import {
  completeTask,
  failTask,
  registerTask,
  updateTask,
} from '@/shared/background-tasks/backgroundTaskRegistry'
import { appConfirm } from '@/shared/components/ui/native-dialog'

interface UseImportJobRuntimeOptions {
  entityKey: string | null
  state: ImportJobStateController
}

export interface ImportJobRuntimeController {
  refreshHistoryJobs: (preferredActiveJobId?: string | null) => Promise<void>
  startPollingJob: (jobId: string) => void
  stopPollingJob: () => void
  resumeJob: (jobId: string) => Promise<void>
  handleOpenChange: (nextOpen: boolean) => Promise<void>
  handleResumeJob: () => Promise<void>
  handlePauseJob: () => Promise<void>
  handleImportSelectHistory: (item: ImportHistoryItem) => Promise<void>
  handleImportDeleteHistory: (id: string) => Promise<void>
}

export function useImportJobRuntime({
  entityKey,
  state,
}: UseImportJobRuntimeOptions): ImportJobRuntimeController {
  const pollTokenRef = useRef(0)

  useEffect(() => {
    return () => {
      pollTokenRef.current += 1
    }
  }, [])

  const refreshHistoryJobs = async (preferredActiveJobId?: string | null) => {
    if (!entityKey) {
      state.setImportHistory([])
      return
    }
    const result = await listImportJobsApi(entityKey)
    const nextHistory = (result.items || [])
      .map(buildHistoryItemFromJob)
      .filter((item): item is ImportHistoryItem => Boolean(item))
    state.setImportHistory(nextHistory)
    if (preferredActiveJobId && !nextHistory.some((item) => item.id === preferredActiveJobId)) {
      persistLastJobId(entityKey, null)
    }
  }

  const startPollingJob = (jobId: string) => {
    const token = pollTokenRef.current + 1
    pollTokenRef.current = token
    // 登记到全局后台任务栏：切走编辑器后用户也能在顶部看到导入进度。
    registerTask({
      id: `palace-import-${jobId}`,
      section: 'palaces',
      title: '记忆宫殿 · 识别导入中',
      detail: '正在识别思维导图……',
    })
    void (async () => {
      while (pollTokenRef.current === token) {
        try {
          const job = await getImportJobApi(jobId)
          state.hydrateJobResult(job, {
            reused: state.reusedExistingResultRef.current,
            preservePreviewUrl: true,
          })
          // 同步进度到全局任务栏。
          const nodeCount =
            (job.result?.source_tree?.children || []).length +
            (job.result?.extracted_text?.length || 0)
          updateTask(`palace-import-${jobId}`, {
            detail: job.stage
              ? `识别中 · ${job.stage}${nodeCount ? `（已识别 ${nodeCount} 项）` : ''}`
              : undefined,
          })
          if (job.status !== 'running' && !job.pause_requested) {
            if (job.status === 'completed') {
              completeTask(`palace-import-${jobId}`, { detail: '识别完成' })
              logAiCall({
                feature: describeImportFeature(job.source_kind, job.mode),
                stage: 'completed',
                requestSummary: '',
                responseSummary:
                  job.mode === 'mindmap'
                    ? `识别完成；知识点 ${(job.result?.source_tree?.children || []).length}`
                    : `识别完成；文本 ${(job.result?.extracted_text || '').length} 字`,
                jobId: job.id,
                requestId: job.error?.request_id,
                meta: {
                  status: job.status,
                  stage: job.stage,
                  requestId: job.error?.request_id || '',
                  ...(job.error?.details || {}),
                },
              })
            } else if (job.status === 'failed') {
              failTask(
                `palace-import-${jobId}`,
                job.error?.message || '识别失败',
              )
              logAiCall({
                feature: describeImportFeature(job.source_kind, job.mode),
                stage: 'failure',
                errorMessage: job.error?.message || '识别失败，请稍后重试。',
                jobId: job.id,
                requestId: job.error?.request_id,
                meta: {
                  status: job.status,
                  stage: job.stage,
                  code: job.error?.code || '',
                  requestId: job.error?.request_id || '',
                  ...(job.error?.details || {}),
                },
              })
            }
            await refreshHistoryJobs(job.id)
            return
          }
          await wait(1200)
        } catch (nextError) {
          if (pollTokenRef.current !== token) return
          failTask(
            `palace-import-${jobId}`,
            nextError instanceof Error ? nextError.message : '轮询导入任务失败。',
          )
          state.setImportLoading(false)
          const requestId = getRequestId(nextError)
          state.setImportError(
            formatMindMapImportError(
              nextError instanceof Error ? nextError.message : '轮询导入任务失败。',
            ),
          )
          logAiCall({
            feature: '导入任务轮询',
            stage: 'failure',
            requestSummary: `jobId=${jobId}`,
            errorMessage: nextError instanceof Error ? nextError.message : '轮询导入任务失败。',
            jobId,
            requestId,
            meta: {
              entityKey,
              requestId,
            },
          })
          return
        }
      }
    })()
  }

  const stopPollingJob = () => {
    pollTokenRef.current += 1
  }

  const resumeJob = async (jobId: string) => {
    const job = await runImportJobApi(jobId)
    state.hydrateJobResult(job, { preservePreviewUrl: true })
    await refreshHistoryJobs(job.id)
    startPollingJob(job.id)
  }

  const handleOpenChange = async (nextOpen: boolean) => {
    state.setImportOpenState(nextOpen)
    if (!nextOpen) {
      stopPollingJob()
      return
    }
    if (!entityKey) return
    try {
      const result = await listImportJobsApi(entityKey)
      const nextHistory = (result.items || [])
        .map(buildHistoryItemFromJob)
        .filter((item): item is ImportHistoryItem => Boolean(item))
      state.setImportHistory(nextHistory)
      const preferredJobId = loadLastJobId(entityKey)
      const targetJob =
        (preferredJobId ? result.items.find((item) => item.id === preferredJobId) : null) ||
        result.items[0] ||
        null
      if (targetJob) {
        state.hydrateJobResult(targetJob)
        if (targetJob.status === 'running' || targetJob.pause_requested) {
          startPollingJob(targetJob.id)
        }
      }
    } catch (nextError) {
      state.setImportError(
        formatMindMapImportError(
          nextError instanceof Error ? nextError.message : '加载导入任务失败。',
        ),
      )
    }
  }

  const handleResumeJob = async () => {
    if (!state.currentJobId) return
    try {
      await resumeJob(state.currentJobId)
    } catch (nextError) {
      state.setImportLoading(false)
      state.setImportError(
        formatMindMapImportError(
          nextError instanceof Error ? nextError.message : '继续识别失败。',
        ),
      )
    }
  }

  const handlePauseJob = async () => {
    if (!state.currentJobId) return
    try {
      const job = await pauseImportJobApi(state.currentJobId)
      state.hydrateJobResult(job, { preservePreviewUrl: true })
      if (job.status === 'running' || job.pause_requested) {
        startPollingJob(job.id)
      } else {
        await refreshHistoryJobs(job.id)
      }
    } catch (nextError) {
      state.setImportError(
        formatMindMapImportError(
          nextError instanceof Error ? nextError.message : '暂停识别失败。',
        ),
      )
    }
  }

  const handleImportSelectHistory = async (item: ImportHistoryItem) => {
    if (!item.jobId) return
    try {
      const job = await getImportJobApi(item.jobId)
      state.hydrateJobResult(job)
      if (job.status === 'running' || job.pause_requested) {
        startPollingJob(job.id)
      } else {
        stopPollingJob()
      }
    } catch (nextError) {
      state.setImportError(
        formatMindMapImportError(
          nextError instanceof Error ? nextError.message : '加载导入历史失败。',
        ),
      )
    }
  }

  const handleImportDeleteHistory = async (id: string) => {
    const confirmed = await appConfirm(
      '删除这条导入历史后，将不能从历史中恢复这份草案。确定删除吗？',
      { title: '删除导入历史', tone: 'danger' },
    )
    if (!confirmed) return
    try {
      await deleteImportJobApi(id)
      await refreshHistoryJobs(state.currentJobId)
      if (state.currentJobId === id) {
        stopPollingJob()
        state.clearPreviewState()
      }
    } catch (nextError) {
      state.setImportError(
        formatMindMapImportError(
          nextError instanceof Error ? nextError.message : '删除导入历史失败。',
        ),
      )
    }
  }

  return {
    refreshHistoryJobs,
    startPollingJob,
    stopPollingJob,
    resumeJob,
    handleOpenChange,
    handleResumeJob,
    handlePauseJob,
    handleImportSelectHistory,
    handleImportDeleteHistory,
  }
}


