# Release Gate — Verdict History

| Date | Branch @ HEAD | Target | Verdict | Blockers |
|---|---|---|---|---|
| 2026-05-29 | `codex/fix-projection-engine` @ `11f1701` | v1.1.1 (build 41) | 🔴 **NO-GO** | B1 invariant sweep fails (102 issues) · B2 engine-version mix (2.10/2.11/unstamped) · B3 frontend suite red (4 tennis/cricket display tests) |

## Recurring themes to watch
- **Tennis/cricket projection display** is the repeat offender — set-score vs games model, dropped decimals, run-total off-by-one. Same root surfaces in the invariant sweep (B1), version mix (B2), red tests (B3), and a dead-var lint warning. Treat these as one fix, not four.
- **Engine-version stamping**: 71% of live predictions carry no `modelVersion`. Until every prediction is stamped and stale ones are recomputed, the coherence check (B2) and the invariant sweep (B1) will keep flapping.
- **Build-number source of truth**: `app.config.js` (`EXPO_IOS_BUILD_NUMBER`) wins over the static `app.json` value — don't trust app.json's number when judging "incremented since last submission."
