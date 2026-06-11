import { useSearchParams } from 'react-router-dom'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
import { ProfileAiPromptsPage } from '@/features/profile/ProfileAiPromptsPage'
import { ProfileAiConfigPage } from '@/features/profile/ProfileAiConfigPage'
import { cn } from '@/shared/lib/utils'

export default function ProfileAiPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'prompts'

  const tabs = [
    { key: 'prompts', label: '提示词' },
    { key: 'config', label: '配置' },
  ] as const

  return (
    <ProfileLayout
      title="AI 管理"
      description="统一管理 AI 提示词和模型配置。"
    >
      <div className="space-y-6">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSearchParams({ tab: key })}
              className={cn(
                'flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                tab === key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'prompts' ? <ProfileAiPromptsPage /> : <ProfileAiConfigPage />}
      </div>
    </ProfileLayout>
  )
}
