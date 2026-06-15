import { useEffect, useMemo, useState } from 'react'
import { Play, RotateCcw, Save, Trash2, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { VoiceCoachSettingsDialog } from '@/features/voice-coach'
import { readVoiceCoachSettings } from '@/features/voice-coach/voiceCoachSettings'
import { LoadingState } from '@/shared/components/state-placeholders'
import { synthesizeVoiceCoachApi } from '@/shared/api/modules/voiceCoach'
import type {
  AiModelCategory,
  AiModelCatalogItem,
  AiModelSettingsResponse,
  AiProviderKey,
  AiProviderSettings,
  AiSceneBinding,
  AiModelType,
} from '@/shared/api/contracts'
import {
  createOrUpdateAiModelApi,
  deleteAiModelApi,
  getAiModelScenariosApi,
  updateAiModelScenariosApi,
} from '@/shared/api/modules/profile'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { cn } from '@/shared/lib/utils'

interface ProviderDraft {
  baseUrl: string
  apiKeyInput: string
  clearApiKey: boolean
}

interface ModelDraft {
  key: string
  displayName: string
  provider: AiProviderKey
  hasVision: boolean
  supportsThinking: boolean
  supportsTemperature: boolean
}

const MODEL_TYPE_HINTS: Record<AiModelType, string> = {
  llm: '纯文本推理类模型。大语言模型会额外标注是否有视觉能力。',
  vl: '读图 / 读 PDF / OCR / 图文结构识别模型。',
  translation: '课程翻译、句子翻译等专用翻译模型。',
  asr: '音视频转写、字幕识别模型。',
  tts: '语音合成与语音播报模型。',
}

const PROVIDER_SELECT_OPTIONS: Array<{ key: AiProviderKey, label: string }> = [
  { key: 'qwen', label: 'Qwen' },
  { key: 'dashscope', label: 'DashScope' },
  { key: 'zhipu', label: 'Zhipu' },
  { key: 'siliconflow', label: 'SiliconFlow' },
]

function sceneSupportsThinking(scene: AiSceneBinding, modelKey: string) {
  return Boolean(
    scene.available_models.find((item) => item.key === modelKey)?.supports_thinking,
  )
}

function categorySupportsThinking(category: AiModelCategory, modelKey: string) {
  return Boolean(
    category.available_models.find((item) => item.key === modelKey)?.supports_thinking,
  )
}

function buildCategoryHoverText(category: AiModelCategory) {
  return [
    category.description,
    ...category.scene_details.map((scene) => `${scene.label}：${scene.description}`),
  ].join('\n')
}

function buildEmptyModelDraft(modelType: AiModelType): ModelDraft {
  return {
    key: '',
    displayName: '',
    provider: 'qwen',
    hasVision: false,
    supportsThinking: false,
    supportsTemperature: !['asr', 'tts'].includes(modelType),
  }
}

function renderModelCapabilityBadges(model: AiModelCatalogItem) {
  return [
    model.model_type === 'llm' ? (model.has_vision ? '有视觉' : '无视觉') : null,
    model.supports_thinking ? '支持思考' : '不支持思考',
    model.supports_temperature ? '支持温度' : '固定参数',
    model.is_builtin ? '内置' : '自定义',
  ].filter(Boolean) as string[]
}

function renderResolvedLabel(resolved: AiSceneBinding['latest_resolved_model']) {
  if (!resolved) return '暂无实际调用记录'
  return `${resolved.model_label} · ${resolved.provider_label ?? resolved.provider}`
}

export function ProfileAiConfigPage() {
  const [categories, setCategories] = useState<AiModelCategory[]>([])
  const [models, setModels] = useState<AiModelCatalogItem[]>([])
  const [scenes, setScenes] = useState<AiSceneBinding[]>([])
  const [providers, setProviders] = useState<AiProviderSettings[]>([])
  const [modelSelections, setModelSelections] = useState<Record<string, string>>({})
  const [thinkingSelections, setThinkingSelections] = useState<Record<string, boolean>>({})
  const [categoryModelSelections, setCategoryModelSelections] = useState<Record<string, string>>({})
  const [categoryThinkingSelections, setCategoryThinkingSelections] = useState<Record<string, boolean>>({})
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({})
  const [modelDrafts, setModelDrafts] = useState<Record<string, ModelDraft>>({})
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const hydrateState = (response: AiModelSettingsResponse) => {
    const nextCategories = response.categories ?? []
    const nextScenes = response.scenes ?? response.scenarios ?? []
    setCategories(nextCategories)
    setModels(response.models ?? [])
    setScenes(nextScenes)
    setProviders(response.providers ?? [])
    setModelSelections(
      Object.fromEntries(nextScenes.map((item) => [item.key, item.effective_model || item.current_model || item.default_model])),
    )
    setThinkingSelections(
      Object.fromEntries(
        nextScenes.map((item) => [item.key, Boolean(item.effective_thinking_enabled ?? item.current_thinking_enabled)]),
      ),
    )
    setCategoryModelSelections(
      Object.fromEntries(nextCategories.map((item) => [item.key, item.shared_model ?? ''])),
    )
    setCategoryThinkingSelections(
      Object.fromEntries(nextCategories.map((item) => [item.key, Boolean(item.shared_thinking_enabled)])),
    )
    setProviderDrafts(
      Object.fromEntries(
        (response.providers ?? []).map((item) => [
          item.key,
          {
            baseUrl: item.base_url,
            apiKeyInput: '',
            clearApiKey: false,
          },
        ]),
      ),
    )
    setModelDrafts((current) => {
      const next = { ...current }
      for (const category of nextCategories) {
        if (!next[category.key]) {
          next[category.key] = buildEmptyModelDraft(category.key)
        }
      }
      return next
    })
  }

  const loadSettings = async () => {
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
    void loadSettings()
  }, [])

  const groupedModels = useMemo(
    () =>
      Object.fromEntries(
        categories.map((category) => [
          category.key,
          models.filter((item) => item.model_type === category.key),
        ]),
      ) as Record<AiModelType, AiModelCatalogItem[]>,
    [categories, models],
  )

  const groupedScenes = useMemo(
    () =>
      Object.fromEntries(
        categories.map((category) => [
          category.key,
          scenes.filter((item) => item.category_key === category.key),
        ]),
      ) as Record<AiModelType, AiSceneBinding[]>,
    [categories, scenes],
  )

  const configurableProviders = useMemo(
    () =>
      providers.filter((provider, index, items) =>
        items.findIndex((item) =>
          item.api_key_config_key === provider.api_key_config_key
          && item.base_url_config_key === provider.base_url_config_key,
        ) === index),
    [providers],
  )

  const handleCategorySave = async (category: AiModelCategory) => {
    const selectedModel = categoryModelSelections[category.key]?.trim()
    if (!selectedModel) {
      toast.error('请先给这一类选择通用模型。')
      return
    }
    setSavingKeys((current) => ({ ...current, [`category:${category.key}`]: true }))
    try {
      const supportsThinking = categorySupportsThinking(category, selectedModel)
      const response = await updateAiModelScenariosApi({
        category_updates: {
          [category.key]: {
            default_model: selectedModel,
            default_thinking_enabled: supportsThinking
              ? Boolean(categoryThinkingSelections[category.key])
              : false,
            apply_to_scenes: true,
          },
        },
      })
      hydrateState(response)
      toast.success(`${category.label} 通用配置已保存，并已覆盖该类全部场景`)
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '保存分类通用配置失败。')
    } finally {
      setSavingKeys((current) => ({ ...current, [`category:${category.key}`]: false }))
    }
  }

  const handleSceneSave = async (scene: AiSceneBinding) => {
    setSavingKeys((current) => ({ ...current, [scene.key]: true }))
    try {
      const selectedModel = modelSelections[scene.key] ?? scene.effective_model ?? scene.current_model
      const supportsThinking = sceneSupportsThinking(scene, selectedModel)
      const response = await updateAiModelScenariosApi({
        scene_updates: {
          [scene.key]: {
            default_model: selectedModel,
            current_model: selectedModel,
            default_thinking_enabled: supportsThinking
              ? Boolean(thinkingSelections[scene.key])
              : false,
            current_thinking_enabled: supportsThinking
              ? Boolean(thinkingSelections[scene.key])
              : false,
          },
        },
      })
      hydrateState(response)
      toast.success(`${scene.label} 默认模型已更新`)
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '保存场景默认模型失败。')
    } finally {
      setSavingKeys((current) => ({ ...current, [scene.key]: false }))
    }
  }

  const handleRestoreScene = async (scene: AiSceneBinding, category: AiModelCategory) => {
    const sharedModel = category.shared_model?.trim()
    if (!sharedModel) return
    const supportsThinking = categorySupportsThinking(category, sharedModel)
    setSavingKeys((current) => ({ ...current, [`restore:${scene.key}`]: true }))
    try {
      const response = await updateAiModelScenariosApi({
        scene_updates: {
          [scene.key]: {
            default_model: sharedModel,
            current_model: sharedModel,
            default_thinking_enabled: supportsThinking
              ? Boolean(category.shared_thinking_enabled)
              : false,
            current_thinking_enabled: supportsThinking
              ? Boolean(category.shared_thinking_enabled)
              : false,
          },
        },
      })
      hydrateState(response)
      toast.success(`${scene.label} 已恢复为通用配置`)
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '恢复通用配置失败。')
    } finally {
      setSavingKeys((current) => ({ ...current, [`restore:${scene.key}`]: false }))
    }
  }

  const handleProviderSave = async (providerKey: string) => {
    setSavingKeys((current) => ({ ...current, [`provider:${providerKey}`]: true }))
    try {
      const draft = providerDrafts[providerKey]
      const provider = configurableProviders.find((item) => item.key === providerKey)
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
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '保存 Provider 配置失败。')
    } finally {
      setSavingKeys((current) => ({ ...current, [`provider:${providerKey}`]: false }))
    }
  }

  const handleSaveModel = async (categoryKey: AiModelType) => {
    const draft = modelDrafts[categoryKey]
    if (!draft) return
    if (!draft.key.trim()) {
      toast.error('模型 key 不能为空。')
      return
    }
    setSavingKeys((current) => ({ ...current, [`model:${categoryKey}`]: true }))
    try {
      const response = await createOrUpdateAiModelApi({
        key: draft.key.trim(),
        display_name: draft.displayName.trim() || draft.key.trim(),
        provider: draft.provider,
        model_type: categoryKey,
        has_vision: categoryKey === 'llm' ? draft.hasVision : false,
        supports_thinking: draft.supportsThinking,
        supports_temperature: draft.supportsTemperature,
      })
      hydrateState(response)
      setModelDrafts((current) => ({
        ...current,
        [categoryKey]: buildEmptyModelDraft(categoryKey),
      }))
      toast.success('模型目录已保存')
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '保存模型目录失败。')
    } finally {
      setSavingKeys((current) => ({ ...current, [`model:${categoryKey}`]: false }))
    }
  }

  const handleDeleteModel = async (model: AiModelCatalogItem) => {
    const confirmed = window.confirm(`确定删除模型“${model.label}”吗？如果仍被场景绑定，后端会阻止删除。`)
    if (!confirmed) return
    setSavingKeys((current) => ({ ...current, [`delete:${model.key}`]: true }))
    try {
      const response = await deleteAiModelApi(model.key)
      hydrateState(response)
      toast.success(`${model.label} 已删除`)
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '删除模型失败。')
    } finally {
      setSavingKeys((current) => ({ ...current, [`delete:${model.key}`]: false }))
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
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '语音测试失败，请检查配置。')
      if (rethrow) throw nextError
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <LoadingState text="正在加载配置…" />
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32">
        <p className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => { void loadSettings() }}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">模型目录 + 场景绑定</h2>
          <p className="text-sm text-muted-foreground">
            先按模型类型维护目录，再先设这一类的通用配置；只有个别场景需要特殊模型时，再单独覆盖。
          </p>
        </div>

        {categories.map((category) => {
          const categoryModels = groupedModels[category.key] ?? []
          const categoryScenes = groupedScenes[category.key] ?? []
          const draft = modelDrafts[category.key] ?? buildEmptyModelDraft(category.key)
          const modelSaving = Boolean(savingKeys[`model:${category.key}`])
          const sharedModel = categoryModelSelections[category.key] ?? category.shared_model ?? ''
          const sharedSupportsThinking = sharedModel ? categorySupportsThinking(category, sharedModel) : false
          const sharedThinking = sharedSupportsThinking ? Boolean(categoryThinkingSelections[category.key]) : false
          const sharedDirty = category.has_shared_config
            ? sharedModel !== (category.shared_model ?? '')
              || sharedThinking !== Boolean(category.shared_thinking_enabled)
            : Boolean(sharedModel)
          const sharedSaving = Boolean(savingKeys[`category:${category.key}`])

          return (
            <Card key={category.key}>
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base" title={buildCategoryHoverText(category)}>
                      {category.label}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{MODEL_TYPE_HINTS[category.key]}</p>
                  </div>
                  <Badge variant="secondary" title={buildCategoryHoverText(category)}>
                    {categoryScenes.length} 个场景
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">通用配置</h3>
                      <p className="text-xs text-muted-foreground">
                        {category.has_shared_config
                          ? '保存后会把这一类下面所有场景一起替换成这套模型。'
                          : '还没有设置通用配置，下面场景暂时不会标记差异态。'}
                      </p>
                    </div>
                    {category.has_shared_config ? (
                      <Badge variant="secondary">当前通用：{category.shared_model}</Badge>
                    ) : (
                      <Badge variant="outline">未设置通用配置</Badge>
                    )}
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-end">
                    <div className="space-y-1.5">
                      <Label htmlFor={`category-model-${category.key}`}>通用模型</Label>
                      <select
                        id={`category-model-${category.key}`}
                        value={sharedModel}
                        onChange={(event) => {
                          const nextModel = event.target.value
                          setCategoryModelSelections((current) => ({
                            ...current,
                            [category.key]: nextModel,
                          }))
                          if (!categorySupportsThinking(category, nextModel)) {
                            setCategoryThinkingSelections((current) => ({
                              ...current,
                              [category.key]: false,
                            }))
                          }
                        }}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">请选择通用模型</option>
                        {category.available_models.map((model) => (
                          <option key={model.key} value={model.key}>
                            {model.label} · {model.provider_label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 text-sm">
                      <span>通用思考</span>
                      <input
                        type="checkbox"
                        checked={sharedThinking}
                        disabled={!sharedSupportsThinking}
                        onChange={(event) =>
                          setCategoryThinkingSelections((current) => ({
                            ...current,
                            [category.key]: event.target.checked,
                          }))
                        }
                        className="h-4 w-4"
                      />
                    </label>

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleCategorySave(category)}
                      disabled={sharedSaving || !sharedDirty}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {sharedSaving ? '保存中...' : '保存并覆盖全部场景'}
                    </Button>
                  </div>

                  {sharedModel && !sharedSupportsThinking ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      当前通用模型不支持思考模式，这一类场景会统一关闭思考。
                    </p>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">模型目录</h3>
                    <span className="text-xs text-muted-foreground">支持新增、覆盖更新、删除</span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {categoryModels.map((model) => (
                      <div key={model.key} className="rounded-xl border border-border/60 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="font-medium">{model.label}</div>
                            <div className="font-mono text-xs text-muted-foreground">{model.key}</div>
                            <div className="text-xs text-muted-foreground">{model.provider_label}</div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleDeleteModel(model)}
                            disabled={Boolean(savingKeys[`delete:${model.key}`])}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            删除
                          </Button>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {renderModelCapabilityBadges(model).map((item) => (
                            <Badge key={item} variant="secondary">{item}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                    {categoryModels.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                        这一类还没有可用模型。
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-dashed border-border/60 p-4">
                    <div className="mb-3 text-sm font-medium">手动新增或覆盖模型</div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`model-key-${category.key}`}>模型 key</Label>
                        <Input
                          id={`model-key-${category.key}`}
                          value={draft.key}
                          onChange={(event) =>
                            setModelDrafts((current) => ({
                              ...current,
                              [category.key]: { ...(current[category.key] ?? draft), key: event.target.value },
                            }))
                          }
                          placeholder="例如 qwen3.5-flash"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`model-name-${category.key}`}>显示名称</Label>
                        <Input
                          id={`model-name-${category.key}`}
                          value={draft.displayName}
                          onChange={(event) =>
                            setModelDrafts((current) => ({
                              ...current,
                              [category.key]: { ...(current[category.key] ?? draft), displayName: event.target.value },
                            }))
                          }
                          placeholder="留空则默认等于 key"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`model-provider-${category.key}`}>Provider</Label>
                        <select
                          id={`model-provider-${category.key}`}
                          value={draft.provider}
                          onChange={(event) =>
                            setModelDrafts((current) => ({
                              ...current,
                              [category.key]: {
                                ...(current[category.key] ?? draft),
                                provider: event.target.value as AiProviderKey,
                              },
                            }))
                          }
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          {PROVIDER_SELECT_OPTIONS.map((provider) => (
                            <option key={provider.key} value={provider.key}>
                              {provider.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-wrap gap-3 rounded-md border border-input px-3 py-2">
                        {category.key === 'llm' ? (
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={draft.hasVision}
                              onChange={(event) =>
                                setModelDrafts((current) => ({
                                  ...current,
                                  [category.key]: {
                                    ...(current[category.key] ?? draft),
                                    hasVision: event.target.checked,
                                  },
                                }))
                              }
                            />
                            有视觉
                          </label>
                        ) : null}
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={draft.supportsThinking}
                            onChange={(event) =>
                              setModelDrafts((current) => ({
                                ...current,
                                [category.key]: {
                                  ...(current[category.key] ?? draft),
                                  supportsThinking: event.target.checked,
                                },
                              }))
                            }
                          />
                          支持思考
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={draft.supportsTemperature}
                            onChange={(event) =>
                              setModelDrafts((current) => ({
                                ...current,
                                [category.key]: {
                                  ...(current[category.key] ?? draft),
                                  supportsTemperature: event.target.checked,
                                },
                              }))
                            }
                            disabled={['asr', 'tts'].includes(category.key)}
                          />
                          支持温度
                        </label>
                      </div>
                    </div>
                    <div className="mt-3">
                      <Button type="button" size="sm" onClick={() => void handleSaveModel(category.key)} disabled={modelSaving}>
                        <Save className="mr-2 h-4 w-4" />
                        {modelSaving ? '保存中...' : '保存模型目录'}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 border-t border-border/60 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">场景绑定</h3>
                    <span className="text-xs text-muted-foreground">单独配置会用差异态标出来</span>
                  </div>

                  <div className="space-y-3">
                    {categoryScenes.map((scene) => {
                      const selectedModel = modelSelections[scene.key] ?? scene.effective_model
                      const supportsThinking = sceneSupportsThinking(scene, selectedModel)
                      const selectedThinking = supportsThinking
                        ? Boolean(thinkingSelections[scene.key])
                        : false
                      const isDirty =
                        selectedModel !== scene.effective_model
                        || selectedThinking !== Boolean(scene.effective_thinking_enabled)
                      const isSaving = Boolean(savingKeys[scene.key])
                      const isCustomScene = Boolean(category.has_shared_config && !scene.inherits_category_default)

                      return (
                        <div
                          key={scene.key}
                          className={cn(
                            'rounded-xl border p-4 transition-colors',
                            isCustomScene
                              ? 'border-warning/30 bg-warning/5'
                              : 'border-border/60',
                          )}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-medium">{scene.label}</div>
                                {isCustomScene ? <Badge variant="secondary">已单独配置</Badge> : null}
                              </div>
                              <p className="max-w-3xl text-sm text-muted-foreground">{scene.description}</p>
                              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span>当前生效：{scene.effective_model}</span>
                                <span>最近实际调用：{renderResolvedLabel(scene.latest_resolved_model)}</span>
                              </div>
                            </div>
                            <Badge variant="secondary">{scene.key}</Badge>
                          </div>

                          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto_auto] lg:items-end">
                            <div className="space-y-1.5">
                              <Label htmlFor={`scene-model-${scene.key}`}>默认模型</Label>
                              <select
                                id={`scene-model-${scene.key}`}
                                value={selectedModel}
                                onChange={(event) => {
                                  const nextModel = event.target.value
                                  setModelSelections((current) => ({
                                    ...current,
                                    [scene.key]: nextModel,
                                  }))
                                  if (!sceneSupportsThinking(scene, nextModel)) {
                                    setThinkingSelections((current) => ({
                                      ...current,
                                      [scene.key]: false,
                                    }))
                                  }
                                }}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              >
                                {scene.available_models.map((model) => (
                                  <option key={model.key} value={model.key}>
                                    {model.label} · {model.provider_label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <label className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 text-sm">
                              <span>默认思考</span>
                              <input
                                type="checkbox"
                                checked={selectedThinking}
                                disabled={!supportsThinking}
                                onChange={(event) =>
                                  setThinkingSelections((current) => ({
                                    ...current,
                                    [scene.key]: event.target.checked,
                                  }))
                                }
                                className="h-4 w-4"
                              />
                            </label>

                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void handleSceneSave(scene)}
                              disabled={isSaving || !isDirty}
                            >
                              <Save className="mr-2 h-4 w-4" />
                              {isSaving ? '保存中...' : '保存场景默认'}
                            </Button>

                            {category.has_shared_config ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void handleRestoreScene(scene, category)}
                                disabled={Boolean(savingKeys[`restore:${scene.key}`]) || scene.inherits_category_default}
                              >
                                <RotateCcw className="mr-2 h-4 w-4" />
                                恢复通用配置
                              </Button>
                            ) : null}
                          </div>

                          {!supportsThinking ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              当前模型不支持思考模式，这个场景会固定关闭思考。
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>

                  {category.key === 'tts' ? (
                    <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
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
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Provider 配置</h2>
          <p className="text-sm text-muted-foreground">
            DashScope、Zhipu、SiliconFlow 统一在这里维护 API Key 与 Base URL。Qwen 模型会复用 DashScope 配置。
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {configurableProviders.map((provider) => {
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
                    <Label htmlFor={`provider-base-url-${provider.key}`}>Base URL</Label>
                    <Input
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
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`provider-api-key-${provider.key}`}>API Key</Label>
                    <Input
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
