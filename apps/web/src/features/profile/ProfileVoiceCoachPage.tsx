import { useEffect, useState, type FormEvent } from 'react'
import { Play, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
import { VoiceCoachSettingsDialog } from '@/features/voice-coach'
import { readVoiceCoachSettings } from '@/features/voice-coach/voiceCoachSettings'
import { synthesizeVoiceCoachApi } from '@/shared/api/modules/voiceCoach'
import type { ReviewSettings } from '@/shared/api/contracts'
import {
  getReviewSettingsApi,
  updateReviewSettingsApi,
} from '@/shared/api/modules/profile'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'

export default function ProfileVoiceCoachPage() {
  const [config, setConfig] = useState<ReviewSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      const settings = await getReviewSettingsApi()
      setConfig(settings)
    }
    void loadSettings()
  }, [])

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nextPayload: Record<string, string> = {
      flow_voice_api_key: String(formData.get('flow_voice_api_key') ?? '').trim(),
      flow_voice_base_url: String(formData.get('flow_voice_base_url') ?? '').trim(),
      flow_voice_model: String(formData.get('flow_voice_model') ?? '').trim(),
      flow_voice_voice: String(formData.get('flow_voice_voice') ?? '').trim(),
      flow_voice_format: String(formData.get('flow_voice_format') ?? '').trim(),
      flow_voice_sample_rate: String(formData.get('flow_voice_sample_rate') ?? '').trim(),
      flow_voice_instruction: String(formData.get('flow_voice_instruction') ?? '').trim(),
    }
    const nextConfig = await updateReviewSettingsApi(nextPayload)
    setConfig(nextConfig)
    toast.success('语音教练配置已保存')
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

  if (!config) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">
        Loading...
      </div>
    )
  }

  return (
    <ProfileLayout
      title="语音教练配置"
      description="这里管理复习、练习和编辑中的百炼语音提示。"
    >
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setSettingsOpen(true)}>
          <Volume2 className="mr-2 h-4 w-4" />
          语音教练开关
        </Button>
        <Button type="button" onClick={() => void handleTest(false)} disabled={testing}>
          <Play className="mr-2 h-4 w-4" />
          {testing ? '测试中' : '测试播放'}
        </Button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Volume2 className="h-4 w-4" />
              百炼语音接入
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="flow-voice-api-key">API Key</Label>
                <Input
                  id="flow-voice-api-key"
                  name="flow_voice_api_key"
                  type="password"
                  defaultValue={config.flow_voice_api_key}
                  placeholder="留空时回退 DASHSCOPE_API_KEY"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="flow-voice-base-url">Base URL</Label>
                <Input
                  id="flow-voice-base-url"
                  name="flow_voice_base_url"
                  defaultValue={config.flow_voice_base_url}
                  placeholder="留空时使用 https://dashscope.aliyuncs.com/api/v1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="flow-voice-model">Model</Label>
                <Input
                  id="flow-voice-model"
                  name="flow_voice_model"
                  defaultValue={config.flow_voice_model || 'cosyvoice-v3-flash'}
                  placeholder="cosyvoice-v3-flash"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="flow-voice-voice">Voice</Label>
                <Input
                  id="flow-voice-voice"
                  name="flow_voice_voice"
                  defaultValue={config.flow_voice_voice || 'longanyang'}
                  placeholder="longanyang"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="flow-voice-format">格式</Label>
                <Input
                  id="flow-voice-format"
                  name="flow_voice_format"
                  defaultValue={config.flow_voice_format || 'mp3'}
                  placeholder="mp3"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="flow-voice-sample-rate">采样率</Label>
                <Input
                  id="flow-voice-sample-rate"
                  name="flow_voice_sample_rate"
                  type="number"
                  min="8000"
                  defaultValue={config.flow_voice_sample_rate || '24000'}
                  placeholder="24000"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="flow-voice-instruction">音色指令</Label>
              <Textarea
                id="flow-voice-instruction"
                name="flow_voice_instruction"
                defaultValue={config.flow_voice_instruction}
                rows={5}
                placeholder="例如：语速略慢，语气平稳、克制，像安静的学习教练。"
              />
              <p className="text-xs text-muted-foreground">
                留空时不传 instruction；缓存会按指令内容重新生成。
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">当前说明</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>语音教练默认关闭；关闭时前端不会请求合成接口。</p>
            <p>同一模型、音色、短句、指令、格式和采样率会命中后端本地缓存。</p>
            <p>第一版只合成固定短句，不会上传或朗读卡片正文。</p>
          </CardContent>
        </Card>

        <Button type="submit">保存语音配置</Button>
      </form>

      <VoiceCoachSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onTest={() => handleTest(true)}
      />
    </ProfileLayout>
  )
}
