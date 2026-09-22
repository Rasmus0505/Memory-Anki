# Module: quiz

## Status
active — production module after FSD removal.

## Owns
Quiz attempt + generation UI/api, question mark (not a review schedule), shared SPA 已做 session

## Public entry
`public.ts` — only cross-module import path.

## Rules
- Do not import other modules' internal paths.
- Domain code is framework-free (no React).
- Workflows (XState) live under application/workflows.
