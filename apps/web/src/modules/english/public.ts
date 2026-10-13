/**
 * Public surface for module `english`.
 * Other modules may import only from this file.
 */
import { lazy } from 'react'

export * from './domain/english-entity/api'
export * from './ui/english-shell'
export * from './ui/english-text-interactions'
export const EnglishClozePage = lazy(() => import('./ui/english/EnglishClozePage'))
export const EnglishCoursePage = lazy(() => import('./ui/english/EnglishCoursePage'))
export const EnglishWorkspacePage = lazy(() => import('./ui/english/EnglishWorkspacePage'))
