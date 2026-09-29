# FX Director (feedback runtime)

`apps/web/src/shared/fx` is the single sensory runtime: particles, sound accents, haptics and DOM flourishes. Business code says **what happened**; recipes decide **how it feels**.

```text
caller ──cue('grade.commit', payload, { owner })──▶ director ──▶ recipe.play(payload, stage)
                                                     │              ├─ particles (WebGL2 + bloom, Canvas2D fallback)
                                                     │              ├─ audio / haptics (shared/feedback)
                                                     │              └─ DOM flourishes (stamp, flash, bump, peel)
                                                     └─ policy gate (settings scene + OS reduced motion)
```

## Pieces

| File | Role |
|---|---|
| `core/director.ts` | `defineCue` / `cue` / `listCues` / `replayCue` / `onCue`. `FxCueMap` is declaration-merged by recipe files, so payloads are typed per cue. |
| `core/policy.ts` | `resolveFxGate(scene)` — the only place that turns feedback settings + `prefers-reduced-motion` into motion/sound/haptic switches. Scenes: `review`, `milestone`, `completion`, `ambient`. |
| `core/owner.ts` | Owner-scoped playback. Every delayed step belongs to an owner (card encounter, round, page); `retireOwner` cancels all pending steps and teardown. `useFxOwner(id)` binds an owner to a component identity. |
| `core/anchors.ts` | Named landing spots via `data-fx-anchor` (`fxAnchor(FX_ANCHORS.xpBar)`), re-resolved every frame for homing particles. Effect code never uses test ids. |
| `recipes/*` | `learning` (grade, flip relay, unit done, undo, remove, retry, quarters, quiz, page turn, motes, round complete), `map` (mind-map land/fold/branch), `meta` (XP, level, stamp, quest), `rare` (koi, phoenix, fireflies, lotus). |
| `skins.ts` | Particle palettes (`ink` default, `foil`, `galaxy`). Recipes read the live `pal` at emit time; `setFxSkin` swaps it in place. Warm hues only. |
| `rarity.ts` | Pure rare-show roll: ~1/45 per eligible rating, ramp from 55, guaranteed at 80, never after 忘记, never the same show twice in a row. Counter is per device. |
| `glowLayer.ts` | Retained-mode glow canvas (same renderer, non-aging points) used by the starmap. |

## Rules

1. Outside `shared/fx`, import only `@/shared/fx`. `check_fx_director_boundary` rejects `@/shared/fx/{particles,core,recipes}` and `canvas-confetti` anywhere else (the celebration preset engine is the one documented consumer of the particle engine).
2. Entity-scoped cues pass an `owner` derived from the entity identity (`card:${progressKey}`, `round:${roundKey}`). Leaving the entity retires the owner.
3. Callers do not read feedback settings for cues; the recipe's `scene` decides. Recipes that escalate (combo milestone inside `grade.commit`) ask `stage.gateOf('milestone')`.
4. Visual layer purity still holds: `shared/fx` never imports `modules/`, `pages/`, `widgets/` or `app/`.
5. The FX Lab (`/lab/fx`, linked from 设置 › 反馈中心) replays every cue with a `sample` payload on all channels (`force`), switches skins and forces rare shows. Cues without a sample need a real scene and are shown disabled.

## Adding an effect

Declare the payload in the recipe file's `FxCueMap` augmentation, `defineCue(name, { scene, label, group, sample?, play })`, then call `cue(name, payload, { owner })` from the owner module. Add a `sample` whenever the effect can run without real DOM so the lab can replay it.
