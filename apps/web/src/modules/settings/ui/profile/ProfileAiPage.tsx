import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AiWorkspacePage } from '@/modules/settings/ui/profile/AiWorkspacePage'
import { getAiModelScenariosApi } from '@/modules/settings/domain/preferences-entity/api'
import { ProfileAiPromptsPage } from '@/modules/settings/ui/profile/ProfileAiPromptsPage'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import {
  AI_TABS,
  normalizeAiSearchParams,
  resolveAiTab,
  type AiTab,
} from '@/modules/settings/ui/profile/model/ai-tabs'
import { cn } from '@/shared/lib/utils'

export default function ProfileAiPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = resolveAiTab(searchParams)

  useEffect(() => {
    if (!searchParams.has('tab')) {
      void getAiModelScenariosApi()
        .then((response) => {
          const nextTab = response.providers.some((provider) => provider.has_api_key)
            ? 'scenes'
            : 'access'
          setSearchParams(normalizeAiSearchParams(searchParams, nextTab), { replace: true })
        })
        .catch(() => {
          setSearchParams(normalizeAiSearchParams(searchParams, 'access'), { replace: true })
        })
      return
    }
    if (searchParams.get('tab') === tab && !searchParams.has('aiTab')) return
    setSearchParams(normalizeAiSearchParams(searchParams, tab), { replace: true })
  }, [searchParams, setSearchParams, tab])

  const selectTab = (nextTab: AiTab) => {
    setSearchParams(normalizeAiSearchParams(searchParams, nextTab), { replace: true })
  }

  return (
    <ProfileLayout title="AI 管理" description="统一管理接入、模型、场景提示词与运行观测。">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {AI_TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => selectTab(key)}
              className={cn(
                'min-w-24 flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                tab === key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'blocks' ? (
          <ProfileAiPromptsPage view="blocks" />
        ) : tab === 'scenes' ? (
          <div className="space-y-8">
            <AiWorkspacePage activeTab="scenes" />
            <ProfileAiPromptsPage view="scenes" />
          </div>
        ) : (
          <AiWorkspacePage activeTab={tab} />
        )}      </div>
    </ProfileLayout>
  )
}
