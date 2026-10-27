import { afterEach, describe, expect, it } from 'vitest'
import { isKeyboardOverlayTarget } from './keyboardTargets'

function buttonInside(parent: HTMLElement) {
  const node = document.createElement('button')
  parent.appendChild(node)
  return node
}

function overlay(attrs: Record<string, string>) {
  const node = document.createElement('div')
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  document.body.appendChild(node)
  return node
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('isKeyboardOverlayTarget', () => {
  it('treats a key inside a dialog as the dialog\'s own', () => {
    const dialog = overlay({ role: 'dialog' })

    expect(isKeyboardOverlayTarget(buttonInside(dialog))).toBe(true)
  })

  it('treats a key inside a menu or popper as the overlay\'s own', () => {
    for (const attrs of [
      { role: 'menu' },
      { 'data-radix-popper-content-wrapper': '' },
      { 'data-keyboard-shortcuts-suspended': 'true' },
    ]) {
      const node = overlay(attrs)
      expect(isKeyboardOverlayTarget(buttonInside(node))).toBe(true)
      node.remove()
    }
  })

  it('lets a dialog that hosts its own shortcuts ignore only the dialog boundary', () => {
    const dialog = overlay({ role: 'dialog' })
    expect(isKeyboardOverlayTarget(buttonInside(dialog), { allowDialog: true })).toBe(false)

    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    dialog.appendChild(menu)
    expect(isKeyboardOverlayTarget(buttonInside(menu), { allowDialog: true })).toBe(true)
  })

  it('leaves the normal page surface alone', () => {
    const main = document.createElement('main')
    document.body.appendChild(main)

    expect(isKeyboardOverlayTarget(buttonInside(main))).toBe(false)
  })
})
