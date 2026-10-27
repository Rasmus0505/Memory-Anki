import { Keyboard } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { FlipCardShortcutSettings } from '@/modules/settings/ui/shortcuts/FlipCardShortcutSettings'

/** 偏好页快捷键 tab: the same map the 翻卡设置 → 快捷键 page edits. */
export function MemoryAnkiShortcutsSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Keyboard className="size-4" />
          翻卡快捷键
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FlipCardShortcutSettings />
      </CardContent>
    </Card>
  )
}
