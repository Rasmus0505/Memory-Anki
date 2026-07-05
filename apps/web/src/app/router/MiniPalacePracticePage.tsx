import { Badge } from '@/shared/components/ui/badge'
import type { MiniPalacePracticeResponse, MiniPalaceSummary } from '@/shared/api/contracts'
import {
  clearMiniPracticeSessionProgressApi,
  getMiniPracticeSessionProgressApi,
  saveMiniPracticeSessionProgressApi,
} from '@/entities/palace/api'
import {
  getPalaceMiniPalaceApi,
} from '@/entities/mini-palace/api'
import {
  PracticeSessionRoute,
  type PracticeProgressSnapshot,
} from '@/app/router/practiceRouteSupport'

interface MiniPracticeData {
  miniPalace: MiniPalaceSummary
  title: string
}

function buildMiniSession(payload: MiniPalacePracticeResponse) {
  const title = `${payload.palace?.title || '未命名宫殿'} / ${payload.item.name}`
  return {
    data: {
      miniPalace: payload.item,
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
    editEditorState: {
      editor_doc: payload.palace?.editor_doc ?? payload.editor_doc,
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    },
  }
}

export default function MiniPalacePracticePage() {
  return (
    <PracticeSessionRoute
      config={{
        prefetchKind: 'mini-practice',
        loadingText: '正在加载训练关卡内容...',
        notFoundText: '未找到可训练的关卡。',
        loadSession: getPalaceMiniPalaceApi,
        loadProgress: getMiniPracticeSessionProgressApi,
        buildSession: buildMiniSession,
        clearProgress: ({ miniPalace }) => clearMiniPracticeSessionProgressApi(miniPalace.id),
        saveProgress: ({ miniPalace }, snapshot: PracticeProgressSnapshot) =>
          saveMiniPracticeSessionProgressApi(miniPalace.id, snapshot),
        pageEyebrow: '训练关卡',
        backTo: '/palaces',
        backLabel: '返回书架',
        renderBadge: ({ miniPalace }: MiniPracticeData, hasResumeProgress) =>
          hasResumeProgress ? (
            <Badge variant="secondary">已接续上次训练</Badge>
          ) : (
            <Badge variant="outline">{miniPalace.node_count} 张</Badge>
          ),
        getFlowKey: ({ miniPalace }, resetVersion) => `mini-practice-${miniPalace.id}-${resetVersion}`,
        getPersistKey: ({ miniPalace }) => `practice:mini:${miniPalace.id}`,
        getStageTarget: ({ miniPalace }) => miniPalace,
        refreshStageTarget: async ({ miniPalace }) =>
          buildMiniSession(await getPalaceMiniPalaceApi(miniPalace.id)),
        completeWithoutStage: async ({ miniPalace }) => {
          await clearMiniPracticeSessionProgressApi(miniPalace.id)
        },
        submitStage: async ({ miniPalace }) => {
          await clearMiniPracticeSessionProgressApi(miniPalace.id)
        },
        flowProps: ({ miniPalace }) => ({
          revealMode: 'mini-checkpoint',
          checkpointNodeUids: miniPalace.node_uids,
        }),
      }}
    />
  )
}
