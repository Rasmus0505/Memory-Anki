import { useEffect, useMemo, useState } from 'react'
import { Play, Save, Trash2, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { VoiceCoachSettingsDialog } from '@/features/voice-coach'
import { readVoiceCoachSettings } from '@/features/voice-coach/voiceCoachSettings'
import { synthesizeVoiceCoachApi } from '@/shared/api/modules/voiceCoach'
import type {
  AiModelScenario,
  AiProviderSettings,
} from '@/shared/api/contracts'
import {
  getAiModelScenariosApi,
  updateAiModelScenariosApi,
} from '@/shared/api/modules/profile'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

const CATEGORY_ICONS: Record<string, string> = {
  视觉: '🖼️',
  文本: '📝',
  语音: '🔊',
  翻译: '🌐',
}

interface ProviderDraft {
  baseUrl: string
  apiKeyInput: string
  clearApiKey: boolean
}

function scenarioSupportsThinking(scenario: AiModelScenario, modelKey: string) {
  return Boolean(
    scenario.available_models.find((item) => item.key === modelKey)?.supports_thinking,
  )
}

export function ProfileAiConfigPage() {
  const [scenarios, setScenarios] = useState<AiModelScenario[]>([])
  const [providers, setProviders] = useState<AiProviderSettings[]>([])
  const [modelSelections, setModelSelections] = useState<Record<string, string>>({})
  const [thinkingSelections, setThinkingSelections] = useState<Record<string, boolean>>({})
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({})
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const hydrateState = (response: { scenarios: AiModelScenario[]; providers: AiProviderSettings[] }) => {
    setScenarios(response.scenarios)
    setProviders(response.providers)
    setModelSelections(
      Object.fromEntries(response.scenarios.map((item) => [item.key, item.default_model])),
    )
    setThinkingSelections(
      Object.fromEntries(
        response.scenarios.map((item) => [item.key, Boolean(item.default_thinking_enabled)]),
      ),
    )
    setProviderDrafts(
      Object.fromEntries(
        response.providers.map((item) => [
          item.key,
          {
            baseUrl: item.base_url,
            apiKeyInput: '',
            clearApiKey: false,
          },
        ]),
      ),
    )
  }

  const loadScenarios = async () => {
    setError(null)
    setLoading(true)
    try {
      const response = await getAiModelScenariosApi()
      hydrateState(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载 AI 模型配置，请确认后端服务已启动。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadScenarios()
  }, [])

  const handleScenarioSave = async (scenario: AiModelScenario) => {
    setSavingKeys((current) => ({ ...current, [scenario.key]: true }))
    try {
      const selectedModel = modelSelections[scenario.key] ?? scenario.default_model
      const supportsThinking = scenarioSupportsThinking(scenario, selectedModel)
      const response = await updateAiModelScenariosApi({
        scenario_updates: {
          [scenario.key]: {
            default_model: selectedModel,
            default_thinking_enabled: supportsThinking
              ? Boolean(thinkingSelections[scenario.key])
              : false,
          },
        },
      })
      hydrateState(response)
      toast.success(`${scenario.label} 默认配置已更新`)
    } finally {
      setSavingKeys((current) => ({ ...current, [scenario.key]: false }))
    }
  }

  const handleProviderSave = async (providerKey: string) => {
    setSavingKeys((current) => ({ ...current, [`provider:${providerKey}`]: true }))
    try {
      const draft = providerDrafts[providerKey]
      const provider = providers.find((item) => item.key === providerKey)
      if (!draft || !provider) return
      const providerPayload: Record<string, string> = {
        base_url: draft.baseUrl.trim(),
      }
      if (draft.clearApiKey) {
        providerPayload.api_key = ''
      } else if (draft.apiKeyInput.trim()) {
        providerPayload.api_key = draft.apiKeyInput.trim()
      }
      const response = await updateAiModelScenariosApi({
        provider_updates: {
          [providerKey]: providerPayload,
        },
      })
      hydrateState(response)
      toast.success(`${provider.label} 配置已更新`)
    } finally {
      setSavingKeys((current) => ({ ...current, [`provider:${providerKey}`]: false }))
    }
  }

  const handleTest = async (rethrow = false) => {
    setTesting(true)
    try {
      const response = await synthesizeVoiceCoachApi('session_start')
      const audio = new Audio(response.audio_url)
      audio.volume = readVoiceCoachSettings().volume
      await audio.play()
      toast.success(response.cached ? '已播放缓存语音' : '已合成并播放语音')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '语音测试失败，请检查配置。')
      if (rethrow) throw error
    } finally {
      setTesting(false)
    }
  }

  const categories = useMemo(
    () => [...new Set(scenarios.map((item) => item.category))],
    [scenarios],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32">
        <p className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => { void loadScenarios() }}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">场景默认配置</h2>
          <p className="text-sm text-muted-foreground">
            这里设置每个 AI 场景的全局默认模型和默认思考模式。运行前的临时选择不会覆盖这里。
          </p>
        </div>

        {categories.map((category) => (
          <div key={category} className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              {CATEGORY_ICONS[category] ?? ''} {category}
            </h3>
            {scenarios
              .filter((item) => item.category === category)
              .map((scenario) => {
                const selectedModel = modelSelections[scenario.key] ?? scenario.default_model
                const supportsThinking = scenarioSupportsThinking(scenario, selectedModel)
                const selectedThinking = supportsThinking
                  ? Boolean(thinkingSelections[scenario.key])
                  : false
                const isDirty =
                  selectedModel !== scenario.default_model ||
                  selectedThinking !== Boolean(scenario.default_thinking_enabled)
                const isSaving = Boolean(savingKeys[scenario.key])

                return (
                  <Card key={scenario.key}>
                    <CardHeader className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1.5">
                          <CardTitle className="text-base">{scenario.label}</CardTitle>
                          <p className="max-w-2xl text-sm text-muted-foreground">
                            {scenario.description}
                          </p>
                          {scenario.source_location ? (
                            <p className="font-mono text-xs text-muted-foreground/60">
                              文件：{scenario.source_location}
                            </p>
                          ) : null}
                        </div>
                        <Badge variant="secondary" className="shrink-0">
                          {selectedModel}
                        </Badge>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
                        <div className="space-y-1.5">
                          <label htmlFor={`model-select-${scenario.key}`} className="text-xs font-medium">
                            默认模型
                          </label>
                          <select
                            id={`model-select-${scenario.key}`}
                            value={selectedModel}
                            onChange={(event) => {
                              const nextModel = event.target.value
                              setModelSelections((current) => ({
                                ...current,
                                [scenario.key]: nextModel,
                              }))
                              if (!scenarioSupportsThinking(scenario, nextModel)) {
                                setThinkingSelections((current) => ({
                                  ...current,
                                  [scenario.key]: false,
                                }))
                              }
                            }}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            {scenario.available_models.map((model) => (
                              <option key={model.key} value={model.key}>
                                {model.label} · {model.provider}
                              </option>
                            ))}
                          </select>
                        </div>

                        <label className="flex h-10 items-center justify-between rounded-md border border-input px-3 text-sm">
                          <span>默认思考</span>
                          <input
                            type="checkbox"
                            checked={selectedThinking}
                            disabled={!supportsThinking}
                            onChange={(event) =>
                              setThinkingSelections((current) => ({
                                ...current,
                                [scenario.key]: event.target.checked,
                              }))
                            }
                            className="h-4 w-4"
                          />
                        </label>

                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleScenarioSave(scenario)}
                          disabled={isSaving || !isDirty}
                        >
                          <Save className="mr-2 h-4 w-4" />
                          {isSaving ? '保存中...' : '保存默认'}
                        </Button>
                      </div>

                      {!supportsThinking ? (
                        <p className="text-xs text-muted-foreground">
                          当前模型不支持思考模式，将固定为关闭。
                        </p>
                      ) : null}

                      {scenario.key === 'tts' ? (
                        <div className="flex flex-wrap gap-2 border-t border-border/50 pt-2">
                          <Button type="button" variant="outline" onClick={() => setSettingsOpen(true)}>
                            <Volume2 className="mr-2 h-4 w-4" />
                            语音教练开关
                          </Button>
                          <Button type="button" onClick={() => void handleTest(false)} disabled={testing}>
                            <Play className="mr-2 h-4 w-4" />
                            {testing ? '测试中' : '测试播放'}
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                )
              })}
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Provider 配置</h2>
          <p className="text-sm text-muted-foreground">
            按模型自动切到 DashScope 或 Zhipu，这里集中维护各 Provider 的 API Key 和 Base URL。
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {providers.map((provider) => {
            const draft = providerDrafts[provider.key] ?? {
              baseUrl: provider.base_url,
              apiKeyInput: '',
              clearApiKey: false,
            }
            const isSaving = Boolean(savingKeys[`provider:${provider.key}`])
            const apiKeyDirty = draft.clearApiKey || draft.apiKeyInput.trim().length > 0
            const isDirty = draft.baseUrl.trim() !== provider.base_url || apiKeyDirty

            return (
              <Card key={provider.key}>
                <CardHeader className="space-y-2">
                  <CardTitle className="text-base">{provider.label}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    当前密钥：{provider.has_api_key ? provider.api_key_masked : '未配置'}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor={`provider-base-url-${provider.key}`} className="text-xs font-medium">
                      Base URL
                    </label>
                    <input
                      id={`provider-base-url-${provider.key}`}
                      value={draft.baseUrl}
                      onChange={(event) =>
                        setProviderDrafts((current) => ({
                          ...current,
                          [provider.key]: {
                            ...(current[provider.key] ?? draft),
                            baseUrl: event.target.value,
                          },
                        }))
                      }
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor={`provider-api-key-${provider.key}`} className="text-xs font-medium">
                      API Key
                    </label>
                    <input
                      id={`provider-api-key-${provider.key}`}
                      type="password"
                      value={draft.apiKeyInput}
                      placeholder={provider.api_key_masked || '输入新密钥即可更新'}
                      onChange={(event) =>
                        setProviderDrafts((current) => ({
                          ...current,
                          [provider.key]: {
                            ...(current[provider.key] ?? draft),
                            apiKeyInput: event.target.value,
                            clearApiKey: false,
                          },
                        }))
                      }
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setProviderDrafts((current) => ({
                            ...current,
                            [provider.key]: {
                              ...(current[provider.key] ?? draft),
                              apiKeyInput: '',
                              clearApiKey: true,
                            },
                          }))
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        清空密钥
                      </Button>
                      {draft.clearApiKey ? (
                        <span className="self-center text-xs text-muted-foreground">
                          保存后会移除当前密钥
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleProviderSave(provider.key)}
                    disabled={isSaving || !isDirty}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? '保存中...' : '保存 Provider 配置'}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <VoiceCoachSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onTest={() => handleTest(true)}
      />
    </div>
  )
}
