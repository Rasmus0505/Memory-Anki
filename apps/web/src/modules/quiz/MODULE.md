# Module: quiz

## Status
scaffolding — target home after FSD removal (branch 7.22-refactor-optimize).

## Owns
Quiz attempt + generation UI/api

## Public entry
`public.ts` — only cross-module import path.

## Rules
- Do not import other modules' internal paths.
- Domain code is framework-free (no React).
- Workflows (XState) live under application/workflows.
