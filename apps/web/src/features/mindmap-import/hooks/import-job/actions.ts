import { logAiCall } from '@/shared/logs/model/appLogs'
import {
  createBatchImportJobApi,
  createImageImportJobApi,
} from '@/entities/knowledge-import/api'
import { formatMindMapImportError } from '@/features/mindmap-import/model/mindmap-import'
import {
  describeImportFeature,
  fileToDataUrl,
  logImportFailure,
} from '@/features/mindmap-import/hooks/mindmap-import-utils'
import type { UseImportJobControllerOptions } from '@/features/mindmap-import/hooks/import-job/types'
import type { ImportJobRuntimeController } from '@/features/mindmap-import/hooks/import-job/useImportJobRuntime'
import type { ImportJobStateController } from '@/features/mindmap-import/hooks/import-job/useImportJobState'

interface BuildImportJobActionsOptions {
  options: UseImportJobControllerOptions
  state: ImportJobStateController
  runtime: ImportJobRuntimeController
}

export function buildImportJobActions({
  options,
  state,
  runtime,
}: BuildImportJobActionsOptions) {
  const resetSharedRequestState = () => {
    state.setImportError('')
    state.setImportWarnings([])
    state.setImportReusedExistingResult(false)
    state.resetStreamState()
  }

  const handleImportImage = async (file: File) => {
    if (!options.entityKey) {
      state.setImportError(
        '当前页面还没有稳固的实体标识，暂时无法创建可恢复任务。',
      )
      return
    }
    resetSharedRequestState()
    options.setBatchStatus('idle')
    options.setLastBatchMeta(null)
    const aiOptions = await options.promptForAiOptions({
      scenarioKey: options.mode === 'mindmap' ? 'vision_image_mindmap' : 'vision_image_text',
      entrypointKey: options.mode === 'mindmap' ? 'import-image-mindmap' : 'import-image-text',
      title: options.mode === 'mindmap' ? '图片转脑图配置' : '图片转文字配置',
    })
    if (!aiOptions) {
      return
    }
    const previewUrl = await fileToDataUrl(file)
    state.setImportImagePreviewUrl(previewUrl)
    const feature = describeImportFeature('image-single', options.mode)
    const requestSummary = `文件：${file.name}；模式：${options.mode === 'mindmap' ? '转脑图' : '转文字'}`

    try {
      logAiCall({
        feature,
        stage: 'start',
        requestSummary,
        meta: {
          entityKey: options.entityKey,
          fileName: file.name,
          mode: options.mode,
        },
      })
      const job = await createImageImportJobApi(file, {
        entityKey: options.entityKey,
        mode: options.mode,
        ai_options: aiOptions,
      })
      state.hydrateJobResult(job, { reused: job.status === 'completed', preservePreviewUrl: true })
      logAiCall({
        feature,
        stage: job.status === 'completed' ? 'success' : 'queued',
        requestSummary,
        responseSummary:
          job.status === 'completed'
            ? `已完成；${job.mode === 'mindmap' ? '节点已生成' : `文字 ${job.result?.extracted_text?.length || 0} 字`}`
            : '任务已创建，等待执行',
        jobId: job.id,
        meta: {
          entityKey: options.entityKey,
          status: job.status,
          requestId: job.error?.request_id || '',
        },
      })
      await runtime.refreshHistoryJobs(job.id)
      if (job.status === 'completed') {
        state.setImportLoading(false)
        return
      }
      await runtime.resumeJob(job.id)
    } catch (nextError) {
      state.setImportLoading(false)
      logImportFailure({
        entityKey: options.entityKey,
        feature,
        requestSummary,
        error: nextError,
        meta: {
          fileName: file.name,
          mode: options.mode,
        },
      })
      state.setImportError(
        formatMindMapImportError(
          nextError instanceof Error ? nextError.message : '网络异常，请检查网络后重试。',
        ),
      )
    }
  }

  const handleBatchImportStart = async (structureImageId: string | null) => {
    if (!options.entityKey) {
      state.setImportError(
        '当前页面还没有稳固的实体标识，暂时无法创建可恢复任务。',
      )
      return
    }
    if (options.batchImagesRef.current.length === 0) {
      state.setImportError('请先上传至少一张图片。')
      options.setBatchStatus('error')
      return
    }
    const resolvedStructureIndex =
      structureImageId != null
        ? options.batchImagesRef.current.findIndex((item) => item.id === structureImageId)
        : -1
    const hasStructureImage = resolvedStructureIndex >= 0
    options.setBatchStatus('loading')
    state.setImportError('')
    state.setImportReusedExistingResult(false)
    const aiOptions = await options.promptForAiOptions({
      scenarioKey: 'vision_batch_mindmap',
      entrypointKey: 'import-image-batch-mindmap',
      title: '多图转脑图配置',
    })
    if (!aiOptions) {
      options.setBatchStatus('ready')
      return
    }
    const feature = describeImportFeature('image-batch', 'mindmap')
    const requestSummary = hasStructureImage
      ? `共 ${options.batchImagesRef.current.length} 张；模式：结构补全；结构图序号：${resolvedStructureIndex + 1}`
      : `共 ${options.batchImagesRef.current.length} 张；模式：直接生成`

    try {
      logAiCall({
        feature,
        stage: 'start',
        requestSummary,
        meta: {
          entityKey: options.entityKey,
          imageCount: options.batchImagesRef.current.length,
          structureImageIndex: hasStructureImage ? resolvedStructureIndex : null,
        },
      })
      const job = await createBatchImportJobApi(
        options.batchImagesRef.current.map((item) => item.file),
        {
          entityKey: options.entityKey,
          structureImageIndex: hasStructureImage ? resolvedStructureIndex : undefined,
          ai_options: aiOptions,
        },
      )
      state.hydrateJobResult(job, { reused: job.status === 'completed', preservePreviewUrl: true })
      logAiCall({
        feature,
        stage: job.status === 'completed' ? 'success' : 'queued',
        requestSummary,
        responseSummary:
          job.status === 'completed' ? '已完成；节点已生成' : '任务已创建，等待执行',
        jobId: job.id,
        meta: {
          entityKey: options.entityKey,
          status: job.status,
          requestId: job.error?.request_id || '',
        },
      })
      await runtime.refreshHistoryJobs(job.id)
      if (job.status === 'completed') {
        options.setBatchStatus('success')
        return
      }
      await runtime.resumeJob(job.id)
    } catch (nextError) {
      options.setBatchStatus('error')
      state.setImportLoading(false)
      logImportFailure({
        entityKey: options.entityKey,
        feature,
        requestSummary,
        error: nextError,
        meta: {
          imageCount: options.batchImagesRef.current.length,
          structureImageIndex: hasStructureImage ? resolvedStructureIndex : null,
        },
      })
      state.setImportError(
        formatMindMapImportError(
          nextError instanceof Error ? nextError.message : '网络异常，请检查网络后重试。',
        ),
      )
    }
  }

  return {
    handleImportImage,
    handleBatchImportStart,
  }
}


