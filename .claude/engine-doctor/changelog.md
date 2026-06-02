# Prediction Engine Doctor — Changelog

## Run 1 — 2026-05-29

**State of the engine: AT-RISK** (not "stable") — one largest-sample league is worse-than-random,
the headline Top Picks feature ships self-flagged-unreliable picks, and the active branch makes the
calibration scoreboard self-referential. None catastrophic; all evidenced.

### What I scanned
- Live production calibration via `GET /api/calibration` (engine `2.11.0-self-learning-calibration`).
- Live invariant sweep via `qa:predictions:live` (`predictionInvariantSweep.ts`) against production.
- Static deep audit (workflow: 7 dimensions → adversarial verify → synthesis + completeness critic;
  13 agents, ~941k tokens). 22 findings confirmed, 1 refuted.
- Active branch `codex/fix-projection-engine` (vs `main`): 85 files, +4424/-705.

### Measured (REAL — live production, n=1260 total graded picks)
| League | Brier | n | Acc% | Read |
|---|---|---|---|---|
| NBA | 0.226 | 123 | 68.3 | healthy; UNDER-confident in 50–60% buckets (calls ~52%, wins ~70%) |
| MLB | 0.251 | 633 | 51.5 | WORSE-THAN-RANDOM, biggest sample → drags ALL |
| MLS | 0.253 | 128 | 48.1 | worse-than-random, miscalibrated both directions |
| NHL | 0.246 | 138 | 57.7 | marginal |
| EPL | 0.230 | 71 | 64.8 | ok (under-confident) |
| TENNIS | 0.233 | 155 | 62.6 | ok |
| UCL/IPL | — | 6/6 | — | sample too small |
| NFL/NCAAF/NCAAB | — | 0 | — | offseason (correct) |
| ALL | 0.245 | 1260 | 56.0 | marginally below random=0.25 |

### Top findings (ranked; full set: 22 confirmed)
1. **[High, pre-existing] Top Picks thin-slate backfill bypasses the eligibility gate.**
   `routes/games.ts` — `pool = strict.length>0 ? strict : sportGames`; the fallback only requires
   finite confidence + scheduled (no 56 floor, no blocked-tag/low-data gate). LIVE PROOF: UCL pick
   401862897 (ARS@PSG) shipped as a Top Pick at **44.5%** confidence with tags
   [model-consensus, thin-data, volatile-script] and a reliability-reserve warning. Also sub-56 picks
   in NBA(52.7)/MLB(50)/NHL(55.8)/IPL(51.1). Fix: `pool = strict` (return fewer picks, not weak ones).
2. **[High, pre-existing] MLB 60–65% bucket is worse than a coin flip and single-handedly causes the
   above-random Brier.** 60-65 bucket: predicted 0.625, actual 0.300, n=30 (+32.5 err pts). Removing
   only that bucket flips MLB 0.2512 → 0.2493 (below random). Likely cause: unregressed recent_form
   (raw L10 win%, wt 0.10) + coarse bullpen_fatigue proxy stacking into 60%+ deltas. Fix: cap MLB near
   pick'em unless the starting_pitcher delta justifies it; replace raw L10 with run-diff/Pythagorean.
   NOTE: completeness critic showed this 60-65 overconfidence is SYSTEMIC (ALL 60-65 +10pts), not
   MLB-only — fix the engine-wide sigmoid slope, not just the MLB branch.
3. **[Medium, branch-introduced] Self-learning calibration is a feedback/contamination loop.**
   `newEngineAdapter.ts` persists the self-learning-ADJUSTED probability into the same columns
   `calibration.ts` reads to build the next curve. No raw pre-adjustment probability persisted, so the
   engine can no longer measure its TRUE calibration — exactly when it matters (MLB/MLS below random).
   Caps are tiny (~1pt vs 18–32pt miss) so it's currently cosmetic, not runaway. Critic add-on:
   it is ALWAYS-ON with NO kill-switch/feature-flag → no rollback short of revert, no A/B.
   Fix: add `rawSelectedOutcomeProb` column + grade/learn from RAW; add an env kill-switch.
4. **[Medium, branch-introduced] Tennis "Projected Games" line is synthesized from win probability,**
   not from real game-scoring data (`index.ts` tennisGameLineForPick; duplicated client-side in
   `src/lib/projection-display.ts`). No-mock-data tension. Fix: feed a real per-player games baseline
   from ESPN results already fetched, or relabel as "indicative from win probability."
5. **[Low, branch-introduced] Branch reworded the stored-pregame audit string** ("...not recomputed
   after start.") without syncing `predictionInvariantSweep.ts:205` (still checks "...after final.") →
   **37 false-positive TENNIS sweep failures**. Plus the version pin (`2.10.0`) is stale vs live
   (`2.11.0`), so `qa:predictions:live` aborts before checking invariants. Fix: share one constant +
   accept either string; bump the expected-version pin. Do NOT revert the engine wording.

### Refuted (verifier killed it — kept here so it's never re-proposed)
- "MLS home-field Elo bonus (55) is too high vs EPL (40), causing home-favorite overconfidence."
  REJECTED on 6 grounds: mis-cited the comment (it's in the unused `ratings/elo.ts`, not the live
  `lib/elo.ts`); MLS>EPL home edge is empirically sourced (ASA ~58–60% home wins); EPL's signed bias
  is actually LARGER; the metric is selected-outcome (can't isolate home asymmetry); the cited buckets
  are within noise (n≈29, CI ±18pt); and the historical-Elo data leak makes the signal untrustworthy
  for retuning a sourced constant. This was a small-sample overfitting trap — correctly avoided.

### Decisions
- **NO live engine changes made** (do-no-harm; doctor never ships without clearing the gate).
- **Promotion gate for `codex/fix-projection-engine`: NEEDS-MORE-DATA (do not queue).** Out-of-sample
  accuracy could not be measured (no local DATABASE_URL). Static blockers before it could ever queue:
  (a) break the self-learning feedback loop (raw column) + add kill-switch; (b) the invariant sweep
  currently FAILS (37 false positives) so invariants don't pass; (c) tennis line needs real data or
  honest relabel. Pre-existing High items (#1, #2) should be fixed on `main` regardless of this branch.

### Caveats / integrity notes
- A non-isolated workflow subagent ran `git checkout main` mid-run (shared working tree). No work lost;
  branch intact at 6718d42; I restored the tree to `codex/fix-projection-engine`. NEXT RUN: use
  worktree isolation for any agent that touches git.
- All accuracy verdicts rest on the assumption that stored `PredictionResult` probabilities are
  point-in-time. Could not verify capture-time integrity (no DB). Verify `createdAt` vs scheduledStart
  on a sample before trusting any league's Brier.

---

## Run 1 — 2026-05-29 (FIXES APPLIED, same-day, Deepak-authorized for submission)

Deepak authorized fixing the engine today so the `codex/fix-projection-engine` branch can be
submitted. Applied the **safe, non-accuracy** fixes (validated by typecheck + tests) and explicitly
DEFERRED the accuracy retune (needs a DB-backed backtest). Net: the branch now ships strictly better
than current production with no new unverified risk.

### Shipped (7 files, +88/-18; backend typecheck ✅, full backend suite 435 pass ✅, mobile typecheck ✅)
1. **Top Picks gate (#1)** — `routes/games.ts`. Replaced the ungated fallback
   (`pool = strict.length>0 ? strict : sportGames`) with a relaxed-but-clean fallback
   (`sportGames.filter(isRelaxedTopPickEligible)`). Refactored shared gate `passesTopPickQualityGates`
   so the fallback still rejects blocked tags / low-data / toss-ups / reliability-reserve warnings;
   only the confidence floor relaxes (56 → 53). Result: clean 53-55 leans still populate the board,
   but the engine never features a pick it distrusts (kills the live 44.5% thin-data UCL Top Pick).
   Updated `gamesNarrativeSanitizer.test.ts` (which had encoded the buggy behavior) into two precise
   cases: clean relaxed lean IS surfaced; blocked / below-floor picks are NOT.
2. **QA sweep (#5)** — `predictionInvariantSweep.ts`. Bumped stale version pin (2.10.0 → 2.11.0),
   accept both audit-warning wordings via regex (kills the 37 tennis false-positives — verified live:
   sweep 93 → 12 issues), aligned the confidence floor to 53. Remaining 12 issues are live pre-deploy
   top-picks that the games.ts fix clears post-deploy.
3. **Self-learning kill-switch (#3, partial)** — `env.ts` + `selfLearningCalibration.ts`
   (`isSelfLearningCalibrationEnabled`) + `newEngineAdapter.ts`. New env flag
   `SELF_LEARNING_CALIBRATION_ENABLED` (default ON = unchanged behavior; set false/0/off to disable in
   prod with no revert). The raw-probability column + breaking the calibration feedback loop is the
   remaining part — deferred (needs a Prisma migration + DB).
4. **Tennis honesty (#4)** — `src/lib/projection-display.ts`. Tennis context copy now reads
   "Indicative games derived from the win-probability model" instead of implying independent scoring
   data (per the no-mock-data rule). No test asserted the old string.

### Deferred (NOT shipped — would violate the promotion gate without out-of-sample proof)
- **MLB 60-65% overconfidence (#2)** and the engine-wide sigmoid-slope overconfidence. Pre-existing,
  already live, so not made worse. The Top Picks fix stops the worst MLB picks from being featured.
  The math change requires a DATABASE_URL backtest proving it helps MLB without regressing other
  leagues. Queued for the next run.
- **Self-learning raw-probability column** (breaks the feedback loop fully) — needs a Prisma migration.
- **MLS bidirectional miscalibration** — needs the same per-bucket diagnosis as MLB (next run).

### Gate posture
These four are routing/display/safety changes, not prediction math — validated by typecheck + unit
tests, do-no-harm to live probabilities (kill-switch defaults preserve behavior). The accuracy retune
(#2) stays behind the gate until it can be proven out-of-sample. No engine MODEL_VERSION bump (math
unchanged). No commit/push performed — left staged on the branch for Deepak to submit.

---

## Run 2 — 2026-05-29 (WHOLE-ENGINE ASSESSMENT + real backtest; Deepak asked to cover every league + simulation)

Ran a leak-aware ESPN historical replay (90d, 525 games) AND a 34-agent whole-engine audit
(architecture, Elo, simulation, all 11 leagues incl. IPL deep-dive, projections, calibration).
Engine grade: **C** — real architecture, real data, real effort, undermined by a few high-leverage
structural bugs and an overfit-prone hand-tuned compensation stack. NO changes made this run
(assessment only); all fixes require Deepak approval (he said he'll approve).

### Real backtest (reliable for NBA/MLB/NHL; MLS/IPL/EPL degraded by cold-Elo standalone seed)
NBA 70.7% (n150, conf59 → -11.6pt UNDER-confident) | MLB 54.7% (n150, ~calibrated avg, Brier~random) |
NHL 59.3% (n150, -5.6pt under) | MLS 43.8% (n48, cold-Elo) | IPL 47.4% (n19, cold-Elo) | EPL n7 ignore |
TENNIS not in replay (live Brier 0.233 ok). Confirms live: engine is too timid on its good leagues.

### Verified structural root causes (file:line confirmed by adversarial verify + critic)
1. CRITICAL: factors+home-bonus are weight-SHRUNK before the Elo logistic (base.ts:59 + index.ts:868-873)
   → 100-pt NBA HFA becomes ~40 effective Elo (~55% vs ~64% standalone) → 985/1260 picks crushed into
   the 50-60% toss-up band → systemic under-confidence (NBA/NHL/EPL/TENNIS leave edge on the table).
2. CRITICAL: EloRating table is NEVER written by live code (updateEloAfterGame/runEloUpdate have no live
   callers; verified worker.ts, resolve-picks.ts) → the 40%-weight rating_diff factor runs on FROZEN
   ratings all season. Prerequisite bug — blocks trusting any rating-based tuning.
3. HIGH: self-learning calibration fits/serves on post-adjustment probs (no raw column in schema) →
   contaminated, optimistically-biased labels. (Recursion premise verified; exact write-back path not
   fully pinned — stated honestly.)
4. HIGH: MLB 60-65% bucket anti-predictive (pred .625/actual .300, n30) — a SIGNAL defect (unregressed
   L10 form stacking). BUT the 50-58% MLB mass (n598) is EXCELLENTLY calibrated — so a fix must target
   >60% only, NOT >58% (critic correction; avoids harming the good band).
5. Simulation is PARTIALLY DECORATIVE: 50k-iter Monte Carlo gives real total/volatility/upsetRisk, but
   double-counts factor deltas (simulation.ts:318-320,366-463), uses a single Gaussian (wrong for
   MLB/NHL/soccer integer scores), and reconcileProjectionToFinal fabricates the public scoreline at
   the threshold-minimum margin (index.ts:385-431) → projected score becomes derived-from-winprob.
6. Per-league: MLS proportional draw carve-out over-credits favorites (probability.ts:80-92); NHL goalie
   factor uses TEAM SV% not the starter (nhl.ts:86-87); TENNIS 40% rating_diff weight is DEAD (player
   Elo never seeded =1500); IPL live-chase engine built+tested but never wired into production (no
   deliberate block — critic corrected), no toss factor, run-line baseline mismatch (backend 320 vs
   mobile 335); NFL/NCAAF/NCAAB need pre-season hardening (fail-open QB availability, disabled divisional).

### Refuted (kept so not re-proposed)
- "NBA home bonus (100 Elo) is too high / causes the 60-65 overconfidence" — REFUTED: the 100 value is
  fine; the problem is the pre-logistic SHRINK (#1), not the HFA magnitude. Do NOT lower NBA HFA.

### Recommended sequence (prerequisites first; all behind flags + replay-validated before live)
Phase 1: #2 HFA full-scale aggregation (biggest lever, data-free, A/B on replay) · #3 raw-prob column
(migration, honest measurement) · #1 wire live Elo refresh. Phase 2: #4 MLB >60% targeted shrink +
regress L10 · #5 per-league walk-forward isotonic recalibration map · #6 raise genuine-SharpAPI weight.
Phase 3: #8 NHL starter-goalie stats · #9/#10 simulation rework + count-appropriate distributions ·
#7 soccer draw (CHEAP fix first — faster favorite-share shrink — NOT a full Poisson rewrite on n128) ·
#11 tennis dead-weight reclaim + surface · #12 IPL (validate on replay, wire live-chase, toss factor) ·
#13 NFL/college season hardening. Full roadmap + 9 approval items in the workflow result.

---

## Run 2 (cont.) — 2026-05-29 — IMPLEMENTATION (Deepak: "fix everything", with validation discipline)

Worked the roadmap as flag-gated, replay-validated changes. Outcome so far:

### SHIPPED + VALIDATED (committed 2e69f12, pushed; flag-gated default OFF)
- **#2 full-scale rating** (`prediction/flags.ts`, `index.ts` sumRatingDelta, `env.ts` flag,
  `fullScaleRating.test.ts`). Elo+HFA enters the logistic at full scale; other factors are
  additive adjustments. Full 90-day replay A/B (flag OFF→ON): NBA acc 70.0→72.7 (conf 59→68,
  Brier .420→.397), NHL 59.3→62.0, MLS 43.8→47.9, IPL 47.4→52.6, MLB 54.7→52.7 (lone within-noise
  regression), OVERALL acc 58.9→60.6, Brier .483→.475, conf now tracks accuracy. CLEARS THE GATE.
  Not yet enabled in prod (set ENGINE_FULL_SCALE_RATING=true to enable).

### TRIED + REVERTED (the gate working — did not ship guesses)
- **#4 MLB soft-cap + L10 regression**: did NOT clear the gate on the replay (MLB acc 52.7→52.0,
  Brier .486→.488). The replay can't reproduce the LIVE 60-65 anti-predictive bucket, so this was
  unvalidatable hand-tuning. Reverted. MLB's real fix = data-driven recalibration (#5).
- **#11 tennis dead-weight reclaim**: logically correct (40% weight on a structurally-zero factor),
  but the replay does NOT support tennis, so it is unvalidatable locally. Reverted to keep the v3
  flag = strictly-validated changes. To validate via live /api/calibration after #2 ships, or by
  adding tennis to the backtest first.

### REMAINING ROADMAP — blocked on Deepak decisions / infra / live data (NOT guessable)
The biggest realization: the replay reliably validates win-prob only for NBA/MLB/NHL. Fixing
MLB/MLS/tennis/IPL calibration *properly* requires the DATA-DRIVEN path, which needs:
- **#3 raw-probability columns** — Prisma migration on prod (additive, nullable, safe) so calibration
  is graded on the RAW model output, breaking the self-learning feedback loop. PREREQUISITE.
- **#5 per-league walk-forward isotonic recalibration map** — fit on live raw data, promote only if
  it beats identity out-of-sample. The principled MLB/MLS/tennis fix (replaces hand-tuning).
- **#1 live Elo refresh job** — ratings are frozen in prod (no live writer); needs a worker/cron wiring.
- **#8 NHL starter-goalie stats / #12 IPL toss feed + live-chase wiring / #6 market weight** — need new
  external data and/or a product decision.
- **#7 soccer draw cheap fix / #13 NFL season hardening** — implementable but soccer is hard to
  validate (cold-Elo replay) and NFL is offseason (n=0).

Honest status: the single biggest validated win (#2) is shipped flag-gated; the rest is a multi-step
program gated on a prod migration + live-data accumulation + new data sources. Will not ship unvalidated.

### SHIPPED #3 — raw-probability columns + grade-on-raw (committed 9361941, pushed)
Additive migration (rawHomeWinProb/rawAwayWinProb/rawDrawProb/rawSelectedOutcomeProb, all nullable).
newEngineAdapter captures raw probs BEFORE self-learning and persists them; calibration.ts grades on
raw when present (graceful fallback to served for old rows / self-learning-off). Breaks the feedback
loop; prerequisite for #5. Applies on deploy via prisma migrate deploy. typecheck + 440 tests pass.
#2 ALSO enabled on prod env (ENGINE_FULL_SCALE_RATING=true, --skip-deploys) — activates on next deploy.

### Session end-state (run 2)
DONE+validated+pushed: Top-Picks gate, QA sweep, self-learning kill-switch, tennis copy (batch 1);
#2 full-scale rating (validated, enabled); #3 raw-prob columns. Tried+reverted: #4, #11 (gate/validation).
REMAINING (need time/data/decisions): #5 recalibration maps (needs #3 deployed + days of live raw data —
the proper MLB/MLS/tennis fix, comes online automatically as data accrues); #1 live Elo refresh (frozen
ratings — needs worker wiring + careful validation); #9 simulation double-count/reconciliation
(validatable via score MAE); #6 market weight; #8 NHL starter-goalie (new ESPN fetch); #12 IPL
toss+live-chase (new feed + product decision); #13 NFL/college pre-season hardening (offseason).

### #9 simulation double-count — TRIED, REVERTED
Gated the 5 factor-derived margin re-applications (net_rating/pitcher/goalie/injury/rest) behind v3.
Replay score-MAE A/B (#2-only vs #2+#9): marginMae rose for NBA/MLB/NHL, NHL acc -2 — the shifts are
redundant in theory but the profile constants were tuned around them, so removal de-tunes. Reverted.

### #1 frozen Elo — NOT wired (needs focused work, not a blind tail-end change)
runEloUpdate(sport, teamIds) exists but needs a per-league team-ID enumeration that does NOT exist in
the codebase (likely why it was never wired), PLUS a controlled first-run observed against the prod DB
(audit: "validate the first refresh doesn't lurch ratings"). Cannot validate locally (no prod DB; replay
rolls its own Elo). Deferred to a focused pass — will not write prod ratings blind.

### FINAL session outcome (run 2)
SHIPPED+VALIDATED+PUSHED: batch-1 (Top-Picks gate, QA sweep, kill-switch, tennis copy); #2 full-scale
rating (validated, enabled on prod flag); #3 raw-prob columns. TRIED+REVERTED (gate discipline): #4, #9,
#11. DEFERRED (need time/data/new-sources/focused work): #5 (live data), #1 (team-id enum + prod obs),
#7 (weak soccer validation — fold into #5), #6/#8/#12/#13 (new data/product decisions).

### #11 tennis rank-reclaim — NOW VALIDATED + SHIPPED (committed 6e0922b)
Built tennis support into the historical backtest (ATP+WTA, ranked-vs-ranked, n=184). Reclaiming
tennis's dead 40% Elo weight to the ranking signal (flag ENGINE_TENNIS_RANK_RECLAIM): Brier 0.470→0.457,
logLoss 0.663→0.649, accuracy 64.7% flat (sharper confidence, same picks). Tennis-gated. This is the
fix reverted earlier when unmeasurable — the new backtest tooling made an evidenced YES possible.
PROD-ENABLE PENDING Deepak's explicit OK (permission guard blocked the auto flag set).
Future tennis lever: seed a real player-Elo pipeline (replay shows tennis-with-Elo ≈ live ~62-65%).

### Winner consistency + truthful whole-number projections (committed f55aefa, pushed)
Root cause (verified live): legacy mirror fields drifted from canonicalResult.finalPick — self-learning
recomputed finalPick but kept the stale predictedWinner, so on 3-way/soccer the badge and narration named
different teams; and the mobile projection re-derived toss-up (confidence<53) independently of the card.
Fix (8 steps): reconcileLegacyFieldsToCanonical at the serialization chokepoint; self-learning derives
predictedWinner from the recomputed finalPick; narration (deterministic + LLM + rebuild) names canonical
finalPick with an LLM "must name the pick" guard; mobile projection trusts the ONE canonical isTossUp and
the card's resolved pick (leanSide). Whole numbers: reconcileProjectionToFinal quantizes integer sports to
whole, favorite leads by >=1 (no tie-collapse), total bounded, spread/total derived from rounded; tennis
keeps 1 decimal; mobile formats integers + tracker no longer forces ".0". Validated: typecheck, 440 tests,
5 new invariant tests, replay score-MAE flat (pick unchanged; MLB margin +0.19 runs = inherent integer-
display cost). Toss-up volume handled by enabled #2/#11 + projection dedup; did NOT lower 53 or fake an IPL
toss factor (per plan — would falsely label coin-flips confident).

### DEPLOYED to Railway production — 2026-05-29
Deploy c5f244ab SUCCESS (first attempt failed on a root-dir mismatch: `railway up` must run from the repo
root since the service root is `backend/`; not a code issue). Migration applied via Dockerfile CMD
(migrate deploy && start). Both flags live: ENGINE_FULL_SCALE_RATING + ENGINE_TENNIS_RANK_RECLAIM.
POST-DEPLOY VERIFICATION (live prod): /health 200, engine 2.11.0; finalPick===predictedWinner on 98/98
directional picks (0 mismatches — consistency fix working); whole-number projections clean on the live
path (8 fractional were stale pre-deploy stored snapshots, 0 live-path); qa:predictions:live sweep
issueCount=0 (was 93 this morning — top-picks gate + tennis-warning + consistency all confirmed live).

### Tennis set-score projection — SHIPPED + DEPLOYED (d4d802f; deploy b3782037)
Replaced the synthetic "projected games" line (clamped 18.5-30.5, margin <=7.5, overstated blowouts,
unvalidatable) with a real SET score. Winner takes the match set count — best-of-3 (2) or men's Grand
Slam best-of-5 (3, detected via Grand-Slam venue + ATP tour); loser sets reflect closeness. Bypasses the
games/quantize path; mobile shows whole-number "Projected Sets". Validated on the tennis-capable replay
(ranked n=184: pick acc unchanged 64.7%, set-MAE ~0.65/side). Updated 5 tennis tests games->sets.
POST-DEPLOY (live): tennis serving set scores — best-of-3 (2-0/2-1) and men's RG best-of-5 (3-1/3-2),
winner always = pick; stale pre-deploy stored snapshots roll off as matches finish.
Also: committed the engine-doctor audit trail + agent def + .vscode/extensions.json (clean tree).

### Restore decimals for low-scoring sports (team scores now sum to the total)
User reported team scores not adding up to the total. Cause: the whole-number quantizer forced the
favorite +1, which on a low-scoring sport DISTORTS the total (1 run on an ~8-run game) so home+away no
longer equalled the real projected total. Fix: LOW_SCORING_SPORTS (MLB, NHL, MLS, EPL, UCL) keep ONE
decimal (the honest expected value — reconciles exactly, sub-unit lean stays visible, draw line forced
even); high-scoring/discrete (NBA, NCAAB, NFL, NCAAF, IPL) stay whole (a +1 nudge on a 100+/300+ total
is negligible); tennis stays sets. Total & spread always derived from the displayed home/away so the
three numbers reconcile everywhere. Mobile mirrors the per-sport precision. Removes the earlier MLB
margin-MAE distortion (+0.19). typecheck + 445 backend tests pass.

### Projection↔confidence consistency + multi-agent pre-ship audit (2026-05-29)
User caught a 59% NBA lean displaying a 111-110 (1-point) line — confidence and projected margin told
two different stories. ROOT CAUSE: the displayed win probability is the orchestrator's calibrated value,
but the projected score line came straight from the Monte Carlo mean margin; the reconcile step forced
them to agree on the WINNER but never on the MAGNITUDE. FIX (display-layer, model/grading untouched):
derive the displayed margin from the displayed confidence via the simulator's own Gaussian relation,
margin = Φ⁻¹(p)·marginSd (added Acklam inverseNormalCdf + impliedMarginForProbability). Total stays from
the sim; only the margin is sized to the confidence → monotonic in every league. NBA 59% now reads
~112-109. accuracy/calibration unchanged (graded pick/probability not touched).

Then ran a 5-dimension adversarial Workflow audit (34 agents) before ship. 8 findings confirmed (verifiers
also REFUTED 2 overstatements — an NBA cross-game inversion that can't occur given totalMin=185, and a
"visibly wrong card" that was actually a grading-loop issue). Fixed all:
- H1: soccer sub-50% picks all clamped to p=0.5 → identical floor lines. Now use the head-to-head
  CONDITIONAL prob p_pick/(p_pick+p_opp) for the margin (==win prob for 2-outcome sports); sub-50% picks
  now scale with head-to-head strength.
- H2/M3: whole-number quantizer parity made the spread share the total's parity → a 73% game could
  outshow a 75% game. Now preserve the rounded margin EXACTLY and absorb parity into the total (±1 on a
  100+/300+ total). Strictly monotonic; total clamped to sport bounds.
- H3: IPL marginSd=36 printed 37-46 run blowouts at high confidence. Added displayMarginSd() capping the
  DISPLAY SD to 18 for IPL — simulation/model untouched (no calibration risk, no IPL backtest needed).
  85% now ~19 runs, 90% ~23.
- M1: when self-learning flips the leader (predictedWinner=null), legacy predictedOutcome/confidence were
  derived from the raw leader, mis-grading flipped picks into the self-learning loop. Now derived from
  canonicalResult.finalPick; confidence is the PICK's probability, not an unconditional max().
- M2: toss-up boundary (0.53) compared raw prob while the badge shows Math.round → "53% TOSS-UP".
  Both backend (isMarketAwareTossUp) and frontend (prediction-display) now compare Math.round(conf).
- L1: extreme-confidence low-scoring picks projected literal shutouts (NHL 4.0-0.0 at 99%). Reserved a
  0.5 loser floor in maxMargin → 99% now ~3.5-0.5.
- L2: mobile getProjectionDisplay computed scores from raw projectedHome/AwayScore; added a defensive
  flip-guard so the score line can never lead the non-picked team on old/unreconciled stored data.
Verification: 454 backend tests pass (+9 new incl. cross-game monotonicity, soccer sub-50% scaling, IPL
realism, no-shutout), backend + mobile typecheck clean, live-reconciler sweep across all leagues sane.
SHIPPED + DEPLOYED (commit fcb5ef4; Railway deploy 2026-05-29). POST-DEPLOY: /health 200, engine
2.11.0; live spot-check of 48 predictions -> 0 confident-pick-with-near-tie-line inconsistencies. Stale
pre-deploy stored snapshots (decimal NBA, games-based tennis) regenerate to the new format as the slate
refreshes. Mobile (prediction-display/projection-display) ships on the next app build/reload.

### Run 3 — Elo unfreeze + cache TTL; full-scale validated-but-held (2026-06-02)
MEASURE (live /api/calibration, n=1635): ALL acc 56.3%, Brier 0.244 (barely > random). MLB 52.2%
(n727, 60-65 band +24pt over-confident), MLS 48.1%, NBA 67.7%/EPL 64.8%/TENNIS 59.7% healthy but
under-confident (NBA 50-55 band wins 69%). 57% of all picks compressed into the 50-55% band.
DIAGNOSE (6-dim adversarial workflow, 32 agents, 20 verified findings): two root causes —
(1) Elo FROZEN: updateEloAfterGame has no runtime caller, no Elo cron, grading never writes ratings →
rating_diff (0.40 weight, the dominant factor) reads stale/default 1500. (2) systemic under-confidence
(full-scale flag OFF → rating delta shrunk ~60% pre-logistic).

SHIPPED (validated, low-risk):
- S2 Elo refresh cron (worker.ts): wired the never-called runEloUpdate into a guarded daily 08:00 UTC
  job over the 10 team-sports; added fetchLeagueTeamIds (espnStats.ts, ESPN teams endpoint). Failsafe —
  any league that errors is skipped, ratings stay as-is. VALIDATED via new REPLAY_FREEZE_ELO harness
  A/B (frozen all-1500 vs rolled, legacy, 180d): overall Brier 0.483→0.476, NBA 0.474→0.454, NHL
  0.491→0.485, MLB +0.005 (flat — weak baseball Elo). Accuracy at n40 too noisy (frozen MLB 70% was a
  lucky sample); Brier is the clean signal and shows rolled Elo is better-or-neutral everywhere.
- S3 eloCache TTL (lib/elo.ts): cache was permanent → the web process would never see the worker cron's
  writes (separate processes). Added 6h TTL (entries store fetchedAt; getEloRating re-reads when stale).
  Unit-tested (proves stale re-read). Precondition for S2 to reach the serving process.

HELD (validated net-positive but trips a guardrail — needs a conflict-aware fix first):
- S1 full-scale rating (#2): powered 180d A/B (n40/league) confirmed net-positive — overall acc
  58.3→59.2, confidence finally aligns with accuracy (NBA conf 56→65 for a ~65% model, NHL 54→57,
  MLB 55→58, no acc regression). BUT enabling it trips the NBA playoff thin-data guardrail test: a
  cold+injured higher-Elo home team vs a red-hot healthy away team → full-scale lets stale Elo + home
  court drown the form signal and wrongly favors the cold team. Root cause: full-scale takes Elo at full
  scale while other factors enter weight-diluted, so Elo dominates when signals CONFLICT. Landed a
  partial fix (sumRatingDelta eloScale: honors any rating_diff weight reduction) but it's necessary-not-
  sufficient (the canonical conflict case still flips). Kept flag OFF by default; needs a conflict-aware
  down-weight (shrink Elo when trusted factors strongly disagree) before enabling. Added REPLAY_FREEZE_ELO
  diagnostic to the replay harness.
DEFERRED (verifiers killed as overfit/small-n): per-league temperature recalibration (non-monotonic
curves), MLB structural change (Elo genuinely weak; baseball is hard), MLS over-reaction (n129 within
CI of 50%), all IPL tuning (n10 noise). 461 backend tests pass, typecheck clean. NOT yet deployed.

### Run 3 UPDATE — full-scale UN-HELD: conflict-aware fix resolves the regression
Built the conflict-aware blend in sumRatingDelta (index.ts): the Elo base blends back toward its legacy
weight-shrunk value in proportion to how strongly the trusted non-rating factors OPPOSE it
(opposition = min(1, |adjustments| / |legacyBase|)). Agreeing signals keep the full decompression;
strong disagreement falls back to balanced legacy. Result: the NBA playoff thin-data guardrail PASSES
under full-scale ON, and the decompression win SURVIVES. Re-validated on the powered 240-day replay
(n=100/league, rolled Elo), OFF vs ON: overall acc 58.0→58.7 (NBA flat 66, NHL 53→55, MLB flat 55 — no
regression), Brier improves in EVERY league (NBA 0.439→0.434, MLB 0.480→0.476, NHL 0.484→0.480, overall
0.468→0.464), confidence aligns with accuracy (NBA conf 59.9→67.7 for a 66% model). GRADUATED full-scale
to ON by default (ENGINE_FULL_SCALE_RATING=false to force legacy). All 462 backend tests pass under the
new default, typecheck clean. This cycle ships S1 (full-scale, conflict-aware) + S2 (Elo unfreeze cron) +
S3 (cache TTL) together — both engine root causes (frozen Elo + under-confidence compression) fixed and
validated. NOT yet deployed (awaiting authorization).

### Run 4 — Accuracy push (free, no paid APIs) — SHIPPED + DEPLOYED (2026-06-02)
User: recent picks "didn't do well"; calibration tweaks ≠ accuracy; APIs too expensive → find the free
workaround. Accuracy-only adversarial hunt (33 agents) + extensive leak-aware replay A/Bs.
ROOT CAUSE of low accuracy: the engine is a FACTOR-ONLY model near its ceiling (NBA 66/EPL 64 maxed),
with the single biggest predictor — the betting market — at 6-10% weight and no real odds feed
(SHARPAPI_KEY unset). FREE WORKAROUND FOUND: ESPN core-odds API serves real DraftKings moneylines
(home/away/draw) for every major league, free, no key, INCLUDING historical games (so it's backtestable).
SHIPPED (all free, default-on, validated on the 240d n=100/league replay):
- Free ESPN market anchor (lib/espnOdds.ts → de-vig → MarketConsensus, wired in shadow.ts). LEAGUE-AWARE
  weight (index.ts marketWeightForSport): heavy where the factor model is weak (MLB 0.65, soccer 0.60,
  NHL 0.40), light where it's strong (NBA 0.15 — our model beats the line). resolveBlendOutcome lets a
  CONFIDENT market flip the pick (relaxes preserveNonMarketOutcome); permissive flip default 0.52.
- MLB starting-pitcher zero-out bug fix (factors/mlb.ts): ESPN-only pitchers had undefined IP →
  regression×0 → ace contributed nothing. Now regress against a 70-IP prior when ERA present.
- MLS draw-form bug fix (factors/base.ts): draws now count 0.5 in the win-rate (were denominator-only).
- Tennis player-Elo (lib/tennisElo.ts + worker cron): rolls per-PLAYER Elo from ESPN tennis results
  (ESPN-consistent ids, no Sackmann name-matching), persists via the proven initializeEloFromSchedule.
  The audit's strongest lever (replay +5-8 picks); lands in prod as the daily cron runs.
- Pick-STABILITY lock (games.ts): strengthened the existing shouldPromotePredictionUpdate gate —
  MATERIAL_PICK_FLIP_LEAD_PP 5→7. A shown pick only flips when the new side is decisively ahead (>=7pp,
  the signature of real news); sits AFTER the market-flip so the heavy market weight can't chase the
  line tick-by-tick. Betting-product trust requirement from the user.
- (Earlier this session, also shipped here) full-scale rating (conflict-aware, default ON), Elo-unfreeze
  daily cron + eloCache TTL.
HEADLINE replay A/B (original engine vs full package, n=100/league): overall acc 52.4→54.2 (+1.8);
MLB 53→57 (+4), EPL 46→49 (+3), NHL 53→54, MLS 44→45, NBA flat 66 but confidence 60→67 (now honest).
Plus tennis +5-8 (prod, as cron runs). 468 backend tests pass, typecheck clean. Honest ceiling: free
data buys incremental, league-specific gains — NOT a jump to 65% across the board.
DEPLOYED: web (clutch-picks) + worker (clutch-picks-worker), both /health 200, engine 2.11.0.
NOT yet done: NHL real-starting-goalie (+2-4, needs a new ESPN athlete-stats fetch) — fast-follow.
