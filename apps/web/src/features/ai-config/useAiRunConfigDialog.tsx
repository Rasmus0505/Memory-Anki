import * as React from 'react'
import { toast } from 'sonner'
import type {
  AiModelScenario,
  AiRuntimeOptions,
} from '@/shared/api/contracts'
import { getAiModelScenariosApi } from '@/shared/api/modules/profile'
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
}

interface PendingRequest extends AiRunConfigRequest {
  resolve: (value: AiRuntimeOptions | undefined) => void
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
  const [pending, setPending] = React.useState<PendingRequest | null>(null)
  const [selectedModel, setSelectedModel] = React.useState('')
  const [thinkingEnabled, setThinkingEnabled] = React.useState(false)

  const currentScenario = React.useMemo(
    () => scenarios.find((item) => item.key === pending?.scenarioKey) ?? null,
    [pending?.scenarioKey, scenarios],
  )
  const selectedModelMeta = React.useMemo(
    () => currentScenario?.available_models.find((item) => item.key === selectedModel) ?? null,
    [currentScenario, selectedModel],
  )
  const recentConfig = React.useMemo(
    () => (pending ? readRecentAiConfig(pending.entrypointKey) : null),
    [pending],
  )

  const loadScenarios = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await getAiModelScenariosApi()
      setScenarios(response.scenarios)
      return response.scenarios
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法加载 AI 运行配置。'
      toast.error(message)
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  const promptForAiOptions = React.useCallback(
    async (request: AiRunConfigRequest) =>
      new Promise<AiRuntimeOptions | undefined>(async (resolve) => {
        let nextScenarios = scenarios
        if (nextScenarios.length === 0) {
          try {
            nextScenarios = await loadScenarios()
          } catch {
            resolve(undefined)
            return
          }
        }
        const scenario = nextScenarios.find((item) => item.key === request.scenarioKey)
        if (!scenario) {
          toast.error('当前入口没有找到对应的 AI 场景配置。')
          resolve(undefined)
          return
        }
        const defaultConfig = buildDefaultAiConfig(scenario)
        setSelectedModel(defaultConfig.model || '')
        setThinkingEnabled(Boolean(defaultConfig.thinking_enabled))
        setPending({ ...request, resolve })
      }),
    [loadScenarios, scenarios],
  )

  React.useEffect(() => {
    if (!pending || !currentScenario) return
    const nextDefault = buildDefaultAiConfig(currentScenario)
    setSelectedModel(nextDefault.model || '')
    setThinkingEnabled(Boolean(nextDefault.thinking_enabled))
  }, [currentScenario, pending])

  const closeDialog = React.useCallback(() => {
    const resolve = pending?.resolve
    setPending(null)
    if (resolve) {
      resolve(undefined)
    }
  }, [pending])

  const handleConfirm = React.useCallback(() => {
    if (!pending || !currentScenario || !selectedModelMeta) {
      closeDialog()
      return
    }
    const payload: AiRuntimeOptions = {
      model: selectedModelMeta.key,
      thinking_enabled: selectedModelMeta.supports_thinking ? thinkingEnabled : false,
    }
    writeRecentAiConfig(pending.entrypointKey, payload)
    const resolve = pending.resolve
    setPending(null)
    resolve(payload)
  }, [closeDialog, currentScenario, pending, selectedModelMeta, thinkingEnabled])

  const applyGlobalDefault = React.useCallback(() => {
    if (!currentScenario) return
    const nextDefault = buildDefaultAiConfig(currentScenario)
    setSelectedModel(nextDefault.model || '')
    setThinkingEnabled(Boolean(nextDefault.thinking_enabled))
  }, [currentScenario])

  const applyRecentChoice = React.useCallback(() => {
    if (!currentScenario || !recentConfig) return
    const normalized = normalizeScenarioAiConfig(currentScenario, recentConfig)
    setSelectedModel(normalized.model || '')
    setThinkingEnabled(Boolean(normalized.thinking_enabled))
  }, [currentScenario, recentConfig])

  const dialog = (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) closeDialog() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{pending?.title ?? '选择本次 AI 配置'}</DialogTitle>
          <DialogDescription>
            {pending?.description ?? '本次运行只影响当前入口，不会改动个人中心里的全局默认。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            {currentScenario ? (
              <>
                <div>场景默认模型：{currentScenario.default_model}</div>
                <div>场景默认思考：{currentScenario.default_thinking_enabled ? '开启' : '关闭'}</div>
              </>
            ) : loading ? '正在加载场景配置...' : '未找到场景配置。'}
          </div>

          <div className="space-y-2">
            <label htmlFor="ai-runtime-model" className="text-sm font-medium">
              本次模型
            </label>
            <select
              id="ai-runtime-model"
              value={selectedModel}
              onChange={(event) => {
                const nextModel = event.target.value
                const nextMeta = currentScenario?.available_models.find((item) => item.key === nextModel) ?? null
                setSelectedModel(nextModel)
                if (!nextMeta?.supports_thinking) {
                  setThinkingEnabled(false)
                }
              }}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {(currentScenario?.available_models ?? []).map((item) => (
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
                checked={thinkingEnabled}
                onChange={(event) => setThinkingEnabled(event.target.checked)}
                className="h-4 w-4"
              />
            </label>
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
              当前模型不支持思考模式。
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={applyGlobalDefault}>
              恢复场景默认
            </Button>
            {recentConfig ? (
              <Button type="button" variant="outline" size="sm" onClick={applyRecentChoice}>
                恢复最近一次
              </Button>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={closeDialog}>
            取消
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!currentScenario || !selectedModelMeta}>
            开始本次运行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return {
    promptForAiOptions,
    aiRunConfigDialog: dialog,
  }
}
