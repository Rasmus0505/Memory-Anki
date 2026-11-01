import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * Phone-shaped dialog chrome.
 *
 * Why this exists
 * ---------------
 * Every answering/sheet surface used to spell out its own height and safe-area
 * padding. They drifted: one dialog centred an 86vh box whose top edge landed
 * under the Dynamic Island, another filled the screen but let its footer slide
 * below the home indicator, and a third left a fraction of the screen for the
 * content the learner actually came for.
 *
 * The rules that must hold on a phone are structural, not per-dialog:
 * - the sheet may use the whole visual viewport, minus the safe areas;
 * - only the body scrolls, so the header and the primary action stay reachable;
 * - the top and bottom edges always clear the notch and the home indicator.
 *
 * Desktop keeps its own floating layout (`dialogFloatingLayout.ts`); these
 * classes relax at `sm:` and never leak into the desktop box.
 *
 * Every class below is written out in full: Tailwind extracts candidates from
 * source text, so a value built by interpolation silently produces no rule.
 */

/** Full-height phone sheet: the whole visual viewport between the safe areas. */
export const MOBILE_SHEET_FULL_CLASS =
  'h-[calc(100dvh-2*max(env(safe-area-inset-top,0px),env(safe-area-inset-bottom,0px),0.5rem))] max-h-[calc(100dvh-2*max(env(safe-area-inset-top,0px),env(safe-area-inset-bottom,0px),0.5rem))] w-[min(58rem,calc(100vw-1rem))] max-w-none p-0 sm:h-[min(86vh,100dvh-2rem)] sm:max-h-[min(92vh,100dvh-1rem)]'

/** Bottom sheet: grows to 85% of the viewport and scrolls internally. */
export const MOBILE_SHEET_BOTTOM_CLASS =
  'max-h-[min(85dvh,calc(100dvh-max(env(safe-area-inset-top,0px),0.5rem)))] w-full max-w-none p-0'

/** Header edge clears the notch; `max(safe-area, .5rem)` also covers devices reporting zero. */
export const MOBILE_SHEET_HEADER_CLASS =
  'flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4 pb-3 pt-[max(env(safe-area-inset-top,0px),0.5rem)]'

export const MOBILE_SHEET_BODY_CLASS =
  'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain'

/** Footer edge clears the home indicator, so the primary action is never under it. */
export const MOBILE_SHEET_FOOTER_CLASS =
  'shrink-0 border-t border-border/70 px-4 pt-3 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)]'

export function MobileSheet({
  as: Tag = 'div',
  variant = 'full',
  className,
  children,
  ...props
}: {
  as?: ElementType
  variant?: 'full' | 'bottom'
  className?: string
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'children'>) {
  return (
    <Tag
      data-mobile-sheet={variant}
      className={cn(
        'flex flex-col overflow-hidden',
        variant === 'full' ? MOBILE_SHEET_FULL_CLASS : MOBILE_SHEET_BOTTOM_CLASS,
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  )
}

export function MobileSheetHeader({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & Omit<
  ComponentPropsWithoutRef<'div'>,
  'className' | 'children'
>) {
  return (
    <div data-mobile-sheet-header="true" className={cn(MOBILE_SHEET_HEADER_CLASS, className)} {...props}>
      {children}
    </div>
  )
}

export function MobileSheetBody({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & Omit<
  ComponentPropsWithoutRef<'div'>,
  'className' | 'children'
>) {
  return (
    <div data-mobile-sheet-body="true" className={cn(MOBILE_SHEET_BODY_CLASS, className)} {...props}>
      {children}
    </div>
  )
}

export function MobileSheetFooter({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & Omit<
  ComponentPropsWithoutRef<'div'>,
  'className' | 'children'
>) {
  return (
    <div data-mobile-sheet-footer="true" className={cn(MOBILE_SHEET_FOOTER_CLASS, className)} {...props}>
      {children}
    </div>
  )
}
