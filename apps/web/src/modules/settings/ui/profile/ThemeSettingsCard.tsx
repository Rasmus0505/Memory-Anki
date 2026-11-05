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
  { value: 'light', label: '浅色', description: '默认' },
  { value: 'dark', label: '深色', description: '夜间不刺眼' },
  { value: 'system', label: '跟随系统', description: '随系统切换' },
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
        <Label className="sr-only">主题</Label>
        <div className="grid grid-cols-3 gap-2">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setThemePreference(option.value)
                setPreference(option.value)
              }}
              aria-pressed={preference === option.value}
              className={`ma-pressable rounded-lg border px-3 py-2.5 text-left text-sm ${
                preference === option.value
                  ? 'border-primary/50 bg-primary-soft text-primary-strong shadow-[0_0_0_1px_var(--color-primary)]'
                  : 'border-border text-muted-foreground hover:border-foreground/20 hover:bg-accent/60 hover:text-foreground'
              }`}
            >
              <div className="font-medium">{option.label}</div>
              <div className="mt-0.5 text-xs opacity-75">{option.description}</div>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">只对这台设备生效，桌面和手机可以各自设置。</p>
      </CardContent>
    </Card>
  )
}
