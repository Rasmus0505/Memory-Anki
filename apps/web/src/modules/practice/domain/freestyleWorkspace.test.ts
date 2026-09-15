import { describe, expect, it } from 'vitest'
import {
  FREESTYLE_WORKSPACE_PRIMARY,
  FREESTYLE_WORKSPACE_SECONDARY,
  freestyleWorkspaceLabel,
  freestyleWorkspacePath,
  normalizeFreestyleWorkspaceId,
  peerFreestyleWorkspace,
} from './freestyleWorkspace'

describe('freestyleWorkspace', () => {
  it('treats only secondary as the second workspace', () => {
    expect(normalizeFreestyleWorkspaceId(FREESTYLE_WORKSPACE_SECONDARY)).toBe(FREESTYLE_WORKSPACE_SECONDARY)
    expect(normalizeFreestyleWorkspaceId('secondary')).toBe(FREESTYLE_WORKSPACE_SECONDARY)
    expect(normalizeFreestyleWorkspaceId(FREESTYLE_WORKSPACE_PRIMARY)).toBe(FREESTYLE_WORKSPACE_PRIMARY)
    expect(normalizeFreestyleWorkspaceId('primary')).toBe(FREESTYLE_WORKSPACE_PRIMARY)
    expect(normalizeFreestyleWorkspaceId(undefined)).toBe(FREESTYLE_WORKSPACE_PRIMARY)
    expect(normalizeFreestyleWorkspaceId(null)).toBe(FREESTYLE_WORKSPACE_PRIMARY)
    expect(normalizeFreestyleWorkspaceId('other')).toBe(FREESTYLE_WORKSPACE_PRIMARY)
  })

  it('maps each workspace to its route and label', () => {
    expect(freestyleWorkspacePath(FREESTYLE_WORKSPACE_PRIMARY)).toBe('/freestyle')
    expect(freestyleWorkspacePath(FREESTYLE_WORKSPACE_SECONDARY)).toBe('/freestyle-2')
    expect(freestyleWorkspaceLabel(FREESTYLE_WORKSPACE_PRIMARY)).toBe('随心')
    expect(freestyleWorkspaceLabel(FREESTYLE_WORKSPACE_SECONDARY)).toBe('随心 2')
  })

  it('returns the other workspace as the peer', () => {
    expect(peerFreestyleWorkspace(FREESTYLE_WORKSPACE_PRIMARY)).toBe(FREESTYLE_WORKSPACE_SECONDARY)
    expect(peerFreestyleWorkspace(FREESTYLE_WORKSPACE_SECONDARY)).toBe(FREESTYLE_WORKSPACE_PRIMARY)
  })
})
