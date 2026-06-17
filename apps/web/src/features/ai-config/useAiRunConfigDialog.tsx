import * as React from 'react'
import { toast } from '@/shared/feedback/toast'
import type {
  AiModelScenario,
  AiScenarioRuntimeOptionsMap,
  AiRuntimeOptions,
} from '@/shared/api/contracts'
import {
  getAiModelScenariosApi,
  updateAiModelScenariosApi,
} from '@/shared/api/modules/profile'
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

function readRecentAiConfig(entrypointKey: string): AiRuntimeOptions | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`${RECENT_AI_CONFIG_PREFIX}${entrypointKey}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AiRuntimeOptions
    if (!parsed || typeof parsed !== 'object') return null
    return {
      model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : undefined,
      thinking_enabled:
        typeof parsed.thinking_enabled === 'boolean' ? parsed.thinking_enabled : undefined,
    }
  } catch {
    return null
  }
}

function writeRecentAiConfig(entrypointKey: string, value: AiRuntimeOptions) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      `${RECENT_AI_CONFIG_PREFIX}${entrypointKey}`,
      JSON.stringify(value),
    )
  } catch {
    // Ignore local storage failures and keep the current run usable.
  }
}

function buildDefaultAiConfig(scenario: AiModelScenario): AiRuntimeOptions {
  return {
    model: scenario.default_model,
    thinking_enabled: scenario.default_thinking_enabled,
  }
}

function normalizeScenarioAiConfig(
  scenario: AiModelScenario,
  value: AiRuntimeOptions | null | undefined,
): AiRuntimeOptions {
  const fallback = buildDefaultAiConfig(scenario)
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
  }
}

export function useAiRunConfigDialog() {
  const [scenarios, setScenarios] = React.useState<AiModelScenario[]>([])
  const [loading, setLoading] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [pending, setPending] = React.useState<PendingRequest | null>(null)
  const [selectedConfigs, setSelectedConfigs] = React.useState<Record<string, AiRuntimeOptions>>({})

  const pendingEntries = React.useMemo(() => pending?.entries ?? [], [pending])
  const currentEntries = React.useMemo(
    () =>
      pendingEntries.map((entry) => ({
        entry,
        scenario: scenarios.find((item) => item.key === entry.scenarioKey) ?? null,
        recentConfig: readRecentAiConfig(entry.entrypointKey),
      })),
    [pendingEntries, scenarios],
  )

  const loadScenarios = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await getAiModelScenariosApi()
      const nextScenes = response.scenes ?? response.scenarios ?? []
      setScenarios(nextScenes)
      return nextScenes
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
        if (nextScenarios.length === 0) {
          try {
            nextScenarios = await loadScenarios()
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
          const recentConfig = readRecentAiConfig(entry.entrypointKey)
          nextSelectedConfigs[entry.scenarioKey] = normalizeScenarioAiConfig(scenario, recentConfig)
        }
        if (request.entries.length === 0) {
          toast.error('当前入口没有可选择的 AI 场景。')
          resolve(undefined)
          return
        }
        setSelectedConfigs(nextSelectedConfigs)
        setPending({ ...request, resolve })
      }),
    [loadScenarios, scenarios],
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
    const sceneUpdates: Record<string, { default_model: string; default_thinking_enabled: boolean }> = {}
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
        }
        nextPayload[entry.scenarioKey] = payload
        const syncScenarioKeys = Array.from(
          new Set([entry.scenarioKey, ...(entry.syncScenarioKeys ?? [])]),
        )
        for (const sceneKey of syncScenarioKeys) {
          sceneUpdates[sceneKey] = {
            default_model: payload.model || '',
            default_thinking_enabled: payload.thinking_enabled ?? false,
          }
        }
      }
      const response = await updateAiModelScenariosApi({
        scene_updates: sceneUpdates,
      })
      const nextScenes = response.scenes ?? response.scenarios ?? []
      setScenarios(nextScenes)
      for (const entry of pending.entries) {
        const payload = nextPayload[entry.scenarioKey]
        if (payload) {
          writeRecentAiConfig(entry.entrypointKey, payload)
        }
      }
      const syncedSceneLabels = Object.keys(sceneUpdates)
        .map((sceneKey) => nextScenes.find((item) => item.key === sceneKey)?.label ?? sceneKey)
        .join('、')
      toast.success(`已同步 ${syncedSceneLabels} 的默认模型`)
      const resolve = pending.resolve
      setPending(null)
      setSelectedConfigs({})
      resolve(nextPayload)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '同步 AI 默认模型失败。')
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
    setSelectedConfigs((current) => ({
      ...current,
      [scenarioKey]: buildDefaultAiConfig(scenario),
    }))
  }, [scenarios])

  const applyScenarioRecentChoice = React.useCallback(
    (scenarioKey: string, entrypointKey: string) => {
      const scenario = scenarios.find((item) => item.key === scenarioKey)
      if (!scenario) return
      const recentConfig = readRecentAiConfig(entrypointKey)
      if (!recentConfig) return
      setSelectedConfigs((current) => ({
        ...current,
        [scenarioKey]: normalizeScenarioAiConfig(scenario, recentConfig),
      }))
    },
    [scenarios],
  )

  const dialog = (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) closeDialog() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pending?.title ?? '选择本次 AI 配置'}</DialogTitle>
          <DialogDescription>
            {pending?.description ?? '确认后会同步更新该场景的个人主页默认模型，本次请求也会直接使用这份配置。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {currentEntries.map(({ entry, scenario, recentConfig }) => {
            const selectedConfig = selectedConfigs[entry.scenarioKey]
            const selectedModel = selectedConfig?.model?.trim() || ''
            const selectedModelMeta =
              scenario?.available_models.find((item) => item.key === selectedModel) ?? null
            return (
              <div key={entry.scenarioKey} className="space-y-4 rounded-2xl border border-border/60 p-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {entry.label || scenario?.label || entry.scenarioKey}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {entry.description
                      || scenario?.description
                      || '确认后会同步更新该场景的个人主页默认模型，本次请求也会直接使用这份配置。'}
                  </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                  {scenario ? (
                    <>
                      <div>场景默认模型：{scenario.default_model}</div>
                      <div>场景默认思考：{scenario.default_thinking_enabled ? '开启' : '关闭'}</div>
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
                  <label className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
                    <span>思考模式</span>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedConfig?.thinking_enabled)}
                      onChange={(event) => {
                        updateScenarioConfig(entry.scenarioKey, (current) => ({
                          model: current?.model,
                          thinking_enabled: event.target.checked,
                        }))
                      }}
                      className="h-4 w-4"
                    />
                  </label>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    当前模型不支持思考模式。
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => applyScenarioDefault(entry.scenarioKey)}>
                    恢复场景默认
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
            )
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={closeDialog}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => { void handleConfirm() }}
            disabled={confirming || currentEntries.some(({ entry, scenario }) => {
              const selectedModel = selectedConfigs[entry.scenarioKey]?.model?.trim() || ''
              return !scenario?.available_models.some((item) => item.key === selectedModel)
            })}
          >
            {confirming ? '同步中...' : '确认并同步默认'}
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
