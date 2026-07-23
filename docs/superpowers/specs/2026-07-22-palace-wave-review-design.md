# Palace Wave Review System Design

**Date:** 2026-07-22  
**Status:** Approved for implementation  
**Architecture:** Write-time wave domain (ReviewWave as source of truth; StudySession as execution slice)

## Summary

Split FSRS node memory computation from user-facing review tasks. FSRS owns `raw_due_at`; palace waves aggregate, freeze, pause/resume, reinforce, and present. Formal long-term waves use local calendar days; same-day reinforcement uses concrete UTC times.

## Decisions

1. **Wave primary, session secondary:** One formal wave can span multiple StudySessions. Freeze scope lives on `ReviewWaveItem`, mirrored into session summary for compatibility.
2. **Big-bang delivery:** Tables, domain, API, and frontend land together.
3. **Compatibility:** `ReviewNodeState.due_at` remains the effective formal due used by existing queue fields; `raw_due_at` stores FSRS suggestion.
4. **No auto-expand:** Starting freezes current due+overdue only; new dues require explicit merge on resume.
5. **Weak ratings → reinforcement waves** (default 20m/60m), not formal short `due_at` caps.
6. **First-learn / never-reviewed** tree nodes enter formal due immediately (new palaces are reviewable without calibration). **Content-changed** nodes stay out of formal due until relearned or calibrated.

## Tables

- `review_waves`, `review_wave_items`
- `review_calibration_operations`, `review_calibration_operation_items`
- Extended `review_node_states` columns for dual dates, wave membership, practice/direct clocks, schedule_source

## Key services

- `wave_policy.py` — pure safety-window / date helpers
- `wave_service.py` — adsorb, freeze, pause/resume/merge/complete, reinforcement
- `calibration_service.py` — diagnose/preview/apply/undo
- Formal review lifecycle wires waves; `rate_nodes` applies wave reassignment after FSRS writes

## Out of scope

- Cloud multi-user, separate mobile app
- Deleting historical completion audit rows
