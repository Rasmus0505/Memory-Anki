import type { ReactNode } from 'react'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { ProfileNav } from '@/modules/settings/ui/profile/ProfileNav'

interface ProfileLayoutProps {
  title: string
  description?: string
  children: ReactNode
}

export function ProfileLayout({ title, description, children }: ProfileLayoutProps) {
  return (
    <div className="space-y-6">
      <PageIntro title={title} description={description} compact />

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="lg:sticky lg:top-5">
          <ProfileNav />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  )
}
