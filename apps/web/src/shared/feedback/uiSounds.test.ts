import { afterEach, describe, expect, it } from 'vitest'
import { __resetUiSoundsForTests, classifyUiSoundTarget, installUiSounds, playUiSound, uiSoundsAllowed } from './uiSounds'

function mount(html: string) {
  document.body.innerHTML = html
  return document.body
}

afterEach(() => {
  document.body.innerHTML = ''
  __resetUiSoundsForTests()
})

describe('classifyUiSoundTarget', () => {
  it('knocks wood for buttons, softer for tabs and menu items', () => {
    mount('<button id="b"><span id="inner">save</span></button><div role="tab" id="t"></div><div role="menuitem" id="m"></div>')
    expect(classifyUiSoundTarget(document.getElementById('inner'))).toBe('wood')
    expect(classifyUiSoundTarget(document.getElementById('t'))).toBe('wood-soft')
    expect(classifyUiSoundTarget(document.getElementById('m'))).toBe('wood-soft')
  })

  it('describes the upcoming switch state', () => {
    mount('<button role="switch" aria-checked="false" id="off"></button><button role="switch" aria-checked="true" id="on"></button>')
    expect(classifyUiSoundTarget(document.getElementById('off'))).toBe('toggle-on')
    expect(classifyUiSoundTarget(document.getElementById('on'))).toBe('toggle-off')
  })

  it('stays silent for disabled controls, plain text and the freestyle stage', () => {
    mount('<button disabled id="d"></button><p id="p">text</p><div class="freestyle-stage"><button id="f"></button></div><div data-ui-sound="off"><button id="o"></button></div>')
    for (const id of ['d', 'p', 'f', 'o']) expect(classifyUiSoundTarget(document.getElementById(id))).toBeNull()
  })

  it('honours an explicit data-ui-sound override', () => {
    mount('<a data-ui-sound="paper" id="a">link</a>')
    expect(classifyUiSoundTarget(document.getElementById('a'))).toBe('paper')
  })
})

describe('playUiSound gating', () => {
  it('needs both the master and the interface switch', () => {
    expect(uiSoundsAllowed({ soundEnabled: true, uiSoundEnabled: true })).toBe(true)
    expect(uiSoundsAllowed({ soundEnabled: false, uiSoundEnabled: true })).toBe(false)
    expect(uiSoundsAllowed({ soundEnabled: true, uiSoundEnabled: false })).toBe(false)
  })

  it('rate-limits bursts and respects the installed suppression', () => {
    expect(playUiSound('wood', 1000)).toBe(true)
    expect(playUiSound('wood', 1020)).toBe(false)
    expect(playUiSound('wood', 1100)).toBe(true)
    const uninstall = installUiSounds(() => true)
    expect(playUiSound('wood', 2000)).toBe(false)
    uninstall()
    expect(playUiSound('wood', 3000)).toBe(true)
  })
})
