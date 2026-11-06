export const PALACE_EDITOR_DIRECTORY_COLLAPSED_STORAGE_KEY = 'memory_anki.palace_editor_directory_collapsed'

export function isNarrowViewport() {
  return typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(max-width: 767px)').matches)
}
