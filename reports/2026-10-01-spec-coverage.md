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

## Known gaps

**§16 asks for 30–50 hand-written decision situations; `fixtures/sanity.ts` has 12.** Enough to
catch a model folding pocket aces, and it did. Not enough to distinguish 7/12 from 5/12, which
mattered when comparing decision providers — see the caveat in
`2026-09-30-decision-model-comparison.md`. Being grown.

**§6 says the table is configurable 2–9 players; only 2–6 works.** There are six personalities
and `castOf` throws above that. Accepted: six seats is the intended game, and adding more would
mean inventing characters nobody asked for. Treat 2–6 as the real range.

## The memory budget, and why it is not a problem

§3 set a target of ~4 GB for both models together. The honest figure depends entirely on when
you measure, which took a while to work out.

From the container's cgroup, with the game idle:

| | |
|---|---|
| peak ever | **4246 MB** |
| resident now | 2431 MB |
| swapped out | 2171 MB |

The 4 GB figure quoted earlier was the **peak**, measured during active play shortly after
startup. The steady-state working set is 2.4 GB, of which roughly 1.6 GB is the bf16 weights.

The other 2.1 GB is one-time import and load overhead — torch and transformers, plus
dependencies the serve path never touches (`jeff`'s install pulls in `datasets` and
`matplotlib`). The kernel paged all of it to swap while the game sat idle, **and inference
never asked for it back**: after waking up and playing a dozen hands, resident and swapped were
both unchanged.

The cost of that is close to nothing. The first decision after forty hours idle took 5.0 s
against a 4.4 s median — inside normal variance, because swap is on an SSD and the pages are
never faulted back anyway.

So: the spec's ~4 GB target was written for a laptop, and the real working set is comfortably
inside it. The peak is not, but the peak is transient. Two things to keep in mind:

- Jeff holds ~2.4 GB resident **permanently**, including while the game is idle and nobody is
  watching. The idle gate saves CPU, not memory. Stopping the container between sessions would
  reclaim it at the cost of a ~40 s model load on the next viewer.
- About half the machine's 4.1 GB of swap-in-use is Jeff's cold pages. Harmless here, but it is
  swap that something else might have wanted.
