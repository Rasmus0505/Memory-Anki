import { describe, expect, it } from 'vitest'
import { elementBlocksMindMapWheelPan, mindMapWheelPanDelta } from './mindMapWheelPan'

describe('mind map wheel pan recovery', () => {
  it('treats edit-card drag blockers as still wanting the map to move', () => {
    const card = document.createElement('div')
    card.className = 'nopan'
    const label = document.createElement('span')
    card.appendChild(label)
    expect(elementBlocksMindMapWheelPan(label)).toBe(true)

    const editor = document.createElement('div')
    editor.className = 'nowheel'
    expect(elementBlocksMindMapWheelPan(editor)).toBe(true)

    const pane = document.createElement('div')
    expect(elementBlocksMindMapWheelPan(pane)).toBe(false)
  })

  it('moves the map the same distance React Flow uses on the empty pane', () => {
    expect(mindMapWheelPanDelta({ deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: false }, { mac: false }))
      .toEqual({ x: 0, y: -50 })
    expect(mindMapWheelPanDelta({ deltaX: 40, deltaY: 0, deltaMode: 0, shiftKey: false }, { mac: true }))
      .toEqual({ x: -20, y: 0 })
  })

  it('turns a Windows shift-wheel into a sideways move, like the empty pane', () => {
    expect(mindMapWheelPanDelta({ deltaX: 0, deltaY: 80, deltaMode: 0, shiftKey: true }, { mac: false }))
      .toEqual({ x: -40, y: 0 })
    expect(mindMapWheelPanDelta({ deltaX: 0, deltaY: 80, deltaMode: 0, shiftKey: true }, { mac: true }))
      .toEqual({ x: 0, y: -40 })
  })

  it('scales line-mode notches the same way as the empty pane', () => {
    expect(mindMapWheelPanDelta({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: false }, { mac: false }))
      .toEqual({ x: 0, y: -30 })
  })
})
