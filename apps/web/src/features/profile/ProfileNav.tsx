import { HardDriveDownload, Settings } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'

export function ProfileNav() {
  const location = useLocation()
  const currentPath = location.pathname

  const items = [
    { href: '/profile', label: '复习配置与导入导出', icon: Settings },
    { href: '/profile/backups', label: '备份与恢复', icon: HardDriveDownload },
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ href, label, icon: Icon }) => {
        const active = currentPath === href
        return (
          <Link key={href} to={href}>
            <Button variant={active ? 'default' : 'outline'} size="sm">
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </Button>
          </Link>
        )
      })}
    </div>
  )
}
