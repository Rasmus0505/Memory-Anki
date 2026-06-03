import type { ReactNode } from 'react'
import { ProfileNav } from '@/features/profile/ProfileNav'

interface ProfileLayoutProps {
  title: string
  description?: string
  children: ReactNode
}

export function ProfileLayout({ title, description, children }: ProfileLayoutProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="lg:sticky lg:top-5">
          <ProfileNav />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  )
}
