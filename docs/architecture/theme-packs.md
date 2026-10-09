# Theme packs (whole-world skins)

A theme pack re-dresses the entire app: surface tokens (light + dark), stage and paper, card texture and 3-star bookmark, ambient motes and window light, the fx particle palette, the synth timbre, and motion rhythm (page turn, flip length and overshoot). Business code never branches on a pack id.

```text
shared/theme/packs/<id>.ts   one manifest per world (ThemePack)
shared/theme/themePacks.ts   registry: THEME_PACKS, applyThemePack, themeMotion, themeAmbient, onThemePackChange
modules/progression          unlock ladder (level / stamp), round-end unboxing, growth_state.pack
app/shell                    useGrowthCosmetics(): applyThemePack + setFxSkin (the only place both are bound)
```

## Packs

| id | 名称 | Unlock | fx skin | Timbre | Motes | Rhythm (turn / flip) |
|---|---|---|---|---|---|---|
| `study` | 纸墨书房 | Lv.1 (default, emits no overrides) | `ink` | `paper-wood` | dust | 380 / 560 ms |
| `palace` | 金箔宫殿 | Lv.5 | `foil` | `bell-lacquer` | gild (falling flecks) | 430 / 640 ms |
| `voyage` | 星河夜航 | Lv.12 | `galaxy` | `celesta-chime` | star (sharp twinkle) | 460 / 680 ms |
| `forest` | 森林萤火 | stamp `days_30`「一月耕读」 | `firefly` | `marimba-water` | firefly (slow flare) | 340 / 520 ms |

## How it applies

- `applyThemePack(id)` writes one `<style id="memory-anki-theme-pack">` generated from the manifest, sets `data-theme-pack`, `data-card-material`, `data-card-bookmark`, `--ma-page-turn-ms`, `--ma-flip-ms` and the `theme-color` meta, and remembers the id in `memory-anki-theme-pack` so boot (`initializeTheme`) paints the right world before React.
- Specificity: `:root[data-theme-pack=x]:not(.dark)` for light, `:root[data-theme-pack=x].dark` for dark. Light and dark must set the same keys (tested), otherwise dark would inherit a light token.
- `shared` tokens (stage, paper, mind-map dot, `--ma-window-hue`) apply in both schemes: the mind-map canvas stays warm paper even in dark mode.
- Motion is read at animation start (`themeMotion()`), so a switch applies from the next page turn / flip. Every pack stays ≤700 ms (tested) so rhythm never interrupts flow.
- Timbre is read by `shared/feedback/mindmap-audio/packTimbre.ts` (`activeThemePack().timbre`) and recolors every procedural tone: oscillator type, pitch, duration, attack, gain. No samples. `shared/fx` does not import the theme registry, and `shared/theme` does not import `@/shared/fx`.
- Warm-only rule: no pack uses a 190°–250° (cold blue) ground (tested).

## Growth wiring

- `growth_state.pack` is the synced source of truth; `unboxed` lists packs whose unboxing already played (written before the cue fires, so the other device never replays it). Pre-pack states (`skin`) migrate through `coerceThemePackId` without losing seen levels or stamps.
- Round end unboxes at most one newly unlocked pack (`pack.unbox` cue in the new pack's palette + 「换上」 in the settlement card). Mid-round never unboxes.

## Adding a pack

1. `shared/theme/packs/<id>.ts` exporting a `ThemePack`; add the id to `ThemePackId` and the const to `THEME_PACKS`.
2. If it needs a new particle palette, add it to `shared/fx/skins.ts`.
3. `check_theme_pack_registry` fails if a pack file is not registered, if `shared/theme` imports `@/shared/fx`, or if `shared/fx` imports `@/shared/theme`.
