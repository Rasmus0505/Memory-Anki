import type { MindMapEditorState } from '@/shared/api/contracts'

/**
 * 反馈中心预览用的示例思维导图。
 * 一棵小树：根节点 + 起点分支（两张待回忆卡）+ 终点分支（一张待回忆卡）。
 * 直接喂给 MindMapFrame，配合 useRevealSession 即可走通真实翻卡反馈链路。
 */
export const PREVIEW_EDITOR_STATE: MindMapEditorState = {
  editor_doc: {
    root: {
      data: {
        text: '反馈预览地图',
        uid: 'root',
      },
      children: [
        {
          data: {
            text: '起点分支',
            uid: 'branch-a',
          },
          children: [
            {
              data: {
                text: '待回忆节点 A1',
                uid: 'card-a1',
              },
              children: [],
            },
            {
              data: {
                text: '待回忆节点 A2',
                uid: 'card-a2',
              },
              children: [],
            },
          ],
        },
        {
          data: {
            text: '终点分支',
            uid: 'branch-b',
          },
          children: [
            {
              data: {
                text: '待回忆节点 B1',
                uid: 'card-b1',
              },
              children: [],
            },
          ],
        },
      ],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

export const PREVIEW_EDITOR_TITLE = '反馈预览地图'
