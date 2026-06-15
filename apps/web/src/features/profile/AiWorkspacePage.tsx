import { useEffect, useMemo, useState } from 'react'
import { Activity, BookCopy, Cable, Eye, Play, RefreshCcw, Save, Search, Trash2, Volume2, Wrench } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { VoiceCoachSettingsDialog } from '@/features/voice-coach'
import { readVoiceCoachSettings } from '@/features/voice-coach/voiceCoachSettings'
import { getAiCallLogApi, listAiCallLogsApi } from '@/shared/api/modules/aiLogs'
import type {
  AiCallLogDetail,
  AiCallLogSummary,
  AiConnectionTestResponse,
  AiModelCategory,
  AiModelCatalogItem,
  AiModelImpactResponse,
  AiModelSettingsResponse,
  AiModelType,
  AiProviderKey,
  AiProviderSettings,
  AiSceneBinding,
} from '@/shared/api/contracts'
import {
  createOrUpdateAiModelApi,
  deleteAiModelApi,
  getAiModelImpactApi,
  getAiModelScenariosApi,
  testAiModelApi,
  testAiProviderApi,
  updateAiModelScenariosApi,
} from '@/shared/api/modules/profile'
import { synthesizeVoiceCoachApi } from '@/shared/api/modules/voiceCoach'
import { LoadingState } from '@/shared/components/state-placeholders'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { cn } from '@/shared/lib/utils'

type WorkspaceTab = 'providers' | 'models' | 'scenes' | 'observability'

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

const WORKSPACE_TABS: Array<{ key: WorkspaceTab, label: string, icon: typeof Cable }> = [
  { key: 'providers', label: 'Providers', icon: Cable },
  { key: 'models', label: '模型目录', icon: BookCopy },
  { key: 'scenes', label: '场景绑定', icon: Wrench },
  { key: 'observability', label: '调用观测', icon: Activity },
]

const PROVIDER_SELECT_OPTIONS: Array<{ key: AiProviderKey, label: string }> = [
  { key: 'qwen', label: 'Qwen' },
  { key: 'dashscope', label: 'DashScope' },
  { key: 'zhipu', label: 'Zhipu' },
  { key: 'siliconflow', label: 'SiliconFlow' },
]

const MODEL_TYPE_OPTIONS: Array<{ key: AiModelType, label: string }> = [
  { key: 'llm', label: '大语言' },
  { key: 'vl', label: 'VL' },
  { key: 'translation', label: '翻译' },
  { key: 'asr', label: 'ASR' },
  { key: 'tts', label: 'TTS' },
]

const MODEL_TYPE_HINTS: Record<AiModelType, string> = {
  llm: '纯文本推理类模型。大语言模型会额外标注是否有视觉能力。',
  vl: '读图 / 读 PDF / OCR / 图文结构识别模型。',
  translation: '课程翻译、句子翻译等专用翻译模型。',
  asr: '音视频转写、字幕识别模型。',
  tts: '语音合成与语音播报模型。',
}

function buildEmptyModelDraft(modelType: AiModelType): ModelDraft {
  return {
    key: '',
    displayName: '',
    provider: 'qwen',
    hasVision: modelType === 'llm' ? false : modelType === 'vl',
    supportsThinking: false,
    supportsTemperature: !['asr', 'tts'].includes(modelType),
  }
}

function normalizeWorkspaceTab(value: string | null): WorkspaceTab {
  if (value === 'providers' || value === 'models' || value === 'scenes' || value === 'observability') return value
  return 'providers'
}

function sceneSupportsThinking(scene: AiSceneBinding, modelKey: string) {
  return Boolean(scene.available_models.find((item) => item.key === modelKey)?.supports_thinking)
}

function categorySupportsThinking(category: AiModelCategory, modelKey: string) {
  return Boolean(category.available_models.find((item) => item.key === modelKey)?.supports_thinking)
}

function formatDateTime(value?: string | null) {
  if (!value) return '暂无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getConnectionStatusTone(provider: AiProviderSettings) {
  if (!provider.has_api_key) return 'border-destructive/40 bg-destructive/5'
  if (provider.last_status === 'error') return 'border-warning/40 bg-warning/5'
  return 'border-border/60 bg-card'
}

function renderModelCapabilityBadges(model: AiModelCatalogItem) {
  return [
    model.provider_label,
    model.model_type_label,
    model.model_type === 'llm' ? (model.has_vision ? '有视觉' : '无视觉') : null,
    model.supports_thinking ? '支持思考' : '不支持思考',
    model.supports_temperature ? '支持温度' : '固定参数',
    model.is_builtin ? '内置' : '自定义',
  ].filter(Boolean) as string[]
}

function stringifyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function AiWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const workspaceTab = normalizeWorkspaceTab(searchParams.get('aiTab'))
  const [categories, setCategories] = useState<AiModelCategory[]>([])
  const [models, setModels] = useState<AiModelCatalogItem[]>([])
  const [scenes, setScenes] = useState<AiSceneBinding[]>([])
  const [providers, setProviders] = useState<AiProviderSettings[]>([])
  const [summary, setSummary] = useState<AiModelSettingsResponse['summary'] | null>(null)
  const [modelSelections, setModelSelections] = useState<Record<string, string>>({})
  const [thinkingSelections, setThinkingSelections] = useState<Record<string, boolean>>({})
  const [categoryModelSelections, setCategoryModelSelections] = useState<Record<string, string>>({})
  const [categoryThinkingSelections, setCategoryThinkingSelections] = useState<Record<string, boolean>>({})
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({})
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [testingVoice, setTestingVoice] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [providerSearch, setProviderSearch] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [modelProviderFilter, setModelProviderFilter] = useState<'all' | AiProviderKey>('all')
  const [modelTypeFilter, setModelTypeFilter] = useState<'all' | AiModelType>('all')
  const [modelOriginFilter, setModelOriginFilter] = useState<'all' | 'builtin' | 'custom'>('all')
  const [modelCapabilityFilter, setModelCapabilityFilter] = useState<'all' | 'thinking' | 'vision'>('all')
  const [newModelType, setNewModelType] = useState<AiModelType>('llm')
  const [modelDraft, setModelDraft] = useState<ModelDraft>(buildEmptyModelDraft('llm'))

  const [currentCategoryKey, setCurrentCategoryKey] = useState<AiModelType>('llm')
  const [sceneSearch, setSceneSearch] = useState('')
  const [sceneProviderFilter, setSceneProviderFilter] = useState<'all' | AiProviderKey>('all')
  const [sceneCustomOnly, setSceneCustomOnly] = useState(false)
  const [batchModel, setBatchModel] = useState('')
  const [batchThinking, setBatchThinking] = useState(false)

  const [impactOpen, setImpactOpen] = useState(false)
  const [impactLoading, setImpactLoading] = useState(false)
  const [impactModel, setImpactModel] = useState<AiModelCatalogItem | null>(null)
  const [impact, setImpact] = useState<AiModelImpactResponse | null>(null)

  const [connectionOpen, setConnectionOpen] = useState(false)
  const [connectionLoading, setConnectionLoading] = useState(false)
  const [connectionTitle, setConnectionTitle] = useState('连接测试')
  const [connectionResult, setConnectionResult] = useState<AiConnectionTestResponse | null>(null)

  const [logFilters, setLogFilters] = useState({
    provider: '',
    model: '',
    feature: '',
    status: '',
  })
  const [logs, setLogs] = useState<AiCallLogSummary[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logDetailOpen, setLogDetailOpen] = useState(false)
  const [logDetailLoading, setLogDetailLoading] = useState(false)
  const [logDetail, setLogDetail] = useState<AiCallLogDetail | null>(null)

  const hydrateState = (response: AiModelSettingsResponse) => {
    const nextCategories = response.categories ?? []
    const nextScenes = response.scenes ?? response.scenarios ?? []
    setCategories(nextCategories)
    setModels(response.models ?? [])
    setScenes(nextScenes)
    setProviders(response.providers ?? [])
    setSummary(response.summary ?? null)
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
    if (!nextCategories.find((item) => item.key === currentCategoryKey) && nextCategories[0]) {
      setCurrentCategoryKey(nextCategories[0].key)
    }
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

  const loadLogs = async (nextFilters = logFilters) => {
    setLogsLoading(true)
    try {
      const response = await listAiCallLogsApi({
        provider: nextFilters.provider || null,
        model: nextFilters.model || null,
        feature: nextFilters.feature || null,
        status: nextFilters.status || null,
        limit: 80,
      })
      setLogs(response.items ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载 AI 调用日志失败。')
    } finally {
      setLogsLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
  }, [])

  useEffect(() => {
    if (workspaceTab === 'observability') {
      void loadLogs()
    }
  }, [workspaceTab])

  const configurableProviders = useMemo(
    () =>
      providers.filter((provider, index, items) =>
        items.findIndex((item) =>
          item.api_key_config_key === provider.api_key_config_key
          && item.base_url_config_key === provider.base_url_config_key,
        ) === index),
    [providers],
  )

  const filteredProviders = useMemo(
    () =>
      configurableProviders.filter((provider) => {
        const query = providerSearch.trim().toLowerCase()
        if (!query) return true
        return `${provider.label} ${provider.key} ${provider.last_model ?? ''}`.toLowerCase().includes(query)
      }),
    [configurableProviders, providerSearch],
  )

  const filteredModels = useMemo(
    () =>
      models.filter((model) => {
        const text = `${model.key} ${model.display_name} ${model.label}`.toLowerCase()
        if (modelSearch.trim() && !text.includes(modelSearch.trim().toLowerCase())) return false
        if (modelProviderFilter !== 'all' && model.provider !== modelProviderFilter) return false
        if (modelTypeFilter !== 'all' && model.model_type !== modelTypeFilter) return false
        if (modelOriginFilter === 'builtin' && !model.is_builtin) return false
        if (modelOriginFilter === 'custom' && model.is_builtin) return false
        if (modelCapabilityFilter === 'thinking' && !model.supports_thinking) return false
        if (modelCapabilityFilter === 'vision' && !model.has_vision) return false
        return true
      }),
    [modelCapabilityFilter, modelOriginFilter, modelProviderFilter, modelSearch, modelTypeFilter, models],
  )

  const groupedScenes = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.key, scenes.filter((item) => item.category_key === category.key)])) as Record<AiModelType, AiSceneBinding[]>,
    [categories, scenes],
  )

  const currentCategory = categories.find((item) => item.key === currentCategoryKey) ?? categories[0] ?? null
  const currentCategoryScenes = currentCategory ? groupedScenes[currentCategory.key] ?? [] : []
  const filteredCurrentScenes = useMemo(
    () =>
      currentCategoryScenes.filter((scene) => {
        const sceneText = `${scene.label} ${scene.description} ${scene.key}`.toLowerCase()
        if (sceneSearch.trim() && !sceneText.includes(sceneSearch.trim().toLowerCase())) return false
        if (sceneCustomOnly && scene.inherits_category_default) return false
        if (sceneProviderFilter !== 'all') {
          const selectedModel = modelSelections[scene.key] ?? scene.effective_model
          const meta = scene.available_models.find((item) => item.key === selectedModel)
          if (meta?.provider !== sceneProviderFilter) return false
        }
        return true
      }),
    [currentCategoryScenes, modelSelections, sceneCustomOnly, sceneProviderFilter, sceneSearch],
  )

  useEffect(() => {
    if (!currentCategory) return
    const firstModel = currentCategory.available_models[0]?.key ?? ''
    setBatchModel(firstModel)
    setBatchThinking(false)
  }, [currentCategory])

  const setWorkspaceTab = (nextTab: WorkspaceTab) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('aiTab', nextTab)
    setSearchParams(nextSearchParams, { replace: true })
  }

  const jumpToObservability = (filters?: Partial<typeof logFilters>) => {
    const nextFilters = {
      provider: filters?.provider ?? '',
      model: filters?.model ?? '',
      feature: filters?.feature ?? '',
      status: filters?.status ?? '',
    }
    setLogFilters(nextFilters)
    setWorkspaceTab('observability')
    void loadLogs(nextFilters)
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
      if (draft.clearApiKey) providerPayload.api_key = ''
      else if (draft.apiKeyInput.trim()) providerPayload.api_key = draft.apiKeyInput.trim()
      const response = await updateAiModelScenariosApi({
        provider_updates: {
          [providerKey]: providerPayload,
        },
      })
      hydrateState(response)
      toast.success(`${provider.label} 配置已更新`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存 Provider 配置失败。')
    } finally {
      setSavingKeys((current) => ({ ...current, [`provider:${providerKey}`]: false }))
    }
  }

  const handleProviderTest = async (provider: AiProviderSettings) => {
    setConnectionTitle(`${provider.label} 连接测试`)
    setConnectionResult(null)
    setConnectionOpen(true)
    setConnectionLoading(true)
    try {
      const result = await testAiProviderApi(provider.key)
      setConnectionResult(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Provider 测试失败。')
      setConnectionOpen(false)
    } finally {
      setConnectionLoading(false)
    }
  }

  const handleCreateModel = async () => {
    if (!modelDraft.key.trim()) {
      toast.error('模型 key 不能为空。')
      return
    }
    setSavingKeys((current) => ({ ...current, 'model:create': true }))
    try {
      const response = await createOrUpdateAiModelApi({
        key: modelDraft.key.trim(),
        display_name: modelDraft.displayName.trim() || modelDraft.key.trim(),
        provider: modelDraft.provider,
        model_type: newModelType,
        has_vision: newModelType === 'llm' ? modelDraft.hasVision : false,
        supports_thinking: modelDraft.supportsThinking,
        supports_temperature: modelDraft.supportsTemperature,
      })
      hydrateState(response)
      setModelDraft(buildEmptyModelDraft(newModelType))
      toast.success('模型目录已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存模型目录失败。')
    } finally {
      setSavingKeys((current) => ({ ...current, 'model:create': false }))
    }
  }

  const handleOpenImpact = async (model: AiModelCatalogItem) => {
    setImpactModel(model)
    setImpact(null)
    setImpactOpen(true)
    setImpactLoading(true)
    try {
      const response = await getAiModelImpactApi(model.key)
      setImpact(response)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载模型影响分析失败。')
      setImpactOpen(false)
    } finally {
      setImpactLoading(false)
    }
  }

  const handleDeleteModel = async () => {
    if (!impactModel || !impact) return
    setSavingKeys((current) => ({ ...current, [`delete:${impactModel.key}`]: true }))
    try {
      const response = await deleteAiModelApi(impactModel.key)
      hydrateState(response)
      setImpactOpen(false)
      toast.success(`${impactModel.label} 已停用`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除模型失败。')
      await handleOpenImpact(impactModel)
    } finally {
      setSavingKeys((current) => ({ ...current, [`delete:${impactModel.key}`]: false }))
    }
  }

  const handleTestModel = async (model: AiModelCatalogItem) => {
    setConnectionTitle(`${model.display_name} 模型测试`)
    setConnectionResult(null)
    setConnectionOpen(true)
    setConnectionLoading(true)
    try {
      const result = await testAiModelApi(model.key)
      setConnectionResult(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '模型测试失败。')
      setConnectionOpen(false)
    } finally {
      setConnectionLoading(false)
    }
  }

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存分类通用配置失败。')
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
            default_thinking_enabled: supportsThinking ? Boolean(thinkingSelections[scene.key]) : false,
            current_thinking_enabled: supportsThinking ? Boolean(thinkingSelections[scene.key]) : false,
          },
        },
      })
      hydrateState(response)
      toast.success(`${scene.label} 默认模型已更新`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存场景默认模型失败。')
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
            default_thinking_enabled: supportsThinking ? Boolean(category.shared_thinking_enabled) : false,
            current_thinking_enabled: supportsThinking ? Boolean(category.shared_thinking_enabled) : false,
          },
        },
      })
      hydrateState(response)
      toast.success(`${scene.label} 已恢复为通用配置`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复通用配置失败。')
    } finally {
      setSavingKeys((current) => ({ ...current, [`restore:${scene.key}`]: false }))
    }
  }

  const handleRestoreCategoryScenes = async (category: AiModelCategory) => {
    const sharedModel = category.shared_model?.trim()
    if (!sharedModel) {
      toast.error('当前分类还没有通用配置。')
      return
    }
    const supportsThinking = categorySupportsThinking(category, sharedModel)
    const updates = Object.fromEntries(
      (groupedScenes[category.key] ?? []).map((scene) => [
        scene.key,
        {
          default_model: sharedModel,
          current_model: sharedModel,
          default_thinking_enabled: supportsThinking ? Boolean(category.shared_thinking_enabled) : false,
          current_thinking_enabled: supportsThinking ? Boolean(category.shared_thinking_enabled) : false,
        },
      ]),
    )
    setSavingKeys((current) => ({ ...current, [`restore-all:${category.key}`]: true }))
    try {
      const response = await updateAiModelScenariosApi({ scene_updates: updates })
      hydrateState(response)
      toast.success(`${category.label} 全部场景已恢复为通用配置`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复全部场景失败。')
    } finally {
      setSavingKeys((current) => ({ ...current, [`restore-all:${category.key}`]: false }))
    }
  }

  const handleApplyBatch = async (category: AiModelCategory) => {
    if (!batchModel) {
      toast.error('请先选择批量模型。')
      return
    }
    const supportsThinking = categorySupportsThinking(category, batchModel)
    const updates = Object.fromEntries(
      filteredCurrentScenes.map((scene) => [
        scene.key,
        {
          default_model: batchModel,
          current_model: batchModel,
          default_thinking_enabled: supportsThinking ? batchThinking : false,
          current_thinking_enabled: supportsThinking ? batchThinking : false,
        },
      ]),
    )
    setSavingKeys((current) => ({ ...current, [`batch:${category.key}`]: true }))
    try {
      const response = await updateAiModelScenariosApi({ scene_updates: updates })
      hydrateState(response)
      toast.success(`已批量更新 ${filteredCurrentScenes.length} 个场景`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '批量更新场景失败。')
    } finally {
      setSavingKeys((current) => ({ ...current, [`batch:${category.key}`]: false }))
    }
  }

  const handleVoiceTest = async (rethrow = false) => {
    setTestingVoice(true)
    try {
      const response = await synthesizeVoiceCoachApi('session_start')
      const audio = new Audio(response.audio_url)
      audio.volume = readVoiceCoachSettings().volume
      await audio.play()
      toast.success(response.cached ? '已播放缓存语音' : '已合成并播放语音')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '语音测试失败，请检查配置。')
      if (rethrow) throw err
    } finally {
      setTestingVoice(false)
    }
  }

  const handleOpenLogDetail = async (logId: string) => {
    setLogDetailOpen(true)
    setLogDetail(null)
    setLogDetailLoading(true)
    try {
      const detail = await getAiCallLogApi(logId)
      setLogDetail(detail)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载日志详情失败。')
      setLogDetailOpen(false)
    } finally {
      setLogDetailLoading(false)
    }
  }

  if (loading) return <LoadingState text="正在加载 AI 管理控制台…" />
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
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Provider 数</div><div className="mt-2 text-2xl font-semibold">{summary?.provider_count ?? configurableProviders.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">活跃模型数</div><div className="mt-2 text-2xl font-semibold">{summary?.active_model_count ?? models.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">场景数</div><div className="mt-2 text-2xl font-semibold">{summary?.scene_count ?? scenes.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">最近成功调用</div><div className="mt-2 text-2xl font-semibold">{summary?.recent_success_call_count ?? 0}</div></CardContent></Card>
      </section>

      <Tabs value={workspaceTab} onValueChange={(value) => setWorkspaceTab(normalizeWorkspaceTab(value))} className="space-y-4">
        <TabsList className="h-auto flex-wrap rounded-2xl border border-border/70 bg-background/90 p-1">
          {WORKSPACE_TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <TabsTrigger key={tab.key} value={tab.key} className="gap-2 rounded-xl px-4 py-2">
                <Icon className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            )
          })}
        </TabsList>

        <TabsContent value="providers" className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="relative min-w-[260px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={providerSearch} onChange={(event) => setProviderSearch(event.target.value)} placeholder="搜索 Provider、最近使用模型…" className="pl-9" />
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            {filteredProviders.map((provider) => {
              const draft = providerDrafts[provider.key] ?? { baseUrl: provider.base_url, apiKeyInput: '', clearApiKey: false }
              const isSaving = Boolean(savingKeys[`provider:${provider.key}`])
              const isDirty = draft.baseUrl.trim() !== provider.base_url || draft.clearApiKey || draft.apiKeyInput.trim().length > 0
              return (
                <Card key={provider.key} className={cn('border', getConnectionStatusTone(provider))}>
                  <CardHeader className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{provider.label}</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">当前密钥：{provider.has_api_key ? provider.api_key_masked : '未配置'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{provider.model_count ?? 0} 个模型</Badge>
                        <Badge variant={provider.last_status === 'error' ? 'destructive' : 'outline'}>
                          {provider.last_status === 'error' ? '最近失败' : '连接状态'}
                        </Badge>
                      </div>
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                      <div>最近调用：{formatDateTime(provider.last_called_at)}</div>
                      <div>最近成功：{formatDateTime(provider.last_success_at)}</div>
                      <div>最近失败：{formatDateTime(provider.last_error_at)}</div>
                      <div>最近模型：{provider.last_model ?? '暂无'}</div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`provider-base-${provider.key}`}>Base URL</Label>
                        <Input
                          id={`provider-base-${provider.key}`}
                          value={draft.baseUrl}
                          onChange={(event) =>
                            setProviderDrafts((current) => ({
                              ...current,
                              [provider.key]: { ...(current[provider.key] ?? draft), baseUrl: event.target.value },
                            }))
                          }
                        />
                        <div className="text-xs text-muted-foreground">来源：{provider.base_url_source ?? 'default'}</div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`provider-key-${provider.key}`}>API Key</Label>
                        <Input
                          id={`provider-key-${provider.key}`}
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
                        <div className="text-xs text-muted-foreground">来源：{provider.api_key_source ?? 'default'}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" onClick={() => void handleProviderSave(provider.key)} disabled={isSaving || !isDirty}>
                        <Save className="mr-2 h-4 w-4" />
                        {isSaving ? '保存中...' : '保存 Provider 配置'}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void handleProviderTest(provider)}>
                        <Play className="mr-2 h-4 w-4" />
                        测试连接
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => jumpToObservability({ provider: provider.key, status: 'error' })}>
                        查看最近错误
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setProviderDrafts((current) => ({
                            ...current,
                            [provider.key]: { ...(current[provider.key] ?? draft), apiKeyInput: '', clearApiKey: true },
                          }))
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        清空密钥
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="models" className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="搜索 key / 显示名…" className="pl-9" />
              </div>
              <select value={modelProviderFilter} onChange={(event) => setModelProviderFilter(event.target.value as 'all' | AiProviderKey)} className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="all">全部 Provider</option>
                {PROVIDER_SELECT_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
              <select value={modelTypeFilter} onChange={(event) => setModelTypeFilter(event.target.value as 'all' | AiModelType)} className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="all">全部类型</option>
                {MODEL_TYPE_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
              <select value={modelOriginFilter} onChange={(event) => setModelOriginFilter(event.target.value as typeof modelOriginFilter)} className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="all">全部来源</option>
                <option value="builtin">仅内置</option>
                <option value="custom">仅自定义</option>
              </select>
              <select value={modelCapabilityFilter} onChange={(event) => setModelCapabilityFilter(event.target.value as typeof modelCapabilityFilter)} className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="all">全部能力</option>
                <option value="thinking">支持思考</option>
                <option value="vision">有视觉</option>
              </select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">新增或覆盖模型</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[140px_repeat(3,minmax(0,1fr))]">
                <select value={newModelType} onChange={(event) => { const nextType = event.target.value as AiModelType; setNewModelType(nextType); setModelDraft(buildEmptyModelDraft(nextType)) }} className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {MODEL_TYPE_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
                <Input value={modelDraft.key} onChange={(event) => setModelDraft((current) => ({ ...current, key: event.target.value }))} placeholder="模型 key" />
                <Input value={modelDraft.displayName} onChange={(event) => setModelDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="显示名称（可选）" />
                <select value={modelDraft.provider} onChange={(event) => setModelDraft((current) => ({ ...current, provider: event.target.value as AiProviderKey }))} className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {PROVIDER_SELECT_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap gap-4 rounded-xl border border-dashed border-border/70 px-4 py-3">
                {newModelType === 'llm' ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={modelDraft.hasVision} onChange={(event) => setModelDraft((current) => ({ ...current, hasVision: event.target.checked }))} />
                    有视觉
                  </label>
                ) : null}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={modelDraft.supportsThinking} onChange={(event) => setModelDraft((current) => ({ ...current, supportsThinking: event.target.checked }))} />
                  支持思考
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={modelDraft.supportsTemperature} disabled={['asr', 'tts'].includes(newModelType)} onChange={(event) => setModelDraft((current) => ({ ...current, supportsTemperature: event.target.checked }))} />
                  支持温度
                </label>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">{MODEL_TYPE_HINTS[newModelType]}</div>
                <Button type="button" size="sm" onClick={() => void handleCreateModel()} disabled={Boolean(savingKeys['model:create'])}>
                  <Save className="mr-2 h-4 w-4" />
                  {savingKeys['model:create'] ? '保存中...' : '保存模型目录'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            {filteredModels.map((model) => (
              <Card key={model.key} className="border-border/70">
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{model.display_name}</CardTitle>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{model.key}</div>
                    </div>
                    <Badge variant={model.last_status === 'error' ? 'destructive' : 'secondary'}>
                      {model.last_status === 'never_used' ? '未调用' : model.last_status ?? '未知'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {renderModelCapabilityBadges(model).map((item) => (
                      <Badge key={item} variant="outline">{item}</Badge>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <div>被场景使用：{model.usage_count ?? 0}</div>
                    <div>最近调用：{formatDateTime(model.last_used_at)}</div>
                  </div>
                  {model.bound_scene_labels?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {model.bound_scene_labels.map((label) => <Badge key={label} variant="secondary">{label}</Badge>)}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">当前没有场景绑定这个模型。</div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void handleTestModel(model)}>
                      <Play className="mr-2 h-4 w-4" />
                      测试模型
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => void handleOpenImpact(model)}>
                      <Eye className="mr-2 h-4 w-4" />
                      查看使用影响
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => jumpToObservability({ model: model.key })}>
                      查看最近调用
                    </Button>
                    <Button type="button" size="sm" variant="destructive" onClick={() => void handleOpenImpact(model)} disabled={Boolean(savingKeys[`delete:${model.key}`])}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      停用模型
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="scenes" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
            <Card>
              <CardHeader><CardTitle className="text-base">分类</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {categories.map((category) => (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => setCurrentCategoryKey(category.key)}
                    className={cn(
                      'w-full rounded-xl border px-3 py-3 text-left transition-colors',
                      currentCategory?.key === category.key ? 'border-primary bg-primary/5' : 'border-border/60',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{category.label}</div>
                      <Badge variant="secondary">{category.scene_count ?? category.scene_keys.length}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{category.custom_scene_count ?? 0} 个单独覆盖</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            {currentCategory ? (
              <div className="space-y-4">
                <Card className="border-primary/20 bg-primary/5">
                  <CardHeader className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">通用配置</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">{currentCategory.description}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {currentCategory.has_shared_config ? <Badge variant="secondary">当前通用：{currentCategory.shared_model}</Badge> : <Badge variant="outline">未设置通用配置</Badge>}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto_auto] lg:items-end">
                      <div className="space-y-1.5">
                        <Label htmlFor={`category-model-${currentCategory.key}`}>通用模型</Label>
                        <select
                          id={`category-model-${currentCategory.key}`}
                          value={categoryModelSelections[currentCategory.key] ?? ''}
                          onChange={(event) => {
                            const nextModel = event.target.value
                            setCategoryModelSelections((current) => ({ ...current, [currentCategory.key]: nextModel }))
                            if (!categorySupportsThinking(currentCategory, nextModel)) {
                              setCategoryThinkingSelections((current) => ({ ...current, [currentCategory.key]: false }))
                            }
                          }}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="">请选择通用模型</option>
                          {currentCategory.available_models.map((model) => <option key={model.key} value={model.key}>{model.label} · {model.provider_label}</option>)}
                        </select>
                      </div>
                      <label className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 text-sm">
                        <span>默认思考</span>
                        <input
                          type="checkbox"
                          checked={Boolean(categoryThinkingSelections[currentCategory.key])}
                          disabled={!categorySupportsThinking(currentCategory, categoryModelSelections[currentCategory.key] ?? '')}
                          onChange={(event) => setCategoryThinkingSelections((current) => ({ ...current, [currentCategory.key]: event.target.checked }))}
                        />
                      </label>
                      <Button type="button" size="sm" onClick={() => void handleCategorySave(currentCategory)} disabled={Boolean(savingKeys[`category:${currentCategory.key}`])}>
                        <Save className="mr-2 h-4 w-4" />
                        {savingKeys[`category:${currentCategory.key}`] ? '保存中...' : '保存并覆盖全部场景'}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void handleRestoreCategoryScenes(currentCategory)} disabled={Boolean(savingKeys[`restore-all:${currentCategory.key}`]) || !currentCategory.has_shared_config}>
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        恢复本类全部场景
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle className="text-base">批量操作与筛选</CardTitle>
                      <Badge variant="secondary">{filteredCurrentScenes.length} / {currentCategoryScenes.length} 个场景</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_180px_140px]">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={sceneSearch} onChange={(event) => setSceneSearch(event.target.value)} placeholder="搜索场景名或说明…" className="pl-9" />
                      </div>
                      <select value={sceneProviderFilter} onChange={(event) => setSceneProviderFilter(event.target.value as 'all' | AiProviderKey)} className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <option value="all">全部 Provider</option>
                        {PROVIDER_SELECT_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                      </select>
                      <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                        <input type="checkbox" checked={sceneCustomOnly} onChange={(event) => setSceneCustomOnly(event.target.checked)} />
                        仅看单独覆盖
                      </label>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-end">
                      <div className="space-y-1.5">
                        <Label htmlFor="batch-model">批量切换到</Label>
                        <select id="batch-model" value={batchModel} onChange={(event) => { const nextModel = event.target.value; setBatchModel(nextModel); if (!categorySupportsThinking(currentCategory, nextModel)) setBatchThinking(false) }} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                          {currentCategory.available_models.map((model) => <option key={model.key} value={model.key}>{model.label} · {model.provider_label}</option>)}
                        </select>
                      </div>
                      <label className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 text-sm">
                        <span>批量思考</span>
                        <input type="checkbox" checked={batchThinking} disabled={!categorySupportsThinking(currentCategory, batchModel)} onChange={(event) => setBatchThinking(event.target.checked)} />
                      </label>
                      <Button type="button" size="sm" onClick={() => void handleApplyBatch(currentCategory)} disabled={Boolean(savingKeys[`batch:${currentCategory.key}`]) || filteredCurrentScenes.length === 0}>
                        <Save className="mr-2 h-4 w-4" />
                        {savingKeys[`batch:${currentCategory.key}`] ? '批量保存中...' : '批量应用到当前筛选'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  {filteredCurrentScenes.map((scene) => {
                    const selectedModel = modelSelections[scene.key] ?? scene.effective_model
                    const supportsThinking = sceneSupportsThinking(scene, selectedModel)
                    const selectedThinking = supportsThinking ? Boolean(thinkingSelections[scene.key]) : false
                    const isDirty = selectedModel !== scene.effective_model || selectedThinking !== Boolean(scene.effective_thinking_enabled)
                    const isSaving = Boolean(savingKeys[scene.key])
                    const isCustomScene = Boolean(currentCategory.has_shared_config && !scene.inherits_category_default)
                    return (
                      <Card key={scene.key} className={cn(isCustomScene ? 'border-warning/40 bg-warning/5' : 'border-border/60')}>
                        <CardContent className="space-y-4 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-medium">{scene.label}</div>
                                {isCustomScene ? <Badge variant="secondary">已单独配置</Badge> : null}
                                {scene.last_status ? <Badge variant={scene.last_status === 'error' ? 'destructive' : 'outline'}>{scene.last_status}</Badge> : null}
                              </div>
                              <p className="text-sm text-muted-foreground">{scene.description}</p>
                              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                <span>当前生效：{scene.effective_model}</span>
                                <span>最近调用：{formatDateTime(scene.last_called_at)}</span>
                                <span>最近真实模型：{scene.resolved_model_label ?? '暂无'}</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline">{scene.key}</Badge>
                              <Button type="button" size="sm" variant="ghost" onClick={() => jumpToObservability({ model: selectedModel })}>
                                查看调用
                              </Button>
                            </div>
                          </div>

                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto_auto] lg:items-end">
                            <div className="space-y-1.5">
                              <Label htmlFor={`scene-model-${scene.key}`}>默认模型</Label>
                              <select
                                id={`scene-model-${scene.key}`}
                                value={selectedModel}
                                onChange={(event) => {
                                  const nextModel = event.target.value
                                  setModelSelections((current) => ({ ...current, [scene.key]: nextModel }))
                                  if (!sceneSupportsThinking(scene, nextModel)) {
                                    setThinkingSelections((current) => ({ ...current, [scene.key]: false }))
                                  }
                                }}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              >
                                {scene.available_models
                                  .filter((model) => sceneProviderFilter === 'all' || model.provider === sceneProviderFilter)
                                  .map((model) => <option key={model.key} value={model.key}>{model.label} · {model.provider_label}</option>)}
                              </select>
                            </div>
                            <label className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 text-sm">
                              <span>默认思考</span>
                              <input type="checkbox" checked={selectedThinking} disabled={!supportsThinking} onChange={(event) => setThinkingSelections((current) => ({ ...current, [scene.key]: event.target.checked }))} />
                            </label>
                            <Button type="button" size="sm" onClick={() => void handleSceneSave(scene)} disabled={isSaving || !isDirty}>
                              <Save className="mr-2 h-4 w-4" />
                              {isSaving ? '保存中...' : '保存场景默认'}
                            </Button>
                            {currentCategory.has_shared_config ? (
                              <Button type="button" size="sm" variant="outline" onClick={() => void handleRestoreScene(scene, currentCategory)} disabled={Boolean(savingKeys[`restore:${scene.key}`]) || scene.inherits_category_default}>
                                <RefreshCcw className="mr-2 h-4 w-4" />
                                恢复通用配置
                              </Button>
                            ) : null}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>

                {currentCategory.key === 'tts' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => setSettingsOpen(true)}>
                      <Volume2 className="mr-2 h-4 w-4" />
                      语音教练开关
                    </Button>
                    <Button type="button" onClick={() => void handleVoiceTest(false)} disabled={testingVoice}>
                      <Play className="mr-2 h-4 w-4" />
                      {testingVoice ? '测试中' : '测试播放'}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="observability" className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
              <Input value={logFilters.provider} onChange={(event) => setLogFilters((current) => ({ ...current, provider: event.target.value }))} placeholder="Provider" />
              <Input value={logFilters.model} onChange={(event) => setLogFilters((current) => ({ ...current, model: event.target.value }))} placeholder="Model" />
              <Input value={logFilters.feature} onChange={(event) => setLogFilters((current) => ({ ...current, feature: event.target.value }))} placeholder="Feature" />
              <select value={logFilters.status} onChange={(event) => setLogFilters((current) => ({ ...current, status: event.target.value }))} className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">全部状态</option>
                <option value="success">success</option>
                <option value="error">error</option>
                <option value="started">started</option>
              </select>
              <Button type="button" onClick={() => void loadLogs()}>
                <Search className="mr-2 h-4 w-4" />
                筛选
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {logsLoading ? <LoadingState text="正在加载调用日志…" /> : null}
            {!logsLoading && logs.length === 0 ? (
              <Card><CardContent className="p-8 text-sm text-muted-foreground">当前没有符合筛选条件的 AI 调用日志。</CardContent></Card>
            ) : null}
            {logs.map((log) => (
              <Card key={log.id} className="border-border/60">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{log.feature}</div>
                      <Badge variant={log.status === 'error' ? 'destructive' : 'secondary'}>{log.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{log.provider}</span>
                      <span>{log.model}</span>
                      <span>{formatDateTime(log.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void handleOpenLogDetail(log.id)}>
                      查看详情
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={impactOpen} onOpenChange={setImpactOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>模型影响分析</DialogTitle>
            <DialogDescription>{impactModel ? `正在查看 ${impactModel.display_name} 的绑定影响。` : '查看模型在当前系统中的使用范围。'}</DialogDescription>
            <DialogClose onClick={() => setImpactOpen(false)} />
          </DialogHeader>
          {impactLoading ? (
            <LoadingState text="正在分析模型影响…" />
          ) : impact ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">场景引用</div><div className="mt-2 text-xl font-semibold">{impact.usage_count}</div></CardContent></Card>
                <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">分类通用引用</div><div className="mt-2 text-xl font-semibold">{impact.category_impacts.length}</div></CardContent></Card>
                <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">是否可删除</div><div className="mt-2 text-xl font-semibold">{impact.can_delete ? '可以' : '不可以'}</div></CardContent></Card>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">场景绑定</div>
                {impact.scene_impacts.length > 0 ? impact.scene_impacts.map((item) => (
                  <div key={item.key} className="rounded-lg border border-border/60 px-3 py-2 text-sm">
                    {item.label} · {item.category_label}
                  </div>
                )) : <div className="text-sm text-muted-foreground">没有场景直接绑定这个模型。</div>}
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">分类通用配置</div>
                {impact.category_impacts.length > 0 ? impact.category_impacts.map((item) => (
                  <div key={item.key} className="rounded-lg border border-border/60 px-3 py-2 text-sm">{item.label}</div>
                )) : <div className="text-sm text-muted-foreground">没有分类把它设为通用模型。</div>}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImpactOpen(false)}>关闭</Button>
            <Button type="button" variant="destructive" onClick={() => void handleDeleteModel()} disabled={!impact?.can_delete || !impactModel || Boolean(savingKeys[`delete:${impactModel?.key ?? ''}`])}>
              <Trash2 className="mr-2 h-4 w-4" />
              {impactModel && savingKeys[`delete:${impactModel.key}`] ? '停用中...' : '确认停用模型'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={connectionOpen} onOpenChange={setConnectionOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{connectionTitle}</DialogTitle>
            <DialogDescription>使用当前配置对目标 Provider / 模型发起一次轻量探测请求。</DialogDescription>
            <DialogClose onClick={() => setConnectionOpen(false)} />
          </DialogHeader>
          {connectionLoading ? (
            <LoadingState text="正在测试连接…" />
          ) : connectionResult ? (
            <div className="space-y-3">
              <div className={cn('rounded-xl border px-4 py-3 text-sm', connectionResult.ok ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5')}>
                <div className="font-medium">{connectionResult.ok ? '测试成功' : '测试失败'}</div>
                <div className="mt-1 text-muted-foreground">Provider：{connectionResult.provider_label ?? connectionResult.provider}</div>
                <div className="text-muted-foreground">模型：{connectionResult.model}</div>
                <div className="text-muted-foreground">延迟：{connectionResult.latency_ms} ms</div>
                <div className="text-muted-foreground">配置来源：{connectionResult.source ?? 'default'}</div>
                {connectionResult.error ? <div className="mt-2 text-destructive">{connectionResult.error}</div> : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={logDetailOpen} onOpenChange={setLogDetailOpen}>
        <DialogContent className="h-[min(88vh,920px)] max-w-[min(92vw,1100px)] overflow-hidden">
          <DialogHeader>
            <DialogTitle>AI 调用详情</DialogTitle>
            <DialogDescription>查看请求、响应、错误和输入工件等完整上下文。</DialogDescription>
            <DialogClose onClick={() => setLogDetailOpen(false)} />
          </DialogHeader>
          {logDetailLoading ? (
            <LoadingState text="正在加载日志详情…" />
          ) : logDetail ? (
            <div className="grid h-full gap-4 overflow-hidden lg:grid-cols-2">
              <div className="space-y-3 overflow-y-auto pr-2">
                <div className="rounded-xl border border-border/60 p-3 text-sm">
                  <div>Feature：{logDetail.feature}</div>
                  <div>Provider：{logDetail.provider}</div>
                  <div>Model：{logDetail.model}</div>
                  <div>Status：{logDetail.status}</div>
                  <div>Created：{formatDateTime(logDetail.created_at)}</div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Prompt</div>
                  <pre className="max-h-64 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">{logDetail.prompt_text || '暂无'}</pre>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Response Text</div>
                  <pre className="max-h-64 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">{logDetail.response_text || '暂无'}</pre>
                </div>
              </div>
              <div className="space-y-3 overflow-y-auto pr-2">
                <div>
                  <div className="mb-2 text-sm font-medium">Request Payload</div>
                  <pre className="max-h-56 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">{stringifyJson(logDetail.request_payload)}</pre>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Response Payload</div>
                  <pre className="max-h-56 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">{stringifyJson(logDetail.response_payload)}</pre>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Error Payload</div>
                  <pre className="max-h-40 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">{stringifyJson(logDetail.error_payload)}</pre>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <VoiceCoachSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onTest={() => handleVoiceTest(true)} />
    </div>
  )
}
