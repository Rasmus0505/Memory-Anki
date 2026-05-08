import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { cn } from '@/lib/utils'
import { ShellProvider, useShellContext } from '@/components/layout/ShellContext'
import {
  LayoutDashboard,
  BookOpen,
  Brain,
  User,
  ChevronRight,
  FolderTree,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import PalaceList from './pages/PalaceList'
import PalaceEdit from './pages/PalaceEdit'
import Profile, { ProfileBackupsPage, ProfileTimeRecordsPage } from './pages/Profile'
import Knowledge from './pages/Knowledge'
import PalaceView from './pages/PalaceView'
import PalacePractice from './pages/PalacePractice'
import ReviewOverview from './pages/review/ReviewOverview'
import ReviewSession from './pages/review/ReviewSession'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })

const nav = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard },
  { to: '/palaces', label: '记忆宫殿', icon: BookOpen },
  { to: '/knowledge', label: '知识大纲', icon: FolderTree },
  { to: '/review', label: '复习', icon: Brain },
  { to: '/profile', label: '个人中心', icon: User },
]

function SidebarContent() {
  const { pathname } = useLocation()
  const shell = useShellContext()
  const active = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to))
  const compact = shell?.sidebarCollapsed ?? false

  return (
    <>
      <div className={`border-b border-border/70 ${compact ? 'px-2 py-3' : 'px-5 py-5'}`}>
        <NavLink to="/" className={`flex items-center ${compact ? 'justify-center' : 'gap-3'}`}>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-sm">记</div>
          {!compact ? (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">记忆宫殿</div>
            </div>
          ) : null}
        </NavLink>
      </div>

      <nav className={`flex flex-1 flex-col gap-1 ${compact ? 'px-2 py-3' : 'px-3 py-4'}`}>
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={cn(
              'group flex items-center rounded-2xl text-sm font-medium transition-all',
              active(to)
                ? 'bg-primary text-primary-foreground shadow-[0_10px_30px_rgba(15,23,42,0.14)]'
                : 'text-muted-foreground hover:bg-secondary/80 hover:text-foreground',
              compact ? 'justify-center px-2.5 py-2.5' : 'gap-3 px-3.5 py-3'
            )}
          >
            <Icon className="h-4 w-4" />
            {!compact ? <span>{label}</span> : null}
            {!compact ? (
              <ChevronRight
                className={cn(
                  'ml-auto h-4 w-4 transition-transform',
                  active(to) ? 'translate-x-0' : '-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'
                )}
              />
            ) : null}
          </NavLink>
        ))}
      </nav>
    </>
  )
}

function Shell() {
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const compactNav = sidebarCollapsed

  return (
    <ShellProvider value={{ sidebarCollapsed: compactNav, setSidebarCollapsed }}>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.09),_transparent_24%),linear-gradient(180deg,_rgba(248,250,252,0.96),_rgba(255,255,255,1))]">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur lg:hidden">
          <div className="flex h-15 items-center justify-between px-4">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-card text-foreground"
              aria-label="打开导航"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="text-sm font-semibold">记忆宫殿</div>
            <div className="w-10" />
          </div>
        </header>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
              onClick={() => setMobileOpen(false)}
              aria-label="关闭导航遮罩"
            />
            <aside className="relative z-10 flex h-full w-[82vw] max-w-[320px] flex-col border-r border-border/70 bg-background shadow-2xl">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-4">
                <div className="text-sm font-semibold">导航</div>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70"
                  aria-label="关闭导航"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <SidebarContent />
            </aside>
          </div>
        ) : null}

        <aside className={`fixed inset-y-4 left-4 z-20 hidden overflow-hidden rounded-[30px] border border-border/70 bg-background/92 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur lg:flex lg:flex-col transition-all duration-300 ${compactNav ? 'w-[84px]' : 'w-[250px]'}`}>
          <div className={`flex justify-end px-3 pt-3 ${compactNav ? 'pb-1' : 'pb-0'}`}>
            <button
              type="button"
              onClick={() => setSidebarCollapsed(!compactNav)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background/80 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={compactNav ? '展开导航' : '收起导航'}
            >
              {compactNav ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>
          <div className={compactNav ? 'scale-[0.92] origin-top' : ''}>
            <SidebarContent />
          </div>
        </aside>

        <main className={`min-w-0 transition-[padding] duration-300 ${compactNav ? 'lg:pl-[122px]' : 'lg:pl-[282px]'}`}>
          <div className="mx-auto w-full max-w-[1700px] px-3 py-3 sm:px-5 sm:py-5 lg:px-6 lg:py-6 xl:px-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/palaces" element={<PalaceList />} />
              <Route path="/palaces/new" element={<PalaceEdit />} />
              <Route path="/palaces/:id" element={<PalaceView />} />
              <Route path="/palaces/:id/practice" element={<PalacePractice />} />
              <Route path="/palaces/:id/edit" element={<PalaceEdit />} />
              <Route path="/knowledge" element={<Knowledge />} />
              <Route path="/review" element={<ReviewOverview />} />
              <Route path="/review/session/:id" element={<ReviewSession />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/time-records" element={<ProfileTimeRecordsPage />} />
              <Route path="/profile/backups" element={<ProfileBackupsPage />} />
            </Routes>
          </div>
        </main>
      </div>
    </ShellProvider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Shell />
        <Toaster position="bottom-right" richColors />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
