import { useEffect, useState } from 'react'
import { Play, Save, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { VoiceCoachSettingsDialog } from '@/features/voice-coach'
import { readVoiceCoachSettings } from '@/features/voice-coach/voiceCoachSettings'
import { synthesizeVoiceCoachApi } from '@/shared/api/modules/voiceCoach'
import type { AiModelScenario } from '@/shared/api/contracts'
import {
  getAiModelScenariosApi,
  updateAiModelScenariosApi,
} from '@/shared/api/modules/profile'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

const CATEGORY_ICONS: Record<string, string> = {
  '视觉': '🖼️',
  '文本': '📝',
  '语音': '🔊',
  '翻译': '🌐',
}

export function ProfileAiConfigPage() {
  const [scenarios, setScenarios] = useState<AiModelScenario[]>([])
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadScenarios = async () => {
    setError(null)
    setLoading(true)
    try {
      const response = await getAiModelScenariosApi()
      setScenarios(response.scenarios)
      setSelections(
        Object.fromEntries(response.scenarios.map((s) => [s.key, s.current_model])),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载 AI 模型配置，请确认后端服务已启动。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadScenarios()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = async (scenario: AiModelScenario) => {
    setSavingKeys((current) => ({ ...current, [scenario.key]: true }))
    try {
      const response = await updateAiModelScenariosApi({
        [scenario.key]: selections[scenario.key] ?? scenario.current_model,
      })
      setScenarios(response.scenarios)
      setSelections(
        Object.fromEntries(response.scenarios.map((s) => [s.key, s.current_model])),
      )
      toast.success(`${scenario.label} 模型已更新`)
    } finally {
      setSavingKeys((current) => ({ ...current, [scenario.key]: false }))
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

  if (scenarios.length === 0) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
        暂无 AI 模型场景配置
      </div>
    )
  }

  const categories = [...new Set(scenarios.map((s) => s.category))]

  return (
    <div className="space-y-6">
      {categories.map((category) => (
        <div key={category} className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground">
            {CATEGORY_ICONS[category] ?? ''} {category}
          </h3>
          {scenarios
            .filter((s) => s.category === category)
            .map((scenario) => {
              const selectedModel = selections[scenario.key] ?? scenario.current_model
              const isDirty = selectedModel !== scenario.current_model
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
                          <p className="text-xs text-muted-foreground/60 font-mono">
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
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex-1 min-w-[240px] space-y-1.5">
                        <label
                          htmlFor={`model-select-${scenario.key}`}
                          className="text-xs font-medium"
                        >
                          选择模型
                        </label>
                        <select
                          id={`model-select-${scenario.key}`}
                          value={selectedModel}
                          onChange={(e) =>
                            setSelections((current) => ({
                              ...current,
                              [scenario.key]: e.target.value,
                            }))
                          }
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          {scenario.available_models.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                          {!scenario.available_models.includes(selectedModel) ? (
                            <option value={selectedModel}>{selectedModel}</option>
                          ) : null}
                        </select>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleSave(scenario)}
                        disabled={isSaving || !isDirty}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {isSaving ? '保存中...' : '保存'}
                      </Button>
                    </div>

                    {scenario.key === 'tts' ? (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
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

      <VoiceCoachSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onTest={() => handleTest(true)}
      />
    </div>
  )
}
