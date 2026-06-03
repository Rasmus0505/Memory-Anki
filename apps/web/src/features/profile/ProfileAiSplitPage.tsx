import { useEffect, useState, type FormEvent } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
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

export default function ProfileAiSplitPage() {
  const [config, setConfig] = useState<ReviewSettings | null>(null)

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
      mindmap_ai_split_api_key: String(formData.get('mindmap_ai_split_api_key') ?? '').trim(),
      mindmap_ai_split_base_url: String(formData.get('mindmap_ai_split_base_url') ?? '').trim(),
      mindmap_ai_split_model: String(formData.get('mindmap_ai_split_model') ?? '').trim(),
      mindmap_ai_split_temperature: String(formData.get('mindmap_ai_split_temperature') ?? '').trim(),
      mindmap_ai_split_max_children: String(formData.get('mindmap_ai_split_max_children') ?? '').trim(),
      mindmap_ai_split_include_note: formData.get('mindmap_ai_split_include_note') ? 'true' : 'false',
      mindmap_ai_split_custom_instruction: String(formData.get('mindmap_ai_split_custom_instruction') ?? '').trim(),
    }
    const nextConfig = await updateReviewSettingsApi(nextPayload)
    setConfig(nextConfig)
    toast.success('AI 分卡配置已保存')
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
      title="AI分卡配置"
      description="这里管理脑图编辑里的 AI 分卡能力。留空时会按字段回退到服务端环境变量或内置默认值。"
    >
      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              接入配置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="mindmap-ai-split-api-key">API Key</Label>
                <Input
                  id="mindmap-ai-split-api-key"
                  name="mindmap_ai_split_api_key"
                  type="password"
                  defaultValue={config.mindmap_ai_split_api_key}
                  placeholder="留空时回退 DASHSCOPE_API_KEY"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="mindmap-ai-split-base-url">Base URL</Label>
                <Input
                  id="mindmap-ai-split-base-url"
                  name="mindmap_ai_split_base_url"
                  defaultValue={config.mindmap_ai_split_base_url}
                  placeholder="留空时回退 DashScope OpenAI 兼容端点"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="mindmap-ai-split-model">Model</Label>
                <Input
                  id="mindmap-ai-split-model"
                  name="mindmap_ai_split_model"
                  defaultValue={config.mindmap_ai_split_model}
                  placeholder="qwen3.6-flash"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="mindmap-ai-split-temperature">Temperature</Label>
                <Input
                  id="mindmap-ai-split-temperature"
                  name="mindmap_ai_split_temperature"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  defaultValue={config.mindmap_ai_split_temperature}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="mindmap-ai-split-max-children">最大分类数</Label>
                <Input
                  id="mindmap-ai-split-max-children"
                  name="mindmap_ai_split_max_children"
                  type="number"
                  min="1"
                  max="12"
                  defaultValue={config.mindmap_ai_split_max_children}
                />
              </div>

              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="mindmap_ai_split_include_note"
                    defaultChecked={config.mindmap_ai_split_include_note === 'true'}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">把节点备注一起发给模型</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      关闭后只根据节点标题和子树结构做分卡，适合备注里有噪音时使用。
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mindmap-ai-split-custom-instruction">自定义附加说明</Label>
              <Textarea
                id="mindmap-ai-split-custom-instruction"
                name="mindmap_ai_split_custom_instruction"
                defaultValue={config.mindmap_ai_split_custom_instruction}
                rows={6}
                placeholder="例如：优先按考试框架拆分，分类名尽量简短。"
              />
              <p className="text-xs text-muted-foreground">
                这里只会追加在系统约束后面，不会放开底层 JSON 协议模板。
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">当前说明</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>留空时按字段回退到服务端环境变量或内置默认值。</p>
            <p>当前版本的 API Key 仍会写入本地 config 表，不做额外加密存储。</p>
            <p>默认模型预填为 `qwen3.6-flash`，默认端点走 DashScope OpenAI 兼容接口。</p>
          </CardContent>
        </Card>

        <Button type="submit">保存 AI 分卡配置</Button>
      </form>
    </ProfileLayout>
  )
}
