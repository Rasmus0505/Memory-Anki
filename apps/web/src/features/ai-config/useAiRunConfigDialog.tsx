import * as React from 'react'
import { toast } from '@/shared/feedback/toast'
import type {
  AiModelScenario,
  AiScenarioRuntimeOptionsMap,
  AiRuntimeOptions,
} from '@/shared/api/contracts'
import {
  getAiPromptTemplatesApi,
  getAiModelScenariosApi,
} from '@/entities/preferences/api/aiModelSettingsApi'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

interface AiRunConfigRequest {
  scenarioKey: string
  entrypointKey: string
  title: string
  description?: string
  syncScenarioKeys?: string[]
}

interface MultiScenarioEntry {
  scenarioKey: string
  entrypointKey: string
  label?: string
  description?: string
  syncScenarioKeys?: string[]
}

interface MultiAiRunConfigRequest {
  title: string
  description?: string
  entries: MultiScenarioEntry[]
}

interface PendingRequest extends MultiAiRunConfigRequest {
  resolve: (value: AiScenarioRuntimeOptionsMap | undefined) => void
}

const RECENT_AI_CONFIG_PREFIX = 'memory-anki.ai-runtime-recent.'

const SCENARIO_PROMPT_TEMPLATE_KEYS: Record<string, string> = {
  vision_image_mindmap: 'ai_prompt_import_image_mindmap',
  vision_image_text: 'ai_prompt_import_image_text',
  vision_batch_mindmap: 'ai_prompt_import_batch_mindmap',
  vision_pdf_mindmap: 'ai_prompt_import_pdf_direct',
  vision_pdf_text: 'ai_prompt_import_image_text',
  quiz_image_generation: 'ai_prompt_palace_quiz_generate',
  quiz_pdf_generation: 'ai_prompt_palace_quiz_generate',
  quiz_pdf_pairing: 'ai_prompt_palace_quiz_pdf_pairing',
  quiz_pdf_review: 'ai_prompt_palace_quiz_pdf_review',
  quiz_review_mindmap_generation: 'ai_prompt_palace_quiz_review_mindmap',
  quiz_mini_palace_grouping: 'ai_prompt_palace_quiz_group_by_mini_palace',
}

interface PromptTemplateSnapshot {
  template: string
  defaultTemplate: string
}

interface AiRunConfigCatalog {
  scenarios: AiModelScenario[]
  promptTemplates: Record<string, PromptTemplateSnapshot>
}

function recentConfigKey(entrypointKey: string, scenarioKey: string) {
  return `${RECENT_AI_CONFIG_PREFIX}${entrypointKey}.${scenarioKey}`
}

function readRecentAiConfig(entrypointKey: string, scenarioKey: string): AiRuntimeOptions | null {
  if (typeof window === 'undefined') return null
  try {
    const raw =
      window.localStorage.getItem(recentConfigKey(entrypointKey, scenarioKey)) ||
      window.localStorage.getItem(`${RECENT_AI_CONFIG_PREFIX}${entrypointKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AiRuntimeOptions
    if (!parsed || typeof parsed !== 'object') return null
    return {
      model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : undefined,
      thinking_enabled:
        typeof parsed.thinking_enabled === 'boolean' ? parsed.thinking_enabled : undefined,
      prompt_override:
        typeof parsed.prompt_override === 'string' && parsed.prompt_override.trim()
          ? parsed.prompt_override
          : undefined,
    }
  } catch {
    return null
  }
}

function writeRecentAiConfig(entrypointKey: string, scenarioKey: string, value: AiRuntimeOptions) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      recentConfigKey(entrypointKey, scenarioKey),
      JSON.stringify(value),
    )
  } catch {
    // Ignore local storage failures and keep the current run usable.
  }
}

function buildDefaultAiConfig(
  scenario: AiModelScenario,
  promptTemplate?: PromptTemplateSnapshot | null,
): AiRuntimeOptions {
  return {
    model: scenario.default_model,
    thinking_enabled: scenario.default_thinking_enabled,
    prompt_override: promptTemplate?.template || promptTemplate?.defaultTemplate || undefined,
  }
}

function normalizeScenarioAiConfig(
  scenario: AiModelScenario,
  value: AiRuntimeOptions | null | undefined,
  promptTemplate?: PromptTemplateSnapshot | null,
): AiRuntimeOptions {
  const fallback = buildDefaultAiConfig(scenario, promptTemplate)
  const model = value?.model?.trim()
  const matchedModel = scenario.available_models.find((item) => item.key === model)
  const resolvedModel = matchedModel?.key ?? fallback.model
  const resolvedMetadata = scenario.available_models.find((item) => item.key === resolvedModel)
  const thinkingEnabled = resolvedMetadata?.supports_thinking
    ? Boolean(value?.thinking_enabled ?? fallback.thinking_enabled)
    : false
  return {
    model: resolvedModel,
    thinking_enabled: thinkingEnabled,
    prompt_override: value?.prompt_override?.trim() || fallback.prompt_override,
  }
}

export function useAiRunConfigDialog() {
  const [scenarios, setScenarios] = React.useState<AiModelScenario[]>([])
  const [loading, setLoading] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [pending, setPending] = React.useState<PendingRequest | null>(null)
  const [selectedConfigs, setSelectedConfigs] = React.useState<Record<string, AiRuntimeOptions>>({})
  const [promptTemplates, setPromptTemplates] = React.useState<Record<string, PromptTemplateSnapshot>>({})

  const pendingEntries = React.useMemo(() => pending?.entries ?? [], [pending])
  const currentEntries = React.useMemo(
    () =>
      pendingEntries.map((entry) => ({
        entry,
        scenario: scenarios.find((item) => item.key === entry.scenarioKey) ?? null,
        recentConfig: readRecentAiConfig(entry.entrypointKey, entry.scenarioKey),
        promptTemplate: promptTemplates[SCENARIO_PROMPT_TEMPLATE_KEYS[entry.scenarioKey] || ''] ?? null,
      })),
    [pendingEntries, promptTemplates, scenarios],
  )

  const loadScenarios = React.useCallback(async () => {
    setLoading(true)
    try {
      const [response, promptResponse] = await Promise.all([
        getAiModelScenariosApi(),
        getAiPromptTemplatesApi().catch(() => ({ items: [] })),
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
      return {
        scenarios: nextScenes,
        promptTemplates: nextPromptTemplates,
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
    async (request: MultiAiRunConfigRequest) =>
      new Promise<AiScenarioRuntimeOptionsMap | undefined>(async (resolve) => {
        let nextScenarios = scenarios
        let nextPromptTemplates = promptTemplates
        if (nextScenarios.length === 0) {
          try {
            const catalog = await loadScenarios()
            nextScenarios = catalog.scenarios
            nextPromptTemplates = catalog.promptTemplates
          } catch {
            resolve(undefined)
            return
          }
        }
        const nextSelectedConfigs: Record<string, AiRuntimeOptions> = {}
        for (const entry of request.entries) {
          const scenario = nextScenarios.find((item) => item.key === entry.scenarioKey)
          if (!scenario) {
            toast.error('当前入口没有找到对应的 AI 场景配置。')
            resolve(undefined)
            return
          }
          const promptTemplateKey = SCENARIO_PROMPT_TEMPLATE_KEYS[entry.scenarioKey] || ''
          const promptTemplate = nextPromptTemplates[promptTemplateKey] ?? null
          const recentConfig = readRecentAiConfig(entry.entrypointKey, entry.scenarioKey)
          nextSelectedConfigs[entry.scenarioKey] = normalizeScenarioAiConfig(
            scenario,
            recentConfig,
            promptTemplate,
          )
        }
        if (request.entries.length === 0) {
          toast.error('当前入口没有可选择的 AI 场景。')
          resolve(undefined)
          return
        }
        setSelectedConfigs(nextSelectedConfigs)
        setPending({ ...request, resolve })
      }),
    [loadScenarios, promptTemplates, scenarios],
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
            syncScenarioKeys: request.syncScenarioKeys,
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
        const payload: AiRuntimeOptions = {
          model: selectedModelMeta.key,
          thinking_enabled: selectedModelMeta.supports_thinking
            ? Boolean(selectedConfig?.thinking_enabled)
            : false,
          prompt_override: selectedConfig?.prompt_override?.trim() || undefined,
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
      resolve(nextPayload)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 AI 生成配置失败。')
    } finally {
      setConfirming(false)
    }
  }, [closeDialog, pending, scenarios, selectedConfigs])

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

  const applyScenarioDefault = React.useCallback((scenarioKey: string) => {
    const scenario = scenarios.find((item) => item.key === scenarioKey)
    if (!scenario) return
    const promptTemplateKey = SCENARIO_PROMPT_TEMPLATE_KEYS[scenarioKey] || ''
    const promptTemplate = promptTemplates[promptTemplateKey] ?? null
    setSelectedConfigs((current) => ({
      ...current,
      [scenarioKey]: buildDefaultAiConfig(scenario, promptTemplate),
    }))
  }, [promptTemplates, scenarios])

  const applyScenarioRecentChoice = React.useCallback(
    (scenarioKey: string, entrypointKey: string) => {
      const scenario = scenarios.find((item) => item.key === scenarioKey)
      if (!scenario) return
      const recentConfig = readRecentAiConfig(entrypointKey, scenarioKey)
      if (!recentConfig) return
      const promptTemplateKey = SCENARIO_PROMPT_TEMPLATE_KEYS[scenarioKey] || ''
      const promptTemplate = promptTemplates[promptTemplateKey] ?? null
      setSelectedConfigs((current) => ({
        ...current,
        [scenarioKey]: normalizeScenarioAiConfig(scenario, recentConfig, promptTemplate),
      }))
    },
    [promptTemplates, scenarios],
  )

  const resetAllToDefaults = React.useCallback(() => {
    if (!pending) return
    const nextSelectedConfigs: Record<string, AiRuntimeOptions> = {}
    for (const entry of pending.entries) {
      const scenario = scenarios.find((item) => item.key === entry.scenarioKey)
      if (!scenario) continue
      const promptTemplateKey = SCENARIO_PROMPT_TEMPLATE_KEYS[entry.scenarioKey] || ''
      nextSelectedConfigs[entry.scenarioKey] = buildDefaultAiConfig(
        scenario,
        promptTemplates[promptTemplateKey] ?? null,
      )
    }
    setSelectedConfigs(nextSelectedConfigs)
  }, [pending, promptTemplates, scenarios])

  const dialog = (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) closeDialog() }}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{pending?.title ?? '选择本次 AI 配置'}</DialogTitle>
          <DialogDescription>
            {pending?.description ?? '每次生成前都可以调整模型和提示词；确认后本入口下次会默认使用这份配置。'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {currentEntries.map(({ entry, scenario, recentConfig, promptTemplate }) => {
            const selectedConfig = selectedConfigs[entry.scenarioKey]
            const selectedModel = selectedConfig?.model?.trim() || ''
            const selectedModelMeta =
              scenario?.available_models.find((item) => item.key === selectedModel) ?? null
            return (
              <div
                key={entry.scenarioKey}
                className="grid gap-4 rounded-3xl border border-border/60 bg-muted/10 p-4 lg:grid-cols-[320px_minmax(0,1fr)]"
              >
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      {entry.label || scenario?.label || entry.scenarioKey}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.description
                        || scenario?.description
                        || '本次请求会直接使用这份配置。'}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-background/70 p-3 text-xs text-muted-foreground">
                    {scenario ? (
                      <>
                        <div>场景默认模型：{scenario.default_model}</div>
                        <div>场景默认思考：{scenario.default_thinking_enabled ? '开启' : '关闭'}</div>
                        <div>提示词模板：{SCENARIO_PROMPT_TEMPLATE_KEYS[entry.scenarioKey] || '未绑定'}</div>
                      </>
                    ) : loading ? '正在加载场景配置...' : '未找到场景配置。'}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor={`ai-runtime-model-${entry.scenarioKey}`} className="text-sm font-medium">
                      本次模型
                    </label>
                    <select
                      id={`ai-runtime-model-${entry.scenarioKey}`}
                      value={selectedModel}
                      onChange={(event) => {
                        const nextModel = event.target.value
                        const nextMeta =
                          scenario?.available_models.find((item) => item.key === nextModel) ?? null
                        updateScenarioConfig(entry.scenarioKey, (current) => ({
                          ...current,
                          model: nextModel,
                          thinking_enabled: nextMeta?.supports_thinking
                            ? Boolean(current?.thinking_enabled)
                            : false,
                        }))
                      }}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {(scenario?.available_models ?? []).map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label} · {item.provider}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedModelMeta?.supports_thinking ? (
                    <label className="flex items-center justify-between rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-sm">
                      <span>思考模式</span>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedConfig?.thinking_enabled)}
                        onChange={(event) => {
                          updateScenarioConfig(entry.scenarioKey, (current) => ({
                            ...current,
                            model: current?.model,
                            thinking_enabled: event.target.checked,
                          }))
                        }}
                        className="h-4 w-4"
                      />
                    </label>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/60 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                      当前模型不支持思考模式。
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => applyScenarioDefault(entry.scenarioKey)}>
                      恢复默认
                    </Button>
                    {recentConfig ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => applyScenarioRecentChoice(entry.scenarioKey, entry.entrypointKey)}
                      >
                        恢复最近一次
                      </Button>
                    ) : null}
                  </div>
                </div>

                <label className="grid min-h-[260px] gap-2 text-sm">
                  <span className="font-medium">本次提示词</span>
                  <textarea
                    aria-label="本次提示词"
                    value={selectedConfig?.prompt_override ?? ''}
                    onChange={(event) => {
                      const nextPrompt = event.target.value
                      updateScenarioConfig(entry.scenarioKey, (current) => ({
                        ...current,
                        prompt_override: nextPrompt,
                      }))
                    }}
                    placeholder={promptTemplate?.defaultTemplate || '可填写本次完整系统提示词；留空则使用场景默认模板。'}
                    className="min-h-[220px] resize-y rounded-2xl border border-input bg-background px-4 py-3 font-mono text-xs leading-5"
                  />
                  <span className="text-xs text-muted-foreground">
                    这里会覆盖本次系统提示词；页面里的额外提示词/自然语言提示仍会作为补充要求拼接。
                  </span>
                </label>
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={closeDialog}>
            取消
          </Button>
          <Button type="button" variant="outline" onClick={resetAllToDefaults}>
            重置默认
          </Button>
          <Button
            type="button"
            onClick={() => { void handleConfirm() }}
            disabled={confirming || currentEntries.some(({ entry, scenario }) => {
              const selectedModel = selectedConfigs[entry.scenarioKey]?.model?.trim() || ''
              return !scenario?.available_models.some((item) => item.key === selectedModel)
            })}
          >
            {confirming ? '保存中...' : '开始生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return {
    promptForAiOptions,
    promptForScenarioAiOptions,
    aiRunConfigDialog: dialog,
  }
}
