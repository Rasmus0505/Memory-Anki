import { EnglishVocabularyPanel } from '@/modules/english/ui/english/components/EnglishVocabularyPanel'
import { EnglishZoneLayout } from '@/modules/english/ui/english-shell'

export default function EnglishVocabPage() {
  return (
    <EnglishZoneLayout
      zone="vocab"
      title="生词本"
      description="点词查词后加入的生词，听力与阅读共用。"
    >
      <EnglishVocabularyPanel />
    </EnglishZoneLayout>
  )
}
