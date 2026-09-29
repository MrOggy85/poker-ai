# poker-ai

A Texas Hold'em tournament played entirely by AI bots and watched live in a browser.
`PROJECT.md` is the specification; this file is what you need to know to work on it.

## Shape

- **Server: Deno** (`api/`). Owns *all* game logic, state and pacing.
- **Client: React + esbuild** (`client/`). Renders and animates. It holds a reducer over the
  server's event stream and nothing else - no betting rules, no winner logic, no equity.
  Its only interaction is the control bar (pause/resume, speed, new tournament).
- `shared/` is imported by both sides, so it must stay dependency-free and DOM-free.
- Mirrors the layout and build conventions of `~/kotoba`. When in doubt, look there first.

## Commands

    make install               # npm deps for the client (the api has none)
    make dev                   # server on :8780 + esbuild watcher
    make build                 # production bundle into api/client/
    make check                 # deno check over the whole tree + tsc --noEmit
    make test                  # deno test
    make simulate              # headless tournaments, per-bot behaviour stats
    make sanity                # hand-written situations vs the rule bot (pass/fail)
    make SOURCE=jeff sanity    # the same set vs the classifier (a tuning report)
    make bench                 # measure real Jeff / LLM latency on this machine
    make models-up             # start the jeff + llama.cpp containers
    make deploy-build && make deploy-up

`/api/debug` reports queue depth, per-model latencies, fallback counters, breaker state and
RSS. Check it first when the bots are behaving oddly - a high `ruleFallbacks` or `lowConfidence`
says the classifier is not actually driving.

Ports: app **8780**, Jeff **8781**, llama.cpp **8782**. 8777 and 8778 are taken by other apps
on this machine.

## GOTCHAs

- **`deno` is not on PATH here** (it lives at `~/.deno/bin/deno`). The Makefile spells out the
  path and prepends it to `PATH` before calling npm, because `client/package.json`'s scripts
  invoke a bare `deno` - they have to, since the Docker client stage *does* have it on PATH.
  Running `npm run build` directly from `client/` will fail with `sh: 1: deno: not found`.
- **`~/.npmrc` sets `ignore-scripts=true`, and that is fine** - esbuild's native binary arrives
  as the `@esbuild/linux-x64` optional dependency, which has no `scripts` block at all. The
  postinstall it skips only replaces the CLI shim, which nothing here uses: `build.ts` drives
  the JS API. **Never add a project-local `.npmrc` with `ignore-scripts=false`** to "fix" a
  build error - that silently undoes the operator's supply-chain hardening. If the binary ever
  does go missing, point `ESBUILD_BINARY_PATH` at it from the Makefile instead.
- **The docker context is wrong by default** - the active context is `rootless` but the daemon
  is rootful. Always `docker -c default`.
- **No `Math.random` anywhere in `api/`.** Everything random draws from the seeded `Rng` in
  `shared/rng.ts`, or games stop being replayable from their seed.
- **Information hiding is a hard requirement** (PROJECT.md section 10) with a test behind it.
  A bot brain takes a `BotView`, never the full `HandState`. Never widen that signature.

## Conventions worth knowing before you touch the engine

- **A bet or raise `amount` is the total street commitment - the "raise to" number, not the
  increment.** `call` carries no amount at all. Every amount a bot produces is derived by code
  from `LegalActions`; nothing parses a number out of a model reply. Engines that leave this
  unwritten get it wrong in both directions.
- **RNG streams are derived and named, never one global sequence** (`shared/rng.ts`). The deck
  for hand 12 draws from `deck:h12`, an equity estimate from `equity:p3:h12:river`, action
  sampling from `sample:p3:h12:flop:0`. That is what lets you change the equity sample count,
  or add a randomised feature, without reshuffling every deck in every historical seed.
- **A short all-in does not reopen the betting** for players who have already matched. It is
  the rule hobby engines get wrong most often, so it has its own test.
- **Option keys are semantic and stable** (`F`, `X`, `C`, `B1`, `B2`, `R1`, `R2`, `A`), not
  positional `"1".."5"`. With positional keys, "3" means something different depending on which
  actions happen to be legal - which is exactly the inconsistency Jeff's README warns costs you
  game results.

## Tuning the bots

Three things that cost real time to find, and will be re-found by anyone who changes the
prompt or the option menu:

- **Word buckets must be relative to the table, not absolute.** Six-handed, every hand averages
  a one-in-six share, so absolute equity thresholds called pocket aces "very weak, almost
  certainly behind" and the model answered near-uniformly. `equityWords` takes the number of
  live players for this reason.
- **The option menu biases the answer as much as the wording does.** Two raise sizes against
  one fold and one call put twice the probability mass on aggression, and the bots raised
  hands they should have folded. One sized option per intent; the size comes from the
  personality.
- **Nothing in an option may echo a personality.** "Fold: keep your chips and wait for a
  better hand" was close enough to The Rock's own description that it folded pocket aces.

Wording changes have large, non-obvious effects: rephrasing one option in a way that read
better to a human collapsed the model's confidence across every unrelated case. **Tune against
`make SOURCE=jeff sanity` and keep the number** - never by ear. The current score is 9/12; the
rule bot must stay at 12/12 and has a test.

## Jeff: corrections to PROJECT.md

PROJECT.md was written against the README; these come from reading `firelex/jeff` v0.2.0
source, and the source wins.

- **Max options is 26, not 255.** The server reads `max_options` from `decision_config.json`
  and 422s beyond it. Our action menus are at most 6, so this only constrains future ideas.
- **`noul` answers are `{"type":"noul","noul":<float>}` and nothing else** - no `probabilities`,
  no `confidence`. Code that assumes one answer struct across question types breaks here.
- **`score` returns the expected *index*** over the criteria list (0..n-1), not a 0-1 value,
  and `score.criteria` is a **list** of 2-10 entries while `choice.criteria` is a dict.
- **Jeff serves one request at a time and rejects rather than queues**: `529` with
  `Retry-After: 1`. Our inference queue must be its only caller, and must still handle 529.
- The request model is pydantic `extra="forbid"` - any stray field is a 422.
- Endpoints: `POST /v1/systemone`, `GET /health`, `GET /v1/models`.
- **`uv sync` pulls the CUDA torch stack** (~2-3 GB of GPU libraries that cannot run here),
  because `pyproject.toml` pins `torch==2.14.0` with no CPU index. Set `UV_TORCH_BACKEND=cpu`.

## Measured on this machine (2026-09-29)

| | median | p95 |
|---|---|---|
| Jeff decision, 2 threads | 8.3 s | 8.7 s |
| Jeff decision, **3 threads** | **3.7 s** | 3.8 s |
| Jeff decision, 4 threads | 3.1 s | 3.3 s |
| Monologue, Qwen2.5-0.5B Q4_K_M, 2 threads | 1.2 s | 1.7 s |

Realistic prompts (~200 input tokens, five worded options), not toy strings - token count is
most of the cost for a one-pass classifier. The cliff between 2 and 3 threads is why
`models-up.sh` runs Jeff at `--cpus=3`: it buys nearly all the speed and still leaves a core
for the rest of the machine. **Keep `OMP_NUM_THREADS` equal to `--cpus`** - torch does not read
the cgroup quota, so the default (`nproc` = 4) runs 4 threads inside a 3-core budget and is
slower than 3.

At 3.7 s Jeff is in the hot path as PROJECT.md intends, but only just: at `slow` pacing the
beat already on screen hides most of it. If it ever regresses, the escape hatches in order are
pacing lookahead, then asking Jeff only about close decisions, then `decision.enabled = false`.

## Jeff container traps

- **`flash-linear-attention` must not be installed.** 18 of the model's 24 layers are linear
  attention, and transformers dispatches those to fla's Triton kernels whenever fla merely
  *imports*. fla prints "Triton is not supported on current platform, roll back to CPU" and
  then calls a Triton kernel anyway, so **every** request dies with
  `RuntimeError: 0 active drivers ([])`. Removing it makes transformers fall back to
  `torch_chunk_gated_delta_rule`, which is pure PyTorch and works. Nothing in jeff's own source
  imports fla.
- **The distribution is `fla-core`, not `flash-linear-attention`** as `pyproject.toml` spells
  it. `uv pip uninstall flash-linear-attention` prints a warning and does nothing. The
  Dockerfile therefore verifies with an `import fla` that must fail.
- **Do not run the server through `uv run`.** uv re-syncs on every invocation, which reinstalls
  the dev group *and* fla, and makes container start depend on PyPI being reachable. The CMD
  calls `/opt/jeff/.venv/bin/jeff-serve` directly.
- **529 confirmed live**: a second concurrent request gets `529`, header `retry-after: 1`, body
  `{"detail":"The model is busy. Retry shortly."}`. In production a 529 means something other
  than the inference queue is talking to Jeff - a stray benchmark, a second container - so
  count it and surface it rather than treating it as normal load shedding.

Full write-up of the model setup, including the container traps:
`~/claude_harness/reports/2026-09-29-jeff-classifier-on-cpu.md`.

## This machine

Intel N100: 4 cores, **no GPU**, 15 GiB RAM. PROJECT.md's Apple Silicon / MLX assumptions do
not apply - Jeff runs the PyTorch CPU backend. Its own README reports 463 ms per decision on
32 threads, so expect seconds here; `make bench` measures it. The design stays playable
without either model: rule-based decisions and template monologues are a permanent path, not
a stub.
