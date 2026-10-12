export type JellyKind = 'pop' | 'press' | 'wobble'

const CLASS_BY_KIND: Record<JellyKind, string> = {
  pop: 'fx-jelly-pop',
  press: 'fx-jelly-press',
  wobble: 'fx-jelly-wobble',
}
const ALL_CLASSES = Object.values(CLASS_BY_KIND)

export function jellyOn(element: Element | null | undefined, kind: JellyKind = 'pop') {
  if (!(element instanceof HTMLElement)) return
  element.classList.remove(...ALL_CLASSES)
  // Reading layout restarts the keyframes when the same class is applied twice in a row.
  void element.offsetWidth
  const cls = CLASS_BY_KIND[kind]
  element.classList.add(cls)
  element.addEventListener('animationend', () => element.classList.remove(cls), { once: true })
}
