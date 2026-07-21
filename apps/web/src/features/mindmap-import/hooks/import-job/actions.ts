import { logAiCall } from '@/shared/logs/model/appLogs'
import type { AiRuntimeOptions } from '@/shared/api/contracts'
import {
  createBatchImportJobApi,
  createImageImportJobApi,
  createPdfImportJobApi,
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
            ? `已完成；${job.mode === 'mindmap' ? '知识点已生成' : `文字 ${job.result?.extracted_text?.length || 0} 字`}`
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
    let aiOptions: AiRuntimeOptions | undefined
    let visionAiOptions: AiRuntimeOptions | undefined
    let formatterAiOptions: AiRuntimeOptions | undefined
    if (options.mode === 'mindmap') {
      const visionScenarioKey = hasStructureImage
        ? 'vision_structure_mindmap'
        : 'vision_batch_mindmap'
      const configs = await options.promptForScenarioAiOptions({
        title: '图片转脑图配置',
        description:
          '主路径：通用 VL 直接出脑图。回退路径：OCR 模型逐页识别后，再用格式整理模型组树。下方两套提示词互不串台，默认勾选的是各场景自己的推荐块。',
        entries: [
          {
            scenarioKey: visionScenarioKey,
            entrypointKey: hasStructureImage
              ? 'import-image-structure-mindmap'
              : 'import-image-batch-mindmap',
            label: '视觉模型',
            description: '主路径：几乎总会调用。请选通用 VL；若选 OCR 角色模型会跳过直出。',
            pathRole: 'primary',
            contextOptions: options.contextOptions,
          },
          {
            scenarioKey: 'mindmap_ocr_formatter',
            entrypointKey: 'import-image-mindmap-formatter',
            label: '格式整理模型',
            description: '回退路径：仅在 OCR 回退或用户主动重整时调用。',
            pathRole: 'fallback',
            collapsedByDefault: true,
          },
        ],
      })
      if (!configs) {
        options.setBatchStatus('ready')
        return
      }
      visionAiOptions = configs[visionScenarioKey]
      formatterAiOptions = configs.mindmap_ocr_formatter
    } else {
      aiOptions = await options.promptForAiOptions({
        scenarioKey: 'vision_image_text',
        entrypointKey: 'import-image-batch-text',
        title: '图片转文字配置',
        contextOptions: options.contextOptions,
      })
      if (!aiOptions) {
        options.setBatchStatus('ready')
        return
      }
    }    const feature = describeImportFeature('image-batch', options.mode)
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
          mode: options.mode,
          ai_options: aiOptions,
          vision_ai_options: visionAiOptions,
          formatter_ai_options: formatterAiOptions,
        },
      )
      state.hydrateJobResult(job, { reused: job.status === 'completed', preservePreviewUrl: true })
      logAiCall({
        feature,
        stage: job.status === 'completed' ? 'success' : 'queued',
        requestSummary,
        responseSummary:
          job.status === 'completed' ? '已完成；知识点已生成' : '任务已创建，等待执行',
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

  const handlePdfImportStart = async (documentId: string, pageSelection: string) => {
    if (!options.entityKey) {
      state.setImportError('当前页面还没有稳固的实体标识，暂时无法创建可恢复任务。')
      return
    }
    if (!documentId) {
      state.setImportError('请先选择一份 PDF 资料。')
      return
    }
    let aiOptions: AiRuntimeOptions | undefined
    let visionAiOptions: AiRuntimeOptions | undefined
    let formatterAiOptions: AiRuntimeOptions | undefined
    if (options.mode === 'mindmap') {
      const configs = await options.promptForScenarioAiOptions({
        title: 'PDF 转脑图配置',
        description:
          '主路径：通用 VL 直接读页生成脑图。回退路径：逐页 OCR 后再用格式整理模型组树。两套场景各自只显示本场景提示词块；默认全勾 = 该场景推荐组合，不是全库混选。',
        entries: [
          {
            scenarioKey: 'vision_batch_mindmap',
            entrypointKey: 'import-pdf-mindmap',
            label: '视觉模型',
            description: '主路径：几乎总会调用。请优先通用 VL（如 qwen3-vl-flash），不要默认用 OCR 模型。',
            pathRole: 'primary',
            contextOptions: options.contextOptions,
          },
          {
            scenarioKey: 'mindmap_ocr_formatter',
            entrypointKey: 'import-pdf-mindmap-formatter',
            label: '格式整理模型',
            description: '回退路径：仅在 OCR 回退或用户主动重整时调用。',
            pathRole: 'fallback',
            collapsedByDefault: true,
          },
        ],
      })
      if (!configs) return
      visionAiOptions = configs.vision_batch_mindmap
      formatterAiOptions = configs.mindmap_ocr_formatter
    } else {
      aiOptions = await options.promptForAiOptions({
        scenarioKey: 'vision_image_text',
        entrypointKey: 'import-pdf-text',
        title: 'PDF 转文字配置',
        contextOptions: options.contextOptions,
      })
      if (!aiOptions) return
    }
    resetSharedRequestState()
    try {
      const job = await createPdfImportJobApi({
        entityKey: options.entityKey,
        documentId,
        pageSelection,
        mode: options.mode,
        ai_options: aiOptions,
        vision_ai_options: visionAiOptions,
        formatter_ai_options: formatterAiOptions,
      })
      state.hydrateJobResult(job, { reused: job.status === 'completed' })
      await runtime.refreshHistoryJobs(job.id)
      if (job.status !== 'completed') await runtime.resumeJob(job.id)
    } catch (nextError) {
      state.setImportLoading(false)
      state.setImportError(
        formatMindMapImportError(nextError instanceof Error ? nextError.message : 'PDF 识别失败。'),
      )
    }
  }

  return {
    handleImportImage,
    handleBatchImportStart,
    handlePdfImportStart,
  }
}


