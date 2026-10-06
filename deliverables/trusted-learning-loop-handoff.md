# Trusted Learning Loop Handoff

## Approved Preferences

- Prioritize reliable learning, honest evidence, and reduced supervision burden. Pause feature additions.
- Devices share progress but keep their routes, current cards, and reveal UI.
- Exclusion is round-local, survives refresh, and never changes mastery or scheduling.
- Separate time investment, learning activity, and mastery evidence. Reports contain facts only.
- Failed saves remain pending and visible; learning may continue.
- Repair historical data only with evidence and a backup. Unknown evidence stays unknown.
- AI owns technical acceptance. User confirms experience in three complete learning sessions.
- Running-version updates require separate user confirmation.

## Scope and Shared Work

The repository started with extensive uncommitted changes, including article views, ratings, bindings, quiz progress, dashboard progress, and audio. These were preserved. No commit was made. Git diff is not an ownership list for this task.

Live frontend observed before validation: `20261006054001-81be7023b4`, built at `2026-10-06T05:40:03.345Z`, served by existing `127.0.0.1:8012`. No restart or live frontend replacement is authorized by this handoff.

## Evidence-Backed Repairs

1. Startup quiz synchronization incorrectly acknowledged the merged local snapshot, suppressing upload of offline answers. A regression reproduced the failure; hydration now acknowledges the server snapshot only.
2. Local changes during an in-flight save could lose their next push. The synchronization loop now drains pending changes and preserves failed local state.
3. Clear requests bundled unrelated scopes under one old timestamp. They now preserve each timestamp and scope.
4. Backend delayed clears deleted newer answers. All/palace/question clears now delete only records at or before the clear timestamp.
5. A clear and new answer in the same millisecond could discard the answer after reload. Local action timestamps are monotonically ordered.
6. Remote clears removed completed states but left unfinished answers. Clear merges now cover all stored states.
7. Shared quiz progress was pulled only once. Visible clients now refresh on focus, reconnect, visibility changes, and a 15-second interval; stopped owners remove timers/listeners.
8. Global quiz-progress queue coalescing could replace different question batches. This coalescing key was removed; original timestamps make retries safe against stale writes.
9. Unsynchronized quiz progress now produces a persistent factual warning, cleared after synchronization succeeds; unavailable reads are not reported as verified synchronization.
10. Remote routes/card/reveal UI no longer force local navigation. Live presence, timer ownership and rating transport remain. Queue hydration prefers the local card; remote rating settlement also pins the local cursor. A different round is refreshed before applying its ratings.
11. Manual schedule PATCH had no HTTP replay protection. Existing mutation-response storage now replays the original result, in the transaction, and rejects a receipt belonging to another unit/operation. No rating event is fabricated and no migration was added.
12. Duplicate document UIDs could silently collapse coverage. The read-only catalog now exposes a structural-integrity note without changing source documents. A valid UID named `missing` is not treated as an error.
13. Ledger summary/source/kind aggregates counted raw overlapping durations while trend used de-duplicated fragments. They now use the same deterministic fragments, preserving raw ledger facts.
14. Dashboard monthly review duration included non-review activities. It now filters review records explicitly.

## Existing Protections Checked

- Rating operation receipts and entity identity validation exist.
- Exclusion does not mutate stage, due date or has_passed; persisted/local retained ledger protections exist.
- Identity ratings are shared across entry points; round-local cursor/exclusion semantics remain separate.
- Learning coverage already distinguishes reviewed from mastered; quiz attempts are question-owned.
- Time records use a separate session read model; time is not a mastery metric.

## Validation Boundary

Use `MEMORY_ANKI_VALIDATION_OUT_DIR=dist-validation-trusted-loop` with `python tools/quality_gate.py --full` to build and preview validation output without replacing `apps/web/dist`. The isolated output option rejects absolute/traversal/live-dist targets. E2E uses fixtures, blocked service workers, no API proxy, and no existing-server reuse.

Final isolated quality gate passed: architecture 144 tests; data-integrity tooling 3 tests; backend 843 tests; ruff, mypy, import-linter; frontend lint, typecheck, Vitest; isolated frontend build; and Playwright 50 passed / 4 skipped across desktop Chromium, mobile Chromium, and mobile WebKit. The four skips are existing conditional tests. The WebKit freestyle rating flow now passes under the full parallel gate after making the sync warning pointer-transparent and making the settlement E2E assertion event-driven.

No `--launchers` run has occurred. It restarts the shared PWA service and starts Electron, so it requires the separately confirmed maintenance window. There has been no write to the real learning database, no historical score reconstruction, and no source-PDF-based binding repair.

## Open Acceptance Items

- External Agent Mail hourly email automation is not established as owned by this repository. Facts-only preferences are recorded; its live task prompt has not been changed.
- Historical has_passed can count as reviewed schedule-state evidence. The existing note labels it as rating-or-passed coverage, not mastery; historical missing operation evidence has not been reconstructed.
- Real textbook/chapter/question bindings need source-based audit before any data repair. Malformed documents receive a warning, not invented replacement UIDs or guessed counts.
- Computer-to-computer database synchronization remains Syncthing-owned and requires one writer at a time. Phone/desktop clients on the same backend are a different scenario; no new file-sync implementation is introduced.
- Phone hardware/network behavior and three actual uninterrupted learning sessions remain unverified until user observation.

## Release and Learning Observation

Before release, notify the user of scope, migrations if any from shared work, backup, interruption, launcher smoke, and rollback boundary. Do not imply isolated verification is a live deployment.

For each of three user learning sessions, record date, chapter, devices used, whether rating/removal persisted, whether unsaved state was visible, and whether a system issue caused checking/recovery/rework. No feedback is not a pass. Technical handoff and real-learning acceptance are separate states.
