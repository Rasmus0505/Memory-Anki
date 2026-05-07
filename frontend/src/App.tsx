import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, BookOpen, Brain, User, ChevronRight, FolderTree
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import PalaceList from './pages/PalaceList'
import PalaceEdit from './pages/PalaceEdit'
import Review from './pages/Review'
import Profile from './pages/Profile'
import Knowledge from './pages/Knowledge'
import PalaceView from './pages/PalaceView'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })

const nav = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard },
  { to: '/palaces', label: '记忆宫殿', icon: BookOpen },
  { to: '/knowledge', label: '知识大纲', icon: FolderTree },
  { to: '/review', label: '复习', icon: Brain },
  { to: '/profile', label: '个人中心', icon: User },
]

function Sidebar() {
  const { pathname } = useLocation()
  const active = (to: string) => to === '/' ? pathname === '/' : pathname.startsWith(to)
  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 border-r bg-background">
      <div className="flex h-14 items-center border-b px-6">
        <NavLink to="/" className="flex items-center gap-2 font-semibold text-sm">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">记</div>
          记忆宫殿
        </NavLink>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active(to)
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-secondary-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {active(to) && <ChevronRight className="ml-auto h-4 w-4" />}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-background">
          <Sidebar />
          <main className="pl-56">
            <div className="mx-auto max-w-5xl px-8 py-8">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/palaces" element={<PalaceList />} />
                <Route path="/palaces/new" element={<PalaceEdit />} />
                <Route path="/palaces/:id" element={<PalaceView />} />
                <Route path="/palaces/:id/edit" element={<PalaceEdit />} />
                <Route path="/knowledge" element={<Knowledge />} />
                <Route path="/review" element={<Review />} />
                <Route path="/review/:id" element={<Review />} />
                <Route path="/profile" element={<Profile />} />
              </Routes>
            </div>
          </main>
        </div>
        <Toaster position="bottom-right" richColors />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
