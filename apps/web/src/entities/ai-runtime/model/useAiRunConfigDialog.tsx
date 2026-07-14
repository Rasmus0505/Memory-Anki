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
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

export interface AiGenerationContextOption {
  id: 'mindmap' | 'quiz' | string
  label: string
  description?: string
  content: string
}

export interface AiRunConfigRequest {
  scenarioKey: string
  entrypointKey: string
  title: string
  description?: string
  syncScenarioKeys?: string[]
  contextOptions?: AiGenerationContextOption[]
}

export interface MultiScenarioEntry {
  scenarioKey: string
  entrypointKey: string
  label?: string
  description?: string
  syncScenarioKeys?: string[]
  contextOptions?: AiGenerationContextOption[]
}

export interface MultiAiRunConfigRequest {
  title: string
  description?: string
  entries: MultiScenarioEntry[]
}

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
        promptScene: promptScenes[entry.scenarioKey] ?? null,
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
      if (nextScenarios.length === 0) {
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
          nextPromptScenes[entry.scenarioKey] ?? null,
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
        }
        const manualOverride = selectedConfig?.prompt_override?.trim() || ''
        const compiled = manualOverride
          ? null
          : await previewAiPromptCompositionApi(entry.scenarioKey, promptOptions)
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

  const applyScenarioDefault = React.useCallback((scenarioKey: string) => {
    const scenario = scenarios.find((item) => item.key === scenarioKey)
    if (!scenario) return
    const promptTemplateKey = getScenarioPromptTemplateKey(scenarioKey) ?? ''
    const promptTemplate = promptTemplates[promptTemplateKey] ?? null
    setSelectedConfigs((current) => ({
      ...current,
      [scenarioKey]: buildDefaultAiConfig(scenario, promptTemplate, promptScenes[scenarioKey] ?? null),
    }))
  }, [promptScenes, promptTemplates, scenarios])

  const applyScenarioRecentChoice = React.useCallback(
    (scenarioKey: string, entrypointKey: string) => {
      const scenario = scenarios.find((item) => item.key === scenarioKey)
      if (!scenario) return
      const recentConfig = readRecentAiConfig(entrypointKey, scenarioKey)
      if (!recentConfig) return
      const promptTemplateKey = getScenarioPromptTemplateKey(scenarioKey) ?? ''
      const promptTemplate = promptTemplates[promptTemplateKey] ?? null
      setSelectedConfigs((current) => ({
        ...current,
        [scenarioKey]: normalizeScenarioAiConfig(
          scenario,
          recentConfig,
          promptTemplate,
          promptScenes[scenarioKey] ?? null,
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
      const promptTemplateKey = getScenarioPromptTemplateKey(entry.scenarioKey) ?? ''
      nextSelectedConfigs[entry.scenarioKey] = buildDefaultAiConfig(
        scenario,
        promptTemplates[promptTemplateKey] ?? null,
        promptScenes[entry.scenarioKey] ?? null,
      )
    }
    setSelectedConfigs(nextSelectedConfigs)
  }, [pending, promptScenes, promptTemplates, scenarios])

  const saveCurrentAsDefault = React.useCallback(async (sceneKey: string) => {
    const selection = selectedConfigs[sceneKey]?.prompt_options
    if (!selection) return
    setSavingDefaults((current) => ({ ...current, [sceneKey]: true }))
    try {
      const saved = await saveAiPromptSceneDefaultApi(sceneKey, {
        block_keys: selection.block_keys ?? [],
        scene_instruction: selection.scene_instruction ?? '',
      })
      setPromptScenes((current) => ({ ...current, [sceneKey]: saved }))
      setSelectedConfigs((current) => ({
        ...current,
        [sceneKey]: {
          ...current[sceneKey],
          prompt_options: {
            block_keys: saved.block_keys,
            scene_instruction: saved.scene_instruction,
            run_instruction: current[sceneKey]?.prompt_options?.run_instruction ?? '',
          },
        },
      }))
      toast.success(`${saved.label} 已设为以后默认`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存场景默认提示词失败。')
    } finally {
      setSavingDefaults((current) => ({ ...current, [sceneKey]: false }))
    }
  }, [selectedConfigs])

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
          {currentEntries.map(({ entry, scenario, recentConfig, promptTemplate, promptScene }) => {
            const selectedConfig = selectedConfigs[entry.scenarioKey]
            const selectedModel = selectedConfig?.model?.trim() || ''
            const selectedModelMeta =
              scenario?.available_models.find((item) => item.key === selectedModel) ?? null
            const enabledContextIds = selectedContexts[entry.scenarioKey] ?? []
            const selection = selectedConfig?.prompt_options ?? {}
            const selectedBlockKeys = selection.block_keys ?? []
            const availableBlocks = promptBlocks.filter((block) => (
              block.is_active
              && (block.applicable_scene_keys.length === 0 || block.applicable_scene_keys.includes(entry.scenarioKey))
            ))
            const localPreview = compileLocalPromptPreview(
              availableBlocks,
              selection,
              promptScene?.recommended_block_keys ?? [],
            )
            const contextCharacters = (entry.contextOptions ?? [])
              .filter((item) => enabledContextIds.includes(item.id))
              .reduce((total, item) => total + item.content.length, 0)
            const estimatedTokens = Math.ceil(
              ((selectedConfig?.prompt_override || localPreview.text).length + contextCharacters) / 1.5,
            )
            const exceedsBudget = estimatedTokens > 24000
            return (
              <div
                key={entry.scenarioKey}
                className="grid gap-4 rounded-lg border border-border/60 bg-muted/10 p-4 lg:grid-cols-[320px_minmax(0,1fr)]"
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
                        <div>提示词模板：{getScenarioPromptTemplateKey(entry.scenarioKey) ?? '未绑定'}</div>
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
                        className="size-4"
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

                <div className="grid min-h-[260px] gap-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">提示词组合</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(savingDefaults[entry.scenarioKey])}
                      onClick={() => { void saveCurrentAsDefault(entry.scenarioKey) }}
                    >
                      {savingDefaults[entry.scenarioKey] ? '保存中...' : '设为以后默认'}
                    </Button>
                  </div>

                  <div className="grid gap-2 rounded-lg border border-border/60 bg-background/70 p-3 sm:grid-cols-2">
                    {availableBlocks.map((block) => (
                      <label key={block.key} className="flex items-start gap-2 rounded-md border bg-background p-2">
                        <input
                          type="checkbox"
                          className="mt-1 size-4"
                          checked={selectedBlockKeys.includes(block.key)}
                          onChange={(event) => {
                            updateScenarioConfig(entry.scenarioKey, (current) => {
                              const currentKeys = current?.prompt_options?.block_keys ?? []
                              return {
                                ...current,
                                prompt_options: {
                                  ...current?.prompt_options,
                                  block_keys: event.target.checked
                                    ? [...currentKeys, block.key]
                                    : currentKeys.filter((key) => key !== block.key),
                                },
                              }
                            })
                          }}
                        />
                        <span>
                          <span className="block font-medium">{block.label}</span>
                          <span className="text-xs text-muted-foreground">{block.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <label className="grid gap-2">
                    <span className="font-medium">场景特殊提示词</span>
                    <textarea
                      aria-label="场景特殊提示词"
                      value={selection.scene_instruction ?? ''}
                      onChange={(event) => {
                        updateScenarioConfig(entry.scenarioKey, (current) => ({
                          ...current,
                          prompt_options: {
                            ...current?.prompt_options,
                            scene_instruction: event.target.value,
                          },
                        }))
                      }}
                      className="min-h-[110px] resize-y rounded-lg border border-input bg-background px-4 py-3 font-mono text-xs leading-5"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="font-medium">本次运行追加要求</span>
                    <textarea
                      aria-label="本次运行追加要求"
                      value={selection.run_instruction ?? ''}
                      onChange={(event) => {
                        updateScenarioConfig(entry.scenarioKey, (current) => ({
                          ...current,
                          prompt_options: {
                            ...current?.prompt_options,
                            run_instruction: event.target.value,
                          },
                        }))
                      }}
                      placeholder="仅影响本次运行，不会写入以后默认。"
                      className="min-h-[80px] resize-y rounded-lg border border-input bg-background px-4 py-3 text-sm"
                    />
                  </label>

                  <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3">
                    <div className="font-medium">最终编译预览</div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-xs leading-5">
                      {selectedConfig?.prompt_override?.trim() || localPreview.text || '当前组合为空。'}
                    </pre>
                    {localPreview.warnings.map((warning) => (
                      <div key={warning} className="text-xs text-amber-600">{warning}</div>
                    ))}
                  </div>

                  <details className="rounded-lg border border-dashed border-border/60 bg-background/60 p-3">
                    <summary className="cursor-pointer text-sm font-medium">完整覆盖（高级兼容）</summary>
                    <textarea
                      aria-label="完整覆盖提示词"
                      value={selectedConfig?.prompt_override ?? ''}
                      onChange={(event) => {
                        updateScenarioConfig(entry.scenarioKey, (current) => ({
                          ...current,
                          prompt_override: event.target.value,
                        }))
                      }}
                      placeholder={promptTemplate?.defaultTemplate || '填写后将绕过提示词块组合。'}
                      className="mt-3 min-h-[140px] w-full resize-y rounded-lg border border-input bg-background px-4 py-3 font-mono text-xs leading-5"
                    />
                    <div className="mt-2 text-xs text-muted-foreground">
                      仅用于兼容旧流程；浏览器不会再把完整覆盖内容保存为以后默认。
                    </div>
                  </details>

                  {(entry.contextOptions ?? []).length > 0 ? (
                    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3">
                      <div className="font-medium">上下文快照</div>
                      {(entry.contextOptions ?? []).map((context) => (
                        <label key={context.id} className="flex items-start gap-2 rounded-md border bg-background/70 p-2">
                          <input
                            type="checkbox"
                            className="mt-1 size-4"
                            checked={enabledContextIds.includes(context.id)}
                            onChange={(event) => {
                              setSelectedContexts((current) => {
                                const ids = current[entry.scenarioKey] ?? []
                                return {
                                  ...current,
                                  [entry.scenarioKey]: event.target.checked
                                    ? [...ids, context.id]
                                    : ids.filter((id) => id !== context.id),
                                }
                              })
                            }}
                          />
                          <span>
                            <span className="block font-medium">{context.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {context.description || `${context.content.length} 字，约 ${Math.ceil(context.content.length / 1.5)} Token`}
                            </span>
                          </span>
                        </label>
                      ))}
                      <div className={exceedsBudget ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                        当前调用包约 {estimatedTokens} Token{exceedsBudget ? '，超过 24000 Token 安全预算，请减少上下文或提示词。' : '。'}
                      </div>
                    </div>
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
          <Button type="button" variant="outline" onClick={resetAllToDefaults}>
            重置默认
          </Button>
          <Button
            type="button"
            onClick={() => { void handleConfirm() }}
            disabled={confirming || currentEntries.some(({ entry, scenario }) => {
              const selectedModel = selectedConfigs[entry.scenarioKey]?.model?.trim() || ''
              const selectedIds = selectedContexts[entry.scenarioKey] ?? []
              const contextCharacters = (entry.contextOptions ?? [])
                .filter((item) => selectedIds.includes(item.id))
                .reduce((total, item) => total + item.content.length, 0)
              const exceedsBudget = Math.ceil(
                ((selectedConfigs[entry.scenarioKey]?.prompt_override ?? '').length + contextCharacters) / 1.5,
              ) > 24000
              return exceedsBudget || !scenario?.available_models.some((item) => item.key === selectedModel)
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

function buildPromptWithContexts(
  prompt: string,
  options: AiGenerationContextOption[],
  selectedIds: string[],
) {
  const selected = options.filter((item) => selectedIds.includes(item.id) && item.content.trim())
  if (selected.length === 0) return prompt
  const contextText = selected
    .map((item) => `【${item.label}】\n${item.content.trim()}`)
    .join('\n\n')
  return `${prompt.trim()}\n\n以下内容是本次运行创建时的只读上下文快照：\n${contextText}`.trim()
}

const PROMPT_LAYER_ORDER: Record<AiPromptBlock['layer'], number> = {
  role: 10,
  task: 20,
  content: 30,
  boundary: 40,
  output: 50,
  quality: 60,
}

function compileLocalPromptPreview(
  blocks: AiPromptBlock[],
  selection: AiPromptRunSelection,
  recommendedBlockKeys: string[],
) {
  const selectedKeys = selection.block_keys ?? []
  const selectedBlocks = blocks
    .filter((block) => selectedKeys.includes(block.key))
    .sort((left, right) => (
      PROMPT_LAYER_ORDER[left.layer] - PROMPT_LAYER_ORDER[right.layer]
      || left.sort_order - right.sort_order
      || left.key.localeCompare(right.key)
    ))
  const parts = selectedBlocks.map((block) => block.template.trim()).filter(Boolean)
  if (selection.scene_instruction?.trim()) parts.push(selection.scene_instruction.trim())
  if (selection.run_instruction?.trim()) {
    parts.push(`本次运行追加要求：\n${selection.run_instruction.trim()}`)
  }
  const text = parts.join('\n\n')
  const warnings = recommendedBlockKeys
    .filter((key) => !selectedKeys.includes(key))
    .map((key) => `已取消推荐提示词块：${key}`)
  if (!text.trim()) warnings.push('最终提示词为空。')
  if (/第一张(?:图片|图像).{0,12}结构图/.test(text) && !text.includes('显式')) {
    warnings.push('检测到未声明的“第一张图是结构图”假设。')
  }
  if (text.includes('不要总结') && /(概括|精简|简洁)/.test(text)) {
    warnings.push('检测到“禁止总结”与“概括/精简”可能冲突。')
  }
  return { text, warnings }
}
