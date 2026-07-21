import { Badge } from '@/shared/components/ui/badge'
import type { PalaceSegmentPracticeResponse, PalaceSegmentSummary } from '@/shared/api/contracts'
import {
  clearSegmentPracticeSessionProgressApi,
  getSegmentPracticeSessionProgressApi,
  invalidatePalaceCatalogCache,
  saveSegmentPracticeSessionProgressApi,
} from '@/entities/palace/api'
import { getPalaceSegmentApi, updatePalaceSegmentApi } from '@/entities/palace-segment/api'
import {
  PracticeSessionRoute,
  type PracticeProgressSnapshot,
} from '@/app/router/practiceRouteSupport'

interface SegmentPracticeData {
  segment: PalaceSegmentSummary
  title: string
}

function buildSegmentSession(payload: PalaceSegmentPracticeResponse) {
  const title = `${payload.palace.title} / ${payload.item.name}`
  return {
    data: {
      segment: payload.item,
      title,
    },
    title,
    palaceId: payload.item.palace_id,
    reviewEditorState: {
      editor_doc: payload.editor_doc,
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    },
  }
}

export default function SegmentPracticePage() {
  return (
    <PracticeSessionRoute
      config={{
        prefetchKind: 'segment-practice',
        loadingText: '正在加载学习组训练内容...',
        notFoundText: '未找到可训练的学习组。',
        loadSession: getPalaceSegmentApi,
        loadProgress: getSegmentPracticeSessionProgressApi,
        buildSession: buildSegmentSession,
        clearProgress: ({ segment }) => clearSegmentPracticeSessionProgressApi(segment.id),
        saveProgress: ({ segment }, snapshot: PracticeProgressSnapshot) =>
          saveSegmentPracticeSessionProgressApi(segment.id, snapshot),
        pageEyebrow: '学习组训练',
        backTo: '/palaces',
        backLabel: '返回列表',
        renderBadge: (_data: SegmentPracticeData, hasResumeProgress) =>
          hasResumeProgress ? (
            <Badge variant="secondary">已接续上次训练</Badge>
          ) : (
            <Badge variant="outline">学习组训练</Badge>
          ),
        getFlowKey: ({ segment }, resetVersion) => `${segment.id}-${resetVersion}`,
        getPersistKey: ({ segment }) => `practice:segment:${segment.id}`,
        completePractice: async ({ segment }) => {
          await updatePalaceSegmentApi(segment.id, { needs_practice: false })
          invalidatePalaceCatalogCache()
        },        flowProps: ({ segment }) => ({
          revealMode: 'segment-checkpoint',
          checkpointNodeUids: segment.node_uids,
        }),
      }}
    />
  )
}
