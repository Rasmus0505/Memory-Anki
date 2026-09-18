# Module: backup

## Status
active — production module after FSD removal.

## Owns
Backup UI if any

## Public entry
`public.ts` — only cross-module import path.

## Rules
- Do not import other modules' internal paths.
- Domain code is framework-free (no React).
- Workflows (XState) live under application/workflows.
