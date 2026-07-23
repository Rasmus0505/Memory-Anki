# Section-Scoped Navigation History (前进/后退)

**Date:** 2026-07-23  
**Status:** Approved (Approach A)  
**Scope:** Top-left GlobalBackButton only; five primary nav sections

## Problem

The left-corner back/forward controls mirrored the **global** browser history stack. Switching primary tabs (随心 / 知识 / 英语 / 创建 / 洞察) interleaved with in-section drill-down, so:

1. User opens a deep page inside 知识 (e.g. knowledge-tree editor).
2. User switches to 随心, then back to 知识 (restored deep page via `sectionLastUrls`).
3. Pressing 后退 jumps to 随心 instead of leaving the editor **within** 知识.
4. The deep page feels stuck; “saved progress per section” fights global undo.

## Goals

- Back/forward act on **in-section scenario history** only.
- When the active section has no earlier entry → **disable** back (no cross-section fallback).
- Preserve existing tab memory (`sectionLastUrls` / second-click returns to section root).

## Non-goals

- Aligning system/browser/Android hardware back with section stacks (future).
- Persisting section stacks to `localStorage` or across devices.
- Changing scroll/ui snapshots in `pageHistoryStore`.

## Model

- One stack per `NavSectionKey`: `freestyle | palaces | english | knowledge | review`.
- Section resolution uses the **same path rules as** `navSections.matches` (not `pageHistoryRoute` sections, which differ for library vs creation vs insight).
- Entry: `{ key, fullPath }` (pathname + search + hash).
- Stack ops reuse browser-like push/replace/pop truncation (`navigationHistory.ts`).
- Lifetime: **in-memory, current tab only**. Refresh → single-entry stack for the current URL.

## Recording rules

| Event | Behavior |
|-------|----------|
| In-section PUSH/REPLACE | Update only that section’s stack. |
| Cross-section navigation (tab switch) | Do **not** push the source path onto the target stack. Switch `activeSection`. On enter: if current `fullPath` already exists in that section’s stack, point `index` there and refresh `location.key`; else reset that section to a **single-entry** stack at the current URL. |
| Section-scoped back/forward | `navigate(targetFullPath)` + pending marker so the location update adjusts `index` and does **not** push a duplicate. |

Outside the five sections (e.g. profile): both buttons disabled.

## UX scenarios

- Deep page → other tab → return deep → back stays in-section and steps out.
- Only root in stack → back disabled; second click on the tab still returns to section root.
- Deep landing with a single entry (refresh / launch restore / direct open of `/knowledge`) seeds a synthetic section-root anchor so **后退** can still leave to the section home (e.g. 知识树编辑器 → 学科书架 `/palaces`) without crossing tabs.
- Second click on active tab to root is a normal in-section PUSH (truncates forward).

## Implementation touchpoints

- `shared/page-history/navigationSection.ts` — path → section (mirrors nav matchers).
- `shared/page-history/sectionNavigationHistory.ts` — multi-stack pure functions.
- `shared/page-history/useNavigationHistory.ts` — wire stacks; path navigate for back/forward.
- `GlobalBackButton` — titles/tooltips; still consumes the hook.
- Unit tests for pure functions + hook scenario (knowledge deep → freestyle → knowledge → back stays in knowledge).

## Success criteria

- Repro path leaves the deep knowledge page without landing on 随心.
- In-section A→B→C back/forward behaves like a single browser stack.
- Related frontend unit tests pass.
