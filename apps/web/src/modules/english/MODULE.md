# Module: english

## Status
active — production module after FSD removal.

## Owns
English course/patterns

## Public entry
`public.ts` — only cross-module import path.

## Rules
- Do not import other modules' internal paths.
- Domain code is framework-free (no React).
- Workflows (XState) live under application/workflows.
- Listening dictation is local-subtitle-first: the backend parses SRT/VTT/ASS and
  aligns an optional Chinese track; no ASR or translation AI belongs in this flow.
- The pure spelling state model lives in `domain/english-dictation/model.ts`.
  UI under `ui/english-dictation` only renders that model and forwards keys.
- Playback has two modes: single cue (default, pause at each cue end) and
  continuous (follow the playhead, pause only at the end). Keep boundary checks
  off the per-frame path, and keep heavy backdrop filters off a playing video.
- Media responses must keep byte-range support; sentence seeking depends on it.
