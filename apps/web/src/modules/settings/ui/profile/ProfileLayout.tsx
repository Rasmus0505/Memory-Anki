import type { ReactNode } from 'react'
import { PageContainer } from '@/shared/components/layout/PageLayout'
import { PageHeader } from '@/shared/components/layout/PageHeader'
import { ProfileNav } from '@/modules/settings/ui/profile/ProfileNav'

interface ProfileLayoutProps {
  title: string
  description?: string
  children: ReactNode
}

export function ProfileLayout({ title, description, children }: ProfileLayoutProps) {
  return (
    <PageContainer>
      <PageHeader title={title} description={description} />

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
        <aside className="min-w-0 lg:sticky lg:top-6">
          <ProfileNav />
        </aside>
        <main className="flex min-w-0 flex-col gap-4 sm:gap-6">{children}</main>
      </div>
    </PageContainer>
  )
}
