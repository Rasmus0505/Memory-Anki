import { describe, expect, it } from 'vitest'
import {
  mindMapSceneChromeClassName,
  mindMapSceneChromeLabel,
  resolveMindMapSceneChrome,
} from './mindMapSceneChrome'

describe('resolveMindMapSceneChrome', () => {
  it('maps product modes onto frame chrome keys', () => {
    expect(resolveMindMapSceneChrome({ mode: 'edit' })).toBe('edit')
    expect(resolveMindMapSceneChrome({ mode: 'review' })).toBe('review')
    expect(resolveMindMapSceneChrome({ mode: 'practice' })).toBe('practice')
    expect(resolveMindMapSceneChrome({ mode: 'default' })).toBe('default')
    expect(resolveMindMapSceneChrome({})).toBe('default')
  })

  it('elevates rating mode over the host session mode', () => {
    expect(resolveMindMapSceneChrome({ mode: 'review', ratingMode: true })).toBe('rating')
    expect(resolveMindMapSceneChrome({ mode: 'practice', ratingMode: true })).toBe('rating')
    expect(resolveMindMapSceneChrome({ mode: 'edit', ratingMode: true })).toBe('rating')
  })

  it('builds stable class names and Chinese labels', () => {
    expect(mindMapSceneChromeClassName('edit')).toBe(
      'memory-anki-mindmap-scene memory-anki-mindmap-scene-edit',
    )
    expect(mindMapSceneChromeClassName('rating')).toContain('memory-anki-mindmap-scene-rating')
    expect(mindMapSceneChromeLabel('edit')).toBe('编辑')
    expect(mindMapSceneChromeLabel('review')).toBe('复习')
    expect(mindMapSceneChromeLabel('practice')).toBe('练习')
    expect(mindMapSceneChromeLabel('rating')).toBe('评分')
    expect(mindMapSceneChromeLabel('default')).toBeNull()
  })
})
