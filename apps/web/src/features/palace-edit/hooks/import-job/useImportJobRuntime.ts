import { useEffect, useRef } from 'react'
import { logAiCall } from '@/shared/logs/model/appLogs'
import type { ImportHistoryItem } from '@/features/palace-edit/model/mindmap-import'
import { formatMindMapImportError } from '@/features/palace-edit/model/mindmap-import'
import {
  buildHistoryItemFromJob,
  describeImportFeature,
  getRequestId,
  loadLastJobId,
  normalizePdfImportMode,
  persistLastJobId,
  summarizePdfRequest,
  wait,
} from '@/features/palace-edit/hooks/mindmap-import-utils'
import {
  deleteImportJobApi,
  getImportJobApi,
  listImportJobsApi,
  pauseImportJobApi,
  runImportJobApi,
} from '@/shared/api/modules/palaces'
import type { ImportJobStateController } from '@/features/palace-edit/hooks/import-job/useImportJobState'

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
    void (async () => {
      while (pollTokenRef.current === token) {
        try {
          const job = await getImportJobApi(jobId)
          state.hydrateJobResult(job, {
            reused: state.reusedExistingResultRef.current,
            preservePreviewUrl: true,
          })
          if (job.status !== 'running' && !job.pause_requested) {
            if (job.status === 'completed') {
              logAiCall({
                feature: describeImportFeature(job.source_kind, job.mode),
                stage: 'completed',
                requestSummary:
                  job.source_kind === 'subject-pdf'
                    ? summarizePdfRequest({
                        pages: Array.isArray(job.result?.selected_pages) ? job.result.selected_pages : [],
                        rangePrompt:
                          typeof job.source_meta?.range_prompt === 'string'
                            ? job.source_meta.range_prompt
                            : '',
                        pdfMode: normalizePdfImportMode(job.source_meta?.pdf_mode),
                        structurePage:
                          typeof job.source_meta?.structure_page === 'number'
                            ? job.source_meta.structure_page
                            : null,
                      })
                    : '',
                responseSummary:
                  job.mode === 'mindmap'
                    ? `璇嗗埆瀹屾垚锛涜妭鐐?${(job.result?.source_tree?.children || []).length}`
                    : `璇嗗埆瀹屾垚锛涙枃瀛?${(job.result?.extracted_text || '').length} 瀛梎`,
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
              logAiCall({
                feature: describeImportFeature(job.source_kind, job.mode),
                stage: 'failure',
                errorMessage: job.error?.message || '璇嗗埆澶辫触锛岃绋嶅悗閲嶈瘯銆?',
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
          state.setImportLoading(false)
          const requestId = getRequestId(nextError)
          state.setImportError(
            formatMindMapImportError(
              nextError instanceof Error ? nextError.message : '杞瀵煎叆浠诲姟澶辫触銆?',
            ),
          )
          logAiCall({
            feature: '瀵煎叆浠诲姟杞',
            stage: 'failure',
            requestSummary: `jobId=${jobId}`,
            errorMessage: nextError instanceof Error ? nextError.message : '杞瀵煎叆浠诲姟澶辫触銆?',
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
          nextError instanceof Error ? nextError.message : '鍔犺浇瀵煎叆浠诲姟澶辫触銆?',
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
          nextError instanceof Error ? nextError.message : '缁х画璇嗗埆澶辫触銆?',
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
          nextError instanceof Error ? nextError.message : '鏆傚仠璇嗗埆澶辫触銆?',
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
          nextError instanceof Error ? nextError.message : '鍔犺浇瀵煎叆鍘嗗彶澶辫触銆?',
        ),
      )
    }
  }

  const handleImportDeleteHistory = async (id: string) => {
    const confirmed = window.confirm(
      '鍒犻櫎杩欐潯瀵煎叆鍘嗗彶鍚庯紝灏嗕笉鑳藉啀浠庡巻鍙蹭腑鎭㈠杩欎唤鑽夌銆傜‘瀹氬垹闄ゅ悧锛?',
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
          nextError instanceof Error ? nextError.message : '鍒犻櫎瀵煎叆鍘嗗彶澶辫触銆?',
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
