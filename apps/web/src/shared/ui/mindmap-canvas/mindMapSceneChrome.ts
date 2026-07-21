/**
 * Generic mind-map frame chrome. Hosts map product modes onto these scenes;
 * the canvas/surface only knows visual scene keys, not business review jargon.
 */
export type MindMapSceneChrome = 'default' | 'edit' | 'review' | 'practice' | 'rating'

export type MindMapSceneMode = 'edit' | 'review' | 'practice' | 'default'

export function resolveMindMapSceneChrome(input: {
  mode?: MindMapSceneMode
  ratingMode?: boolean
}): MindMapSceneChrome {
  if (input.ratingMode) return 'rating'
  if (input.mode === 'edit') return 'edit'
  if (input.mode === 'practice') return 'practice'
  if (input.mode === 'review') return 'review'
  return 'default'
}

export function mindMapSceneChromeClassName(scene: MindMapSceneChrome): string {
  return `memory-anki-mindmap-scene memory-anki-mindmap-scene-${scene}`
}

export function mindMapSceneChromeLabel(scene: MindMapSceneChrome): string | null {
  switch (scene) {
    case 'edit':
      return '编辑'
    case 'review':
      return '复习'
    case 'practice':
      return '练习'
    case 'rating':
      return '评分'
    default:
      return null
  }
}
