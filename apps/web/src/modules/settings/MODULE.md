# Module: settings

## Status
active — production module after FSD removal.

## Owns
Settings / AI prompts UI

## Public entry
`public.ts` — only cross-module import path.

## Rules
- Do not import other modules' internal paths.
- Domain code is framework-free (no React).
- Workflows (XState) live under application/workflows.
