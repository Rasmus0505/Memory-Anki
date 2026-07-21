import * as React from 'react'
import { toast } from '@/shared/feedback/toast'
import type {
  AiModelScenario,
  AiPromptBlock,
  AiPromptRunSelection,
  AiPromptSceneDefault,
  AiScenarioRuntimeOptionsMap,
  AiRuntimeOptions,
} from '@/shared/api/contracts'
import {
  buildDefaultAiConfig,
  getScenarioPromptTemplateKey,
  normalizeScenarioAiConfig,
  readRecentAiConfig,
  type PromptTemplateSnapshot,
  writeRecentAiConfig,
} from './aiRunConfigPersistence'
import {
  getAiPromptBlocksApi,
  getAiPromptScenesApi,
  getAiPromptTemplatesApi,
  getAiModelScenariosApi,
  previewAiPromptCompositionApi,
  saveAiPromptSceneDefaultApi,
} from '@/entities/preferences/api'
import {
  buildPromptWithContexts,
  resolvePromptSceneKey,
  type AiRunConfigRequest,
  type MultiAiRunConfigRequest,
} from './aiRunConfigDialogHelpers'
import { AiRunConfigDialogView } from './AiRunConfigDialogView'

export type {
  AiGenerationContextOption,
  AiRunConfigRequest,
  MultiAiRunConfigRequest,
  MultiScenarioEntry,
} from './aiRunConfigDialogHelpers'

interface PendingRequest extends MultiAiRunConfigRequest {
  resolve: (value: AiScenarioRuntimeOptionsMap | undefined) => void
}

interface AiRunConfigCatalog {
  scenarios: AiModelScenario[]
  promptTemplates: Record<string, PromptTemplateSnapshot>
  promptBlocks: AiPromptBlock[]
  promptScenes: Record<string, AiPromptSceneDefault>
}

export function useAiRunConfigDialog() {
  const [scenarios, setScenarios] = React.useState<AiModelScenario[]>([])
  const [loading, setLoading] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [pending, setPending] = React.useState<PendingRequest | null>(null)
  const [selectedConfigs, setSelectedConfigs] = React.useState<Record<string, AiRuntimeOptions>>({})
  const [promptTemplates, setPromptTemplates] = React.useState<Record<string, PromptTemplateSnapshot>>({})
  const [promptBlocks, setPromptBlocks] = React.useState<AiPromptBlock[]>([])
  const [promptScenes, setPromptScenes] = React.useState<Record<string, AiPromptSceneDefault>>({})
  const [savingDefaults, setSavingDefaults] = React.useState<Record<string, boolean>>({})
  const [selectedContexts, setSelectedContexts] = React.useState<Record<string, string[]>>({})

  const pendingEntries = React.useMemo(() => pending?.entries ?? [], [pending])
  const currentEntries = React.useMemo(
    () =>
      pendingEntries.map((entry) => ({
        entry,
        scenario: scenarios.find((item) => item.key === entry.scenarioKey) ?? null,
        recentConfig: readRecentAiConfig(entry.entrypointKey, entry.scenarioKey),
        promptTemplate: promptTemplates[getScenarioPromptTemplateKey(entry.scenarioKey) ?? ''] ?? null,
        promptScene: promptScenes[entry.promptSceneKey ?? entry.scenarioKey] ?? null,
      })),
    [pendingEntries, promptScenes, promptTemplates, scenarios],
  )

  const loadScenarios = React.useCallback(async () => {
    setLoading(true)
    try {
      const [response, promptResponse, blockResponse, sceneResponse] = await Promise.all([
        getAiModelScenariosApi(),
        getAiPromptTemplatesApi().catch(() => ({ items: [] })),
        getAiPromptBlocksApi().catch(() => ({ items: [] })),
        getAiPromptScenesApi().catch(() => ({ items: [] })),
      ])
      const nextScenes = response.scenes ?? response.scenarios ?? []
      const nextPromptTemplates = Object.fromEntries(
        (promptResponse.items ?? []).map((item) => [
          item.key,
          {
            template: item.template,
            defaultTemplate: item.default_template,
          },
        ]),
      )
      setScenarios(nextScenes)
      setPromptTemplates(nextPromptTemplates)
      setPromptBlocks(blockResponse.items ?? [])
      const nextPromptScenes = Object.fromEntries(
        (sceneResponse.items ?? []).map((item) => [item.scene_key, item]),
      )
      setPromptScenes(nextPromptScenes)
      return {
        scenarios: nextScenes,
        promptTemplates: nextPromptTemplates,
        promptBlocks: blockResponse.items ?? [],
        promptScenes: nextPromptScenes,
      } satisfies AiRunConfigCatalog
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法加载 AI 运行配置。'
      toast.error(message)
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  const promptForScenarioAiOptions = React.useCallback(
    async (request: MultiAiRunConfigRequest) => {
      let nextScenarios = scenarios
      let nextPromptTemplates = promptTemplates
      let nextPromptScenes = promptScenes
      // Reload when scenarios are missing, or when scene defaults never loaded
      // (otherwise modular block checkboxes open with an empty combination).
      if (nextScenarios.length === 0 || Object.keys(nextPromptScenes).length === 0) {
        try {
          const catalog = await loadScenarios()
          nextScenarios = catalog.scenarios
          nextPromptTemplates = catalog.promptTemplates
          nextPromptScenes = catalog.promptScenes
        } catch {
          return undefined
        }
      }
      const nextSelectedConfigs: Record<string, AiRuntimeOptions> = {}
      const nextSelectedContexts: Record<string, string[]> = {}
      for (const entry of request.entries) {
        const scenario = nextScenarios.find((item) => item.key === entry.scenarioKey)
        if (!scenario) {
          toast.error('当前入口没有找到对应的 AI 场景配置。')
          return undefined
        }
        const promptTemplateKey = getScenarioPromptTemplateKey(entry.scenarioKey) ?? ''
        const promptTemplate = nextPromptTemplates[promptTemplateKey] ?? null
        const recentConfig = readRecentAiConfig(entry.entrypointKey, entry.scenarioKey)
        nextSelectedConfigs[entry.scenarioKey] = normalizeScenarioAiConfig(
          scenario,
          recentConfig,
          promptTemplate,
          nextPromptScenes[entry.promptSceneKey ?? entry.scenarioKey] ?? null,
        )
        nextSelectedContexts[entry.scenarioKey] = []
      }
      if (request.entries.length === 0) {
        toast.error('当前入口没有可选择的 AI 场景。')
        return undefined
      }
      return new Promise<AiScenarioRuntimeOptionsMap | undefined>((resolve) => {
        setSelectedConfigs(nextSelectedConfigs)
        setSelectedContexts(nextSelectedContexts)
        setPending({ ...request, resolve })
      })
    },
    [loadScenarios, promptScenes, promptTemplates, scenarios],
  )

  const promptForAiOptions = React.useCallback(
    async (request: AiRunConfigRequest) => {
      const result = await promptForScenarioAiOptions({
        title: request.title,
        description: request.description,
        entries: [
          {
            scenarioKey: request.scenarioKey,
            entrypointKey: request.entrypointKey,
            promptSceneKey: request.promptSceneKey,
            syncScenarioKeys: request.syncScenarioKeys,
            contextOptions: request.contextOptions,
          },
        ],
      })
      return result?.[request.scenarioKey]
    },
    [promptForScenarioAiOptions],
  )

  const closeDialog = React.useCallback(() => {
    const resolve = pending?.resolve
    setPending(null)
    setSelectedConfigs({})
    setSelectedContexts({})
    if (resolve) {
      resolve(undefined)
    }
  }, [pending])

  const handleConfirm = React.useCallback(async () => {
    if (!pending || pending.entries.length === 0) {
      closeDialog()
      return
    }
    const nextPayload: AiScenarioRuntimeOptionsMap = {}
    setConfirming(true)
    try {
      for (const entry of pending.entries) {
        const scenario = scenarios.find((item) => item.key === entry.scenarioKey) ?? null
        const selectedConfig = selectedConfigs[entry.scenarioKey]
        const selectedModel = selectedConfig?.model?.trim() || ''
        const selectedModelMeta =
          scenario?.available_models.find((item) => item.key === selectedModel) ?? null
        if (!scenario || !selectedModelMeta) {
          throw new Error('当前入口缺少有效的模型配置，无法确认。')
        }
        const promptOptions: AiPromptRunSelection = {
          block_keys: selectedConfig?.prompt_options?.block_keys ?? [],
          scene_instruction: selectedConfig?.prompt_options?.scene_instruction ?? '',
          run_instruction: buildPromptWithContexts(
            selectedConfig?.prompt_options?.run_instruction?.trim() || '',
            entry.contextOptions ?? [],
            selectedContexts[entry.scenarioKey] ?? [],
          ),
          emphasis_mark_description:
            selectedConfig?.prompt_options?.emphasis_mark_description?.trim() || '',
        }
        const manualOverride = selectedConfig?.prompt_override?.trim() || ''
        const promptKey = resolvePromptSceneKey(entry.scenarioKey, entry.promptSceneKey)
        const compiled = manualOverride
          ? null
          : await previewAiPromptCompositionApi(promptKey, promptOptions)
        const payload: AiRuntimeOptions = {
          model: selectedModelMeta.key,
          thinking_enabled: selectedModelMeta.supports_thinking
            ? Boolean(selectedConfig?.thinking_enabled)
            : false,
          prompt_override: manualOverride || compiled?.text || undefined,
          prompt_options: promptOptions,
        }
        nextPayload[entry.scenarioKey] = payload
      }
      for (const entry of pending.entries) {
        const payload = nextPayload[entry.scenarioKey]
        if (payload) {
          const syncScenarioKeys = Array.from(
            new Set([entry.scenarioKey, ...(entry.syncScenarioKeys ?? [])]),
          )
          for (const sceneKey of syncScenarioKeys) {
            writeRecentAiConfig(entry.entrypointKey, sceneKey, payload)
          }
        }
      }
      const syncedSceneLabels = pending.entries
        .map((entry) => scenarios.find((item) => item.key === entry.scenarioKey)?.label ?? entry.scenarioKey)
        .join('、')
      toast.success(`已保存 ${syncedSceneLabels} 的本次生成配置`)
      const resolve = pending.resolve
      setPending(null)
      setSelectedConfigs({})
      setSelectedContexts({})
      resolve(nextPayload)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 AI 生成配置失败。')
    } finally {
      setConfirming(false)
    }
  }, [closeDialog, pending, scenarios, selectedConfigs, selectedContexts])

  const updateScenarioConfig = React.useCallback(
    (
      scenarioKey: string,
      updater: (current: AiRuntimeOptions | undefined) => AiRuntimeOptions,
    ) => {
      setSelectedConfigs((current) => ({
        ...current,
        [scenarioKey]: updater(current[scenarioKey]),
      }))
    },
    [],
  )

  const applyScenarioDefault = React.useCallback((scenarioKey: string, promptSceneKey?: string) => {
    const scenario = scenarios.find((item) => item.key === scenarioKey)
    if (!scenario) return
    const promptKey = resolvePromptSceneKey(scenarioKey, promptSceneKey)
    const promptTemplateKey = getScenarioPromptTemplateKey(scenarioKey) ?? ''
    const promptTemplate = promptTemplates[promptTemplateKey] ?? null
    setSelectedConfigs((current) => ({
      ...current,
      [scenarioKey]: buildDefaultAiConfig(scenario, promptTemplate, promptScenes[promptKey] ?? null),
    }))
  }, [promptScenes, promptTemplates, scenarios])

  const applyScenarioRecentChoice = React.useCallback(
    (scenarioKey: string, entrypointKey: string, promptSceneKey?: string) => {
      const scenario = scenarios.find((item) => item.key === scenarioKey)
      if (!scenario) return
      const recentConfig = readRecentAiConfig(entrypointKey, scenarioKey)
      if (!recentConfig) return
      const promptKey = resolvePromptSceneKey(scenarioKey, promptSceneKey)
      const promptTemplateKey = getScenarioPromptTemplateKey(scenarioKey) ?? ''
      const promptTemplate = promptTemplates[promptTemplateKey] ?? null
      setSelectedConfigs((current) => ({
        ...current,
        [scenarioKey]: normalizeScenarioAiConfig(
          scenario,
          recentConfig,
          promptTemplate,
          promptScenes[promptKey] ?? null,
        ),
      }))
    },
    [promptScenes, promptTemplates, scenarios],
  )

  const resetAllToDefaults = React.useCallback(() => {
    if (!pending) return
    const nextSelectedConfigs: Record<string, AiRuntimeOptions> = {}
    for (const entry of pending.entries) {
      const scenario = scenarios.find((item) => item.key === entry.scenarioKey)
      if (!scenario) continue
      const promptKey = resolvePromptSceneKey(entry.scenarioKey, entry.promptSceneKey)
      const promptTemplateKey = getScenarioPromptTemplateKey(entry.scenarioKey) ?? ''
      nextSelectedConfigs[entry.scenarioKey] = buildDefaultAiConfig(
        scenario,
        promptTemplates[promptTemplateKey] ?? null,
        promptScenes[promptKey] ?? null,
      )
    }
    setSelectedConfigs(nextSelectedConfigs)
  }, [pending, promptScenes, promptTemplates, scenarios])

  const saveCurrentAsDefault = React.useCallback(async (scenarioKey: string, promptSceneKey?: string) => {
    const selection = selectedConfigs[scenarioKey]?.prompt_options
    if (!selection) return
    const promptKey = resolvePromptSceneKey(scenarioKey, promptSceneKey)
    setSavingDefaults((current) => ({ ...current, [promptKey]: true }))
    try {
      const saved = await saveAiPromptSceneDefaultApi(promptKey, {
        block_keys: selection.block_keys ?? [],
        scene_instruction: selection.scene_instruction ?? '',
      })
      setPromptScenes((current) => ({ ...current, [promptKey]: saved }))
      setSelectedConfigs((current) => ({
        ...current,
        [scenarioKey]: {
          ...current[scenarioKey],
          prompt_options: {
            block_keys: saved.block_keys,
            scene_instruction: saved.scene_instruction,
            run_instruction: current[scenarioKey]?.prompt_options?.run_instruction ?? '',
            emphasis_mark_description:
              current[scenarioKey]?.prompt_options?.emphasis_mark_description ?? '',
          },
        },
      }))
      toast.success(`${saved.label} 已设为以后默认`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存场景默认提示词失败。')
    } finally {
      setSavingDefaults((current) => ({ ...current, [promptKey]: false }))
    }
  }, [selectedConfigs])

  const dialog = (
    <AiRunConfigDialogView
      open={Boolean(pending)}
      title={pending?.title ?? '选择本次 AI 配置'}
      description={pending?.description}
      loading={loading}
      confirming={confirming}
      currentEntries={currentEntries}
      selectedConfigs={selectedConfigs}
      selectedContexts={selectedContexts}
      promptBlocks={promptBlocks}
      savingDefaults={savingDefaults}
      onClose={closeDialog}
      onConfirm={() => { void handleConfirm() }}
      onResetAllDefaults={resetAllToDefaults}
      onUpdateScenarioConfig={updateScenarioConfig}
      onApplyScenarioDefault={applyScenarioDefault}
      onApplyScenarioRecentChoice={applyScenarioRecentChoice}
      onSaveCurrentAsDefault={(scenarioKey, promptSceneKey) => {
        void saveCurrentAsDefault(scenarioKey, promptSceneKey)
      }}
      onSetSelectedContexts={setSelectedContexts}
    />
  )

  return {
    promptForAiOptions,
    promptForScenarioAiOptions,
    aiRunConfigDialog: dialog,
  }
}
