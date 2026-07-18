import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/shared/feedback/toast'
import type {
  AiModelScenario,
  AiPromptBlock,
  AiPromptSceneDefault,
  AiRuntimeOptions,
  MindMapAiSplitMode,
  MindMapDoc,
  MindMapEditorState,
} from '@/shared/api/contracts'
import {
  getAiModelScenariosApi,
  getAiPromptBlocksApi,
  getAiPromptScenesApi,
  previewAiPromptCompositionApi,
} from '@/entities/preferences/api'
import {
  buildDefaultAiConfig,
  filterBlocksForScene,
  normalizeScenarioAiConfig,
  readRecentAiConfig,
  writeRecentAiConfig,
} from '@/entities/ai-runtime'
import { splitMindMapNodeApi } from '@/entities/palace/api'
import { runTrackedAiTask } from '@/shared/background-tasks/runTrackedAiTask'
import type { TaskStep } from '@/shared/background-tasks/backgroundTaskRegistry'
import { logAiCall, requestOpenAiLogDetail } from '@/shared/logs/model/appLogs'
import {
  addPreviewChild,
  appendSiblingsAfterUid,
  applyReplacementAtUid,
  countFirstLevelChildren,
  countPreviewNodes,
  deletePreviewNode,
  editorNodesToPreviewTree,
  fingerprintEditorDoc,
  listFirstLevelChildTexts,
  previewTreeToEditorNodes,
  replaceChildrenUnderUid,
  type AiSplitPreviewNode,
  updatePreviewNodeNote,
  updatePreviewNodeText,
} from '@/features/palace-edit/model/aiSplitPreview'

export type AiSplitWorkbenchPhase = 'config' | 'generating' | 'preview'
/** Structure preference for replacement split only (not add_children). */
export type AiSplitStructureMode = 'auto' | 'parallel' | 'hierarchy'
export type AiSplitTaskMode = 'split' | 'add'
export type AiSplitCardCountMode = 'auto' | 'about'

/** User may type any positive integer; no tight product cap (server hard-caps at 99). */
export const AI_SPLIT_CARD_COUNT_MIN = 1
export const AI_SPLIT_CARD_COUNT_MAX = 99
export const AI_SPLIT_CARD_COUNT_DEFAULT = 3

export interface AiSplitWorkbenchSource {
  targetNodeUid: string
  targetNodeText: string
  targetNodeNote: string
  editorDocSnapshot: MindMapDoc
  editorFingerprint: string
  existingChildCount: number
  existingChildTexts: string[]
}

function clampCardCount(value: number): number {
  if (!Number.isFinite(value)) return AI_SPLIT_CARD_COUNT_DEFAULT
  return Math.min(AI_SPLIT_CARD_COUNT_MAX, Math.max(AI_SPLIT_CARD_COUNT_MIN, Math.round(value)))
}

export interface UseAiSplitWorkbenchOptions {
  palaceId: number | null
  navigateTarget?: string
  getLatestEditorState: () => MindMapEditorState | null
  getCurrentSelectedUid: () => string | null
  getCurrentSelectedLabel: () => string
  applyEditorDoc: (nextDoc: MindMapDoc) => void
  onApplied?: (meta: {
    mode: 'replace' | 'append' | 'write_children'
    nodeCount: number
    aiCallLogId?: string | null
  }) => void
}

const ENTRYPOINT = 'mindmap-ai-split'
const SCENARIO_KEY = 'ai_split'
const PROMPT_SCENE_KEY = 'ai_split'

function createOperationId() {
  return globalThis.crypto?.randomUUID?.() ?? `ai-split-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const DEFAULT_STEPS: TaskStep[] = [
  { label: '准备请求', status: 'pending' },
  { label: '模型生成', status: 'pending' },
  { label: '校验结构', status: 'pending' },
  { label: '生成预览', status: 'pending' },
]

export function useAiSplitWorkbench(options: UseAiSplitWorkbenchOptions) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<AiSplitWorkbenchPhase>('config')
  const [source, setSource] = useState<AiSplitWorkbenchSource | null>(null)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [scenario, setScenario] = useState<AiModelScenario | null>(null)
  const [promptBlocks, setPromptBlocks] = useState<AiPromptBlock[]>([])
  const [promptScene, setPromptScene] = useState<AiPromptSceneDefault | null>(null)
  const [aiConfig, setAiConfig] = useState<AiRuntimeOptions>({})
  /** Session-only task/structure prefs; reset each time the workbench opens. */
  const [taskMode, setTaskMode] = useState<AiSplitTaskMode>('split')
  const [structureMode, setStructureMode] = useState<AiSplitStructureMode>('auto')
  const [cardCountMode, setCardCountMode] = useState<AiSplitCardCountMode>('auto')
  const [targetCardCount, setTargetCardCountState] = useState(AI_SPLIT_CARD_COUNT_DEFAULT)
  const [steps, setSteps] = useState<TaskStep[]>(DEFAULT_STEPS)
  const [progressDetail, setProgressDetail] = useState('')
  const [generatingError, setGeneratingError] = useState<string | null>(null)
  const [previewTree, setPreviewTree] = useState<AiSplitPreviewNode[]>([])
  const [aiCallLogId, setAiCallLogId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const operationIdRef = useRef<string | null>(null)

  const availableBlocks = useMemo(
    () =>
      filterBlocksForScene(
        promptBlocks,
        PROMPT_SCENE_KEY,
        promptScene,
        aiConfig.prompt_options?.block_keys ?? [],
      ),
    [aiConfig.prompt_options?.block_keys, promptBlocks, promptScene],
  )

  const previewNodeCount = useMemo(() => countPreviewNodes(previewTree), [previewTree])

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true)
    try {
      const [scenariosRes, blocksRes, scenesRes] = await Promise.all([
        getAiModelScenariosApi(),
        getAiPromptBlocksApi().catch(() => ({ items: [] as AiPromptBlock[] })),
        getAiPromptScenesApi().catch(() => ({ items: [] as AiPromptSceneDefault[] })),
      ])
      const nextScenario =
        (scenariosRes.scenes ?? scenariosRes.scenarios ?? []).find((item) => item.key === SCENARIO_KEY)
        ?? null
      const nextScene =
        (scenesRes.items ?? []).find((item) => item.scene_key === PROMPT_SCENE_KEY) ?? null
      setScenario(nextScenario)
      setPromptBlocks(blocksRes.items ?? [])
      setPromptScene(nextScene)
      if (nextScenario) {
        const recent = readRecentAiConfig(ENTRYPOINT, SCENARIO_KEY)
        setAiConfig(normalizeScenarioAiConfig(nextScenario, recent, null, nextScene))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法加载 AI 分卡配置')
    } finally {
      setLoadingCatalog(false)
    }
  }, [])

  const openWorkbench = useCallback(
    async (payload: {
      targetNodeUid: string
      targetNodeText: string
      targetNodeNote: string
      editorDoc: MindMapDoc
    }) => {
      const fingerprint = fingerprintEditorDoc(payload.editorDoc)
      const existingChildCount = countFirstLevelChildren(payload.editorDoc, payload.targetNodeUid)
      const existingChildTexts = listFirstLevelChildTexts(payload.editorDoc, payload.targetNodeUid)
      setSource({
        targetNodeUid: payload.targetNodeUid,
        targetNodeText: payload.targetNodeText,
        targetNodeNote: payload.targetNodeNote,
        editorDocSnapshot: payload.editorDoc,
        editorFingerprint: fingerprint,
        existingChildCount,
        existingChildTexts,
      })
      setPhase('config')
      // Prefer 添卡 when the node already has enough first-level children to group.
      setTaskMode(existingChildCount >= 2 ? 'add' : 'split')
      setStructureMode('auto')
      setCardCountMode('auto')
      setTargetCardCountState(AI_SPLIT_CARD_COUNT_DEFAULT)
      setSteps(DEFAULT_STEPS)
      setProgressDetail('')
      setGeneratingError(null)
      setPreviewTree([])
      setAiCallLogId(null)
      setOpen(true)
      await loadCatalog()
    },
    [loadCatalog],
  )

  const closeWorkbench = useCallback(() => {
    if (phase === 'generating') {
      toast.info('分卡仍在后台进行；关闭窗口不会中断请求，但结果将不会自动写入脑图。')
    }
    setOpen(false)
    setPhase('config')
    setSource(null)
    setPreviewTree([])
    setGeneratingError(null)
    setTaskMode('split')
    setStructureMode('auto')
    setCardCountMode('auto')
    setTargetCardCountState(AI_SPLIT_CARD_COUNT_DEFAULT)
    operationIdRef.current = null
  }, [phase])

  const updateAiConfig = useCallback(
    (updater: (current: AiRuntimeOptions) => AiRuntimeOptions) => {
      setAiConfig((current) => updater(current))
    },
    [],
  )

  const resetConfigToDefault = useCallback(() => {
    if (!scenario) return
    setAiConfig(buildDefaultAiConfig(scenario, null, promptScene))
  }, [promptScene, scenario])

  const resolveAiOptionsForRequest = useCallback(async (): Promise<AiRuntimeOptions> => {
    if (!scenario) throw new Error('未找到 AI 分卡场景配置')
    const selectedModel = aiConfig.model?.trim() || scenario.default_model
    const modelMeta = scenario.available_models.find((item) => item.key === selectedModel)
    if (!modelMeta) throw new Error('请选择有效的模型')
    const promptOptions = {
      block_keys: aiConfig.prompt_options?.block_keys ?? [],
      scene_instruction: aiConfig.prompt_options?.scene_instruction ?? '',
      run_instruction: aiConfig.prompt_options?.run_instruction ?? '',
    }
    const manualOverride = aiConfig.prompt_override?.trim() || ''
    // 添卡 uses a dedicated backend system prompt (new_children schema). Do not send the
    // leaf-split composition text as prompt_override — it forces replacement_nodes and breaks parsing.
    let promptOverride: string | undefined = manualOverride || undefined
    if (!promptOverride && taskMode === 'split') {
      const compiled = await previewAiPromptCompositionApi(PROMPT_SCENE_KEY, promptOptions)
      promptOverride = compiled?.text || undefined
    }
    const payload: AiRuntimeOptions = {
      model: modelMeta.key,
      thinking_enabled: modelMeta.supports_thinking ? Boolean(aiConfig.thinking_enabled) : false,
      prompt_override: promptOverride,
      prompt_options: promptOptions,
    }
    writeRecentAiConfig(ENTRYPOINT, SCENARIO_KEY, payload)
    return payload
  }, [aiConfig, scenario, taskMode])

  const runGenerate = useCallback(async () => {
    if (!options.palaceId || !source) return
    if (taskMode === 'add' && source.existingChildCount < 2) {
      const message = 'AI 添卡需要至少 2 个一级子节点。'
      setGeneratingError(message)
      toast.error(message)
      return
    }
    setPhase('generating')
    setGeneratingError(null)
    setSteps(DEFAULT_STEPS.map((step, index) => ({
      ...step,
      status: index === 0 ? 'active' : 'pending',
    })))
    setProgressDetail('准备请求…')
    const operationId = createOperationId()
    operationIdRef.current = operationId
    const ownerId = `palace:${options.palaceId}`
    const requestSplitMode: MindMapAiSplitMode =
      taskMode === 'add' ? 'add_children' : structureMode
    // No tight client-side cap: send whatever the user typed (server soft-caps / structural clamps).
    const resolvedCardCount =
      cardCountMode === 'about' ? clampCardCount(targetCardCount) : null
    const requestSummary =
      `知识点: ${source.targetNodeUid}；任务: ${taskMode === 'add' ? '添卡' : '分卡'}；结构: ${requestSplitMode}`
      + (resolvedCardCount != null ? `；约 ${resolvedCardCount} 张` : '；张数自动')

    logAiCall({
      feature: taskMode === 'add' ? 'AI 添卡' : 'AI 分卡',
      stage: 'start',
      requestSummary,
      meta: {
        palaceId: options.palaceId,
        targetNodeUid: source.targetNodeUid,
        splitMode: requestSplitMode,
        taskMode,
        targetCardCount: resolvedCardCount ?? '',
      },
    })

    try {
      const aiOptions = await resolveAiOptionsForRequest()
      const result = await runTrackedAiTask({
        id: `ai-split-${operationId}`,
        section: 'palaces',
        title: taskMode === 'add' ? 'AI 添卡 · 生成中' : 'AI 分卡 · 生成中',
        navigateTarget: options.navigateTarget,
        initialDetail: '准备请求…',
        steps: [
          { id: 'prepare', label: '准备请求' },
          { id: 'generate', label: '模型生成' },
          { id: 'validate', label: '校验结构' },
          { id: 'preview', label: '生成预览' },
        ],
        run: async (controller) => {
          const mark = (id: string, detail: string, stepIndex: number) => {
            controller.setStep(id, detail)
            setProgressDetail(detail)
            setSteps((current) =>
              current.map((step, index) => ({
                ...step,
                status:
                  index < stepIndex ? 'done' : index === stepIndex ? 'active' : 'pending',
              })),
            )
          }
          mark('prepare', '正在编译提示词并提交…', 0)
          mark(
            'generate',
            taskMode === 'add' ? '模型正在生成中间分类…' : '模型正在拆分卡片…',
            1,
          )
          const response = await splitMindMapNodeApi(options.palaceId!, {
            editor_doc: source.editorDocSnapshot,
            target_node_uid: source.targetNodeUid,
            split_mode: requestSplitMode,
            target_card_count: resolvedCardCount,
            owner_id: ownerId,
            operation_id: operationId,
            ai_options: aiOptions,
          })
          mark('validate', '正在校验返回结构…', 2)
          if (!response.ok) {
            throw new Error(response.error || (taskMode === 'add' ? 'AI 添卡失败，请稍后重试。' : 'AI 分卡失败，请稍后重试。'))
          }
          if (response.operation_id && response.operation_id !== operationId) {
            throw new Error(taskMode === 'add' ? 'AI 添卡结果已过期，请重新生成。' : 'AI 分卡结果已过期，请重新分卡。')
          }
          if (response.owner_id && response.owner_id !== ownerId) {
            throw new Error('宫殿已切换，结果未采用。')
          }
          const rawNodes = response.replacement_nodes
          if (!rawNodes || rawNodes.length === 0) {
            throw new Error(
              taskMode === 'add'
                ? '服务端未返回可预览的添卡树，请重试或检查提示词。'
                : '服务端未返回可预览的分卡树，请重试或检查提示词。',
            )
          }
          mark('preview', '正在整理预览…', 3)
          return response
        },
      })

      const tree = editorNodesToPreviewTree(result.replacement_nodes ?? [])
      if (tree.length === 0) {
        throw new Error(taskMode === 'add' ? '添卡结果为空。' : '分卡结果为空。')
      }
      setPreviewTree(tree)
      setAiCallLogId(result.ai_call_log_id ?? null)
      setSteps((current) => current.map((step) => ({ ...step, status: 'done' as const })))
      setProgressDetail('预览已就绪（尚未写入脑图）')
      setPhase('preview')
      logAiCall({
        feature: taskMode === 'add' ? 'AI 添卡' : 'AI 分卡',
        stage: 'success',
        requestSummary,
        responseSummary: `预览就绪：${tree.length} 个顶层节点（未写入）`,
        meta: {
          palaceId: options.palaceId,
          targetNodeUid: source.targetNodeUid,
          operationId,
          model: result.model ?? '',
          aiCallLogId: result.ai_call_log_id ?? '',
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : (taskMode === 'add' ? 'AI 添卡失败' : 'AI 分卡失败')
      setGeneratingError(message)
      setPhase('config')
      setSteps((current) =>
        current.map((step, index) =>
          step.status === 'active' || (index === 0 && step.status === 'pending')
            ? { ...step, status: 'failed' as const }
            : step,
        ),
      )
      logAiCall({
        feature: taskMode === 'add' ? 'AI 添卡' : 'AI 分卡',
        stage: 'failure',
        requestSummary,
        errorMessage: message,
        meta: {
          palaceId: options.palaceId,
          targetNodeUid: source.targetNodeUid,
          operationId,
        },
      })
      toast.error(message)
    }
  }, [
    cardCountMode,
    options,
    resolveAiOptionsForRequest,
    source,
    structureMode,
    targetCardCount,
    taskMode,
  ])

  const ensureDocUnchangedOrConfirm = useCallback(async (): Promise<MindMapEditorState | null> => {
    const latest = options.getLatestEditorState()
    if (!latest?.editor_doc || !source) return null
    const latestDoc = latest.editor_doc as MindMapDoc
    const latestFp = fingerprintEditorDoc(latestDoc)
    if (latestFp !== source.editorFingerprint) {
      // Soft warn: still allow apply on latest doc for the chosen target uid.
      toast.info('脑图在预览期间有过编辑，将基于当前脑图应用分卡结果。')
    }
    return latest
  }, [options, source])

  const applyReplace = useCallback(async () => {
    if (!source) return
    setApplying(true)
    try {
      const latest = await ensureDocUnchangedOrConfirm()
      if (!latest) throw new Error('当前没有可写入的脑图。')
      const nodes = previewTreeToEditorNodes(previewTree)
      if (taskMode === 'add') {
        const nextDoc = replaceChildrenUnderUid(
          latest.editor_doc as MindMapDoc,
          source.targetNodeUid,
          nodes,
        )
        options.applyEditorDoc(nextDoc)
        options.onApplied?.({
          mode: 'write_children',
          nodeCount: nodes.length,
          aiCallLogId,
        })
        toast.success(
          `已在源父卡下写入 ${nodes.length} 个中间分类`,
          aiCallLogId
            ? {
                action: {
                  label: '查看AI详情',
                  onClick: () =>
                    requestOpenAiLogDetail({
                      aiCallLogId,
                      title: 'AI 添卡',
                    }),
                },
              }
            : undefined,
        )
      } else {
        const nextDoc = applyReplacementAtUid(
          latest.editor_doc as MindMapDoc,
          source.targetNodeUid,
          nodes,
        )
        options.applyEditorDoc(nextDoc)
        options.onApplied?.({
          mode: 'replace',
          nodeCount: nodes.length,
          aiCallLogId,
        })
        toast.success(
          `已原位替换为 ${nodes.length} 个顶层卡片`,
          aiCallLogId
            ? {
                action: {
                  label: '查看AI详情',
                  onClick: () =>
                    requestOpenAiLogDetail({
                      aiCallLogId,
                      title: 'AI 分卡',
                    }),
                },
              }
            : undefined,
        )
      }
      setOpen(false)
      setSource(null)
      setPhase('config')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '应用失败')
    } finally {
      setApplying(false)
    }
  }, [aiCallLogId, ensureDocUnchangedOrConfirm, options, previewTree, source, taskMode])

  const applyAppendAfterSelection = useCallback(async () => {
    const selectedUid = options.getCurrentSelectedUid()
    if (!selectedUid) {
      toast.error('请先在脑图上点选一张卡片（可把本窗口拖开）')
      return
    }
    setApplying(true)
    try {
      const latest = await ensureDocUnchangedOrConfirm()
      if (!latest) throw new Error('当前没有可写入的脑图。')
      const nodes = previewTreeToEditorNodes(previewTree)
      const nextDoc = appendSiblingsAfterUid(latest.editor_doc as MindMapDoc, selectedUid, nodes)
      options.applyEditorDoc(nextDoc)
      options.onApplied?.({
        mode: 'append',
        nodeCount: nodes.length,
        aiCallLogId,
      })
      toast.success(
        `已在「${options.getCurrentSelectedLabel() || selectedUid}」后追加 ${nodes.length} 张同级卡片`,
      )
      setOpen(false)
      setSource(null)
      setPhase('config')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '追加分卡失败')
    } finally {
      setApplying(false)
    }
  }, [aiCallLogId, ensureDocUnchangedOrConfirm, options, previewTree])

  // Keep open state stable while generating if user accidentally triggers re-open.
  useEffect(() => {
    if (!open) return
  }, [open])

  return {
    open,
    phase,
    source,
    loadingCatalog,
    scenario,
    availableBlocks,
    promptScene,
    aiConfig,
    taskMode,
    structureMode,
    cardCountMode,
    targetCardCount,
    steps,
    progressDetail,
    generatingError,
    previewTree,
    previewNodeCount,
    applying,
    aiCallLogId,
    openWorkbench,
    closeWorkbench,
    updateAiConfig,
    resetConfigToDefault,
    setTaskMode,
    setStructureMode,
    setCardCountMode,
    setTargetCardCount: (value: number) => {
      setTargetCardCountState(clampCardCount(value))
    },
    runGenerate,
    setPreviewTree,
    updatePreviewNodeText: (nodeId: string, text: string) => {
      setPreviewTree((current) => updatePreviewNodeText(current, nodeId, text))
    },
    updatePreviewNodeNote: (nodeId: string, note: string) => {
      setPreviewTree((current) => updatePreviewNodeNote(current, nodeId, note))
    },
    deletePreviewNode: (nodeId: string) => {
      setPreviewTree((current) => deletePreviewNode(current, nodeId))
    },
    addPreviewChild: (parentId: string | null) => {
      setPreviewTree((current) => addPreviewChild(current, parentId))
    },
    applyReplace,
    applyAppendAfterSelection,
    rerunGenerate: () => {
      void runGenerate()
    },
  }
}
