import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import {
  getStoredThemePreference,
  setThemePreference,
  THEME_UPDATED_EVENT,
  type ThemePreference,
} from '@/shared/theme/themePreference'

const OPTIONS: Array<{ value: ThemePreference; label: string; description: string }> = [
  { value: 'light', label: '浅色', description: '暖色浅底（默认）' },
  { value: 'dark', label: '深色', description: '夜间使用不刺眼' },
  { value: 'system', label: '跟随系统', description: '随操作系统自动切换' },
]

export function ThemeSettingsCard() {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredThemePreference())

  useEffect(() => {
    const sync = () => setPreference(getStoredThemePreference())
    window.addEventListener(THEME_UPDATED_EVENT, sync)
    return () => window.removeEventListener(THEME_UPDATED_EVENT, sync)
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">外观</CardTitle>
      </CardHeader>
      <CardContent>
        <Label className="mb-2 block">主题</Label>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setThemePreference(option.value)
                setPreference(option.value)
              }}
              className={`rounded-lg border px-4 py-2.5 text-left text-sm transition-colors ${
                preference === option.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
            >
              <div className="font-medium">{option.label}</div>
              <div className="text-xs opacity-80">{option.description}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          主题偏好保存在当前设备（localStorage），桌面与手机 PWA 可各自设置。
        </p>
      </CardContent>
    </Card>
  )
}
