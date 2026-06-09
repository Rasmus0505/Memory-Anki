import {
  createCommitDescriptor,
  createFocusDescriptor,
  createKeyboardDescriptor,
  createMindMapFeedbackDescriptor,
  createPointerDescriptor,
  createRouteDescriptor,
  findInteractiveElement,
  getMindMapFeedbackProfile,
} from '@/shared/feedback/globalFeedbackModel'

describe('globalFeedbackModel', () => {
  it('finds interactive parents from nested content', () => {
    const button = document.createElement('button')
    const span = document.createElement('span')
    button.append(span)

    expect(findInteractiveElement(span)).toBe(button)
  })

  it('describes pointer click on a link as navigation', () => {
    const link = document.createElement('a')
    link.href = '/review'

    expect(createPointerDescriptor(link, 'click')).toMatchObject({
      audioEvent: 'navigation',
      visualKind: 'navigation',
      label: 'GO',
    })
  })

  it('describes checkbox commit with on-state feedback', () => {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = true

    expect(createCommitDescriptor(checkbox)).toMatchObject({
      audioEvent: 'toggle_on',
      visualKind: 'toggle',
      label: 'ON',
    })
  })

  it('describes focus on editable fields', () => {
    const input = document.createElement('input')
    input.type = 'text'

    expect(createFocusDescriptor(input)).toMatchObject({
      audioEvent: 'field_focus',
      visualKind: 'focus',
    })
  })

  it('describes command shortcuts separately from normal typing', () => {
    expect(
      createKeyboardDescriptor({
        key: 'k',
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        repeat: false,
      }),
    ).toMatchObject({
      audioEvent: 'shortcut_trigger',
      visualKind: 'shortcut',
      label: 'CMD',
    })

    expect(
      createKeyboardDescriptor({
        key: 'a',
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        repeat: false,
      }),
    ).toMatchObject({
      audioEvent: 'key_press',
      visualKind: 'edit',
      level: 'micro',
    })
  })

  it('keeps firing for IME/process keys and directional keys', () => {
    expect(
      createKeyboardDescriptor({
        key: 'Process',
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        repeat: true,
      }),
    ).toMatchObject({
      audioEvent: 'key_press',
      visualKind: 'edit',
      level: 'micro',
    })

    expect(
      createKeyboardDescriptor({
        key: 'ArrowRight',
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        repeat: false,
      }),
    ).toMatchObject({
      audioEvent: 'shortcut_trigger',
      label: 'MOVE',
    })
  })

  it('creates a route transition descriptor', () => {
    expect(createRouteDescriptor()).toMatchObject({
      audioEvent: 'navigation',
      screenPulse: 'navigation',
      label: 'FLOW',
    })
  })

  it('maps mind map semantic events to layered profiles', () => {
    expect(getMindMapFeedbackProfile('key_press')).toMatchObject({
      level: 'micro',
      origin: 'keyboard',
    })
    expect(createMindMapFeedbackDescriptor('session_complete')).toMatchObject({
      level: 'milestone',
      visualKind: 'reward',
      screenPulse: 'celebration',
    })
  })
})
