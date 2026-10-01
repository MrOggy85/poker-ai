# What the specification asked for, and what was built

**Date:** 2026-10-01

`PROJECT.md` — the original specification — was removed once v1 was complete. This records
what it required, what was built, and the handful of things that were deliberately not. It
exists so that "we never did X" stays a known decision rather than becoming an undiscovered
gap. The spec itself is still in git history if anyone wants the original wording.

## Built as specified

| Spec | Where |
|---|---|
| §5 — all eleven components | `api/engine`, `api/bots`, `api/inference`, `api/broadcast`, `api/tournament`, `client/src` |
| §6 — No-Limit Hold'em, all-ins, side pots, blinds, eliminations | `api/engine/`, with chip conservation tested over 1,000 random hands at 2–9 seats |
| §7 — all seven personality fields, eight moods, public-only opponent notes | `api/bots/personalities.ts`, `mood.ts`, `notes.ts` |
| §8.1–8.4, 8.6 — numbers to words, discrete options, temperature sampling, fallbacks | `api/bots/words.ts`, `options.ts`, `sampling.ts`, `rules.ts` |
| §9 — monologue after the action, short, template fallback, never seen by other bots | `api/inference/monologue.ts`, `api/bots/templates.ts` |
| §10 — information hiding | `api/bots/view.ts`, tested end to end over a whole tournament |
| §11 — four speeds, thinking → thought → action, pause, hand-end pause | `api/broadcast/pacing.ts` |
| §12 — the full table layout, side panel and controls | `client/src/components/` |
| §13 — all sixteen events and all four commands | `shared/events.ts` |
| §14 — one config file covering every listed item | `config/tournament.json` |
| §15 — structured hand log: seed, deals, states sent, probabilities, choices | `api/log/handlog.ts` |
| §16 — engine, information-hiding, personality, resource and fallback tests | 52 tests; `/api/debug` for the resource numbers |
| §18 — runs end to end unattended, works with both models down, bots distinct, reproducible from a seed | verified |

Two environment differences, neither a shortfall: the spec targets an Apple Silicon MacBook
with Jeff's MLX backend, and this runs on an Intel N100 with the PyTorch CPU backend.

## Deliberately not built

**§8.5 — batched `noul` and `score` questions** (suspicion meter, pressure score). The spec
makes these conditional: *"Only add these if they don't noticeably slow the game."* A decision
already costs ~4.1 s here, so there is no headroom. The wire types exist in
`api/inference/jeff.ts` if the condition ever changes.

**§12 — the suspicion meter.** Depends on the `noul` question above.

**§15 — replaying a finished hand in the web view.** Marked optional in the spec. The hand log
carries everything needed for it.

## Known gaps — real, not optional

**§16 asks for 30–50 hand-written decision situations; `fixtures/sanity.ts` has 12.** Enough to
catch a model folding pocket aces, and it did. Not enough to distinguish 7/12 from 5/12, which
mattered when comparing decision providers — see the caveat in
`2026-09-30-decision-model-comparison.md`. Worth growing if the wording is tuned again.

**§6 says the table is configurable 2–9 players; only 2–6 works.** There are six personalities
and `castOf` throws above that. Fixing it means writing three more characters, not changing
code.

**§3 sets a budget of ~4 GB for both models together; the real figure is ~4.7 GB.** Jeff alone
is 4.05 GiB resident — the spec's estimate assumed MLX on Apple Silicon rather than PyTorch on
CPU. The monologue model is 0.5 GB and well inside what was assumed. This fits the machine but
leaves less headroom than planned.
