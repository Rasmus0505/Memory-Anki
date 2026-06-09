import { logAiCall } from '@/shared/logs/model/appLogs'
import {
  createBatchImportJobApi,
  createImageImportJobApi,
  createPdfImportJobApi,
} from '@/shared/api/modules/palaces'
import { formatMindMapImportError } from '@/features/palace-edit/model/mindmap-import'
import {
  describeImportFeature,
  fileToDataUrl,
  logImportFailure,
  summarizePdfRequest,
} from '@/features/palace-edit/hooks/mindmap-import-utils'
import type { UseImportJobControllerOptions } from '@/features/palace-edit/hooks/import-job/types'
import type { ImportJobRuntimeController } from '@/features/palace-edit/hooks/import-job/useImportJobRuntime'
import type { ImportJobStateController } from '@/features/palace-edit/hooks/import-job/useImportJobState'

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
    state.setImportPdfOcrGroundingUsed(null)
    state.setImportPdfOcrTextChars(null)
    state.setImportReusedExistingResult(false)
    state.resetStreamState()
  }

  const handleImportImage = async (file: File) => {
    if (!options.entityKey) {
      state.setImportError(
        '褰撳墠椤甸潰杩樻病鏈夌ǔ瀹氱殑瀹炰綋鏍囪瘑锛屾殏鏃舵棤娉曞垱寤哄彲鎭㈠浠诲姟銆?',
      )
      return
    }
    resetSharedRequestState()
    options.setBatchStatus('idle')
    options.setLastBatchMeta(null)
    const previewUrl = await fileToDataUrl(file)
    state.setImportImagePreviewUrl(previewUrl)
    const feature = describeImportFeature('image-single', options.mode)
    const requestSummary = `鏂囦欢锛?{file.name}锛涙ā寮忥細${options.mode === 'mindmap' ? '杞剳鍥?' : '杞枃瀛?'}`

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
      })
      state.hydrateJobResult(job, { reused: job.status === 'completed', preservePreviewUrl: true })
      logAiCall({
        feature,
        stage: job.status === 'completed' ? 'success' : 'queued',
        requestSummary,
        responseSummary:
          job.status === 'completed'
            ? `宸插畬鎴愶紱${job.mode === 'mindmap' ? '鑺傜偣宸茬敓鎴?' : `鏂囧瓧 ${job.result?.extracted_text?.length || 0} 瀛梎`}`
            : '浠诲姟宸插垱寤猴紝绛夊緟鎵ц',
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
          nextError instanceof Error ? nextError.message : '缃戠粶寮傚父锛岃妫€鏌ョ綉缁滃悗閲嶈瘯銆?',
        ),
      )
    }
  }

  const handleBatchImportStart = async (structureImageId: string | null) => {
    if (!options.entityKey) {
      state.setImportError(
        '褰撳墠椤甸潰杩樻病鏈夌ǔ瀹氱殑瀹炰綋鏍囪瘑锛屾殏鏃舵棤娉曞垱寤哄彲鎭㈠浠诲姟銆?',
      )
      return
    }
    if (options.batchImagesRef.current.length === 0) {
      state.setImportError('璇峰厛涓婁紶鑷冲皯涓€寮犲浘鐗囥€?')
      options.setBatchStatus('error')
      return
    }
    const activeStructureId = structureImageId || options.batchImagesRef.current[0]?.id || null
    const resolvedStructureIndex = Math.max(
      0,
      options.batchImagesRef.current.findIndex((item) => item.id === activeStructureId),
    )
    options.setBatchStatus('loading')
    state.setImportError('')
    state.setImportReusedExistingResult(false)
    const feature = describeImportFeature('image-batch', 'mindmap')
    const requestSummary = `鍏?${options.batchImagesRef.current.length} 寮狅紱缁撴瀯鍥惧簭鍙凤細${resolvedStructureIndex + 1}`

    try {
      logAiCall({
        feature,
        stage: 'start',
        requestSummary,
        meta: {
          entityKey: options.entityKey,
          imageCount: options.batchImagesRef.current.length,
          structureImageIndex: resolvedStructureIndex,
        },
      })
      const job = await createBatchImportJobApi(
        options.batchImagesRef.current.map((item) => item.file),
        {
          entityKey: options.entityKey,
          structureImageIndex: resolvedStructureIndex,
        },
      )
      state.hydrateJobResult(job, { reused: job.status === 'completed', preservePreviewUrl: true })
      logAiCall({
        feature,
        stage: job.status === 'completed' ? 'success' : 'queued',
        requestSummary,
        responseSummary:
          job.status === 'completed' ? '宸插畬鎴愶紱鑺傜偣宸茬敓鎴?' : '浠诲姟宸插垱寤猴紝绛夊緟鎵ц',
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
          structureImageIndex: resolvedStructureIndex,
        },
      })
      state.setImportError(
        formatMindMapImportError(
          nextError instanceof Error ? nextError.message : '缃戠粶寮傚父锛岃妫€鏌ョ綉缁滃悗閲嶈瘯銆?',
        ),
      )
    }
  }

  const handlePdfImportStart = async () => {
    if (!options.entityKey) {
      state.setImportError(
        '褰撳墠椤甸潰杩樻病鏈夌ǔ瀹氱殑瀹炰綋鏍囪瘑锛屾殏鏃舵棤娉曞垱寤哄彲鎭㈠浠诲姟銆?',
      )
      return
    }
    if (!options.selectedSubjectDocumentId) {
      state.setImportError('璇峰厛閫夋嫨涓€浠藉绉?PDF 璧勬枡銆?')
      return
    }
    if (options.selectedPdfPages.length === 0) {
      state.setImportError('璇峰厛閫夋嫨鑷冲皯涓€椤?PDF銆?')
      return
    }

    resetSharedRequestState()

    const selectedDocument =
      options.subjectDocuments.find((item) => item.id === options.selectedSubjectDocumentId) ?? null
    const previewPage =
      options.pdfPageMeta.find((page) => page.page_number === options.structurePage) ??
      options.pdfPageMeta.find((page) => options.selectedPdfPages.includes(page.page_number)) ??
      options.pdfPageMeta[0]
    const previewUrl = previewPage?.preview_url || previewPage?.thumbnail_url || ''
    state.setImportImagePreviewUrl(previewUrl)
    const feature = describeImportFeature('subject-pdf', options.mode)
    const requestSummary = summarizePdfRequest({
      pages: options.selectedPdfPages,
      rangePrompt: options.rangePrompt.trim(),
      pdfMode: options.pdfImportMode,
      structurePage: options.structurePage,
    })

    try {
      logAiCall({
        feature,
        stage: 'start',
        requestSummary,
        meta: {
          entityKey: options.entityKey,
          subjectDocumentId: options.selectedSubjectDocumentId,
          pdfMode: options.pdfImportMode,
          selectedPages: options.selectedPdfPages,
          structurePage: options.pdfImportMode === 'structured_merge' ? options.structurePage : null,
        },
      })
      const job = await createPdfImportJobApi({
        entity_key: options.entityKey,
        mode: options.mode,
        subject_document_id: options.selectedSubjectDocumentId,
        page_selection: options.selectedPdfPages,
        pdf_mode: options.pdfImportMode,
        structure_page: options.pdfImportMode === 'structured_merge' ? options.structurePage : null,
        range_prompt: options.rangePrompt.trim(),
        fallback_title: selectedDocument?.original_name || '鏈懡鍚嶅娈?',
        import_options: options.pdfImportOptions,
      })
      state.hydrateJobResult(job, { reused: job.status === 'completed', preservePreviewUrl: true })
      logAiCall({
        feature,
        stage: job.status === 'completed' ? 'success' : 'queued',
        requestSummary,
        responseSummary:
          job.status === 'completed' ? '宸插畬鎴愶紱鑺傜偣宸茬敓鎴?' : '浠诲姟宸插垱寤猴紝绛夊緟鎵ц',
        jobId: job.id,
        meta: {
          entityKey: options.entityKey,
          status: job.status,
          pdfMode: options.pdfImportMode,
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
      state.clearCurrentJobState()
      logImportFailure({
        entityKey: options.entityKey,
        feature,
        requestSummary,
        error: nextError,
        meta: {
          subjectDocumentId: options.selectedSubjectDocumentId,
          pdfMode: options.pdfImportMode,
          selectedPages: options.selectedPdfPages,
          structurePage:
            options.pdfImportMode === 'structured_merge' ? options.structurePage : null,
        },
      })
      state.setImportError(
        formatMindMapImportError(
          nextError instanceof Error ? nextError.message : '缃戠粶寮傚父锛岃妫€鏌ョ綉缁滃悗閲嶈瘯銆?',
        ),
      )
    }
  }

  return {
    handleImportImage,
    handleBatchImportStart,
    handlePdfImportStart,
  }
}
