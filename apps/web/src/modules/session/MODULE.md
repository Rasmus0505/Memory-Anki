# Module: session

## Status
active — production module after FSD removal.

## Owns
Live study presence and practice session progress client

## Public entry
`public.ts` — only cross-module import path.

## Rules
- Do not import other modules' internal paths.
- Domain code is framework-free (no React).
- Workflows (XState) live under application/workflows.
