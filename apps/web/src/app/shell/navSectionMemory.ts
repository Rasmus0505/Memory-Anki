import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  readPageHistorySectionUrl,
  recordPageHistorySectionVisit,
  resetPageHistoryStoreForTest,
} from '@/shared/page-history/pageHistoryStore'
import { navSections, type NavSectionDefinition, type NavSectionKey } from '@/app/shell/navSections'

const navSectionLastUrls: Partial<Record<NavSectionKey, string>> = {}
const warmedNavSections = new Set<NavSectionKey>()

export function findNavSection(pathname: string) {
  return navSections.find((section) => section.matches(pathname)) ?? null
}

function isRememberedPath(section: NavSectionDefinition, pathname: string) {
  return (section.rememberMatches ?? section.matches)(pathname)
}

function findRememberSection(pathname: string) {
  return navSections.find((section) => isRememberedPath(section, pathname)) ?? null
}

function normalizeRememberedSectionTarget(section: NavSectionDefinition, target: string) {
  try {
    const pathname = new URL(target, window.location.origin).pathname
    if (!isRememberedPath(section, pathname)) return section.to
    return target
  } catch {
    return section.to
  }
}

export function resolveNavSectionTarget(section: NavSectionDefinition, isActive = false) {
  // While already in this section, the nav link points at the section root so a
  // second click can leave a deep page (edit/practice/queue) without hunting for it.
  if (isActive) return section.to
  if (!section.rememberLastVisited) return section.to
  const rememberedTarget = navSectionLastUrls[section.key] ?? readPageHistorySectionUrl(section.key)
  if (!rememberedTarget) return section.to
  return normalizeRememberedSectionTarget(section, rememberedTarget)
}

export function resetNavSectionHistoryForTest() {
  for (const key of Object.keys(navSectionLastUrls) as NavSectionKey[]) {
    delete navSectionLastUrls[key]
  }
  warmedNavSections.clear()
  if (typeof window !== 'undefined') resetPageHistoryStoreForTest()
}

export function warmNavSection(section: NavSectionDefinition) {
  if (warmedNavSections.has(section.key)) return
  warmedNavSections.add(section.key)
  section.warmup?.()
}

/** Records the current URL under its nav section so the section link can return to it. */
export function useRememberNavSectionVisit() {
  const { pathname, search, hash } = useLocation()
  useEffect(() => {
    const matchedSection = findRememberSection(pathname)
    if (!matchedSection?.rememberLastVisited) return
    const fullPath = `${pathname}${search}${hash}`
    const rememberedTarget = normalizeRememberedSectionTarget(matchedSection, fullPath)
    navSectionLastUrls[matchedSection.key] = rememberedTarget
    recordPageHistorySectionVisit(matchedSection.key, rememberedTarget)
  }, [hash, pathname, search])
}
