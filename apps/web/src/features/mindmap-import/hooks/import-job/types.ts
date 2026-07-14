import type { RefObject } from 'react'
import type {
  AiRuntimeOptions,
  AiScenarioRuntimeOptionsMap,
  MindMapEditorState,
} from '@/shared/api/contracts'
import type {
  BatchImportMeta,
  BatchImportImageItem,
  ImportMode,
  ImportSourceKind,
  MindMapImportWorkflow,
} from '@/features/mindmap-import/model/mindmap-import-types'
import type { AiGenerationContextOption, MultiAiRunConfigRequest } from '@/entities/ai-runtime'

export interface UseImportJobControllerOptions {
  entityKey: string | null
  mode: ImportMode
  sourceKind: ImportSourceKind
  setModeState: (mode: ImportMode) => void
  setSourceKindState: (sourceKind: ImportSourceKind) => void
  setMindMapWorkflowState: (workflow: MindMapImportWorkflow) => void
  batchImagesRef: RefObject<BatchImportImageItem[]>
  setBatchStatus: (status: 'idle' | 'ready' | 'loading' | 'success' | 'error') => void
  setLastBatchMeta: (value: BatchImportMeta | null) => void
  promptForAiOptions: (request: {
    scenarioKey: string
    entrypointKey: string
    title: string
    description?: string
    contextOptions?: AiGenerationContextOption[]
  }) => Promise<AiRuntimeOptions | undefined>
  promptForScenarioAiOptions: (
    request: MultiAiRunConfigRequest,
  ) => Promise<AiScenarioRuntimeOptionsMap | undefined>
  contextOptions?: AiGenerationContextOption[]
}

export interface ImportJobHydrateOptions {
  reused?: boolean
  preservePreviewUrl?: boolean
}

export type ImportPreviewEditorDoc = MindMapEditorState['editor_doc']
