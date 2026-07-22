import { EnglishPatternsPanel } from '@/modules/english/ui/english/components/EnglishPatternsPanel'
import { EnglishZoneLayout } from '@/modules/english/ui/english-shell'

export default function EnglishPatternsPage() {
  return (
    <EnglishZoneLayout
      zone="patterns"
      title="句模"
      description="全局话题句模库。阅读与听力摘句都会写到这里，支持 FSRS 复习。"
    >
      <EnglishPatternsPanel />
    </EnglishZoneLayout>
  )
}
