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

    make install      # npm deps for the client (the api has none)
    make dev          # server on :8780 + esbuild watcher
    make build        # production bundle into api/client/
    make check        # deno check + tsc --noEmit
    make test         # deno test
    make bench        # measure real Jeff / LLM latency on this machine
    make models-up    # start the jeff + llama.cpp containers
    make deploy-build && make deploy-up

Ports: app **8780**, Jeff **8781**, llama.cpp **8782**. 8777 and 8778 are taken by other apps
on this machine.

## GOTCHAs

- **`deno` is not on PATH here** (it lives at `~/.deno/bin/deno`). The Makefile spells out the
  path and prepends it to `PATH` before calling npm, because `client/package.json`'s scripts
  invoke a bare `deno` - they have to, since the Docker client stage *does* have it on PATH.
  Running `npm run build` directly from `client/` will fail with `sh: 1: deno: not found`.
- **esbuild is imported as `npm:esbuild@0.25.0` from Deno**, not executed from `node_modules`.
  `~/.npmrc` sets `ignore-scripts=true`, so npm never fetches esbuild's platform binary; Deno
  fetches its own. Do not "fix" this by switching to a node_modules invocation.
- **The docker context is wrong by default** - the active context is `rootless` but the daemon
  is rootful. Always `docker -c default`.
- **No `Math.random` anywhere in `api/`.** Everything random draws from the seeded `Rng` in
  `shared/rng.ts`, or games stop being replayable from their seed.
- **Information hiding is a hard requirement** (PROJECT.md section 10) with a test behind it.
  A bot brain takes a `PlayerView`, never the full `HandState`. Never widen that signature.

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

## This machine

Intel N100: 4 cores, **no GPU**, 15 GiB RAM. PROJECT.md's Apple Silicon / MLX assumptions do
not apply - Jeff runs the PyTorch CPU backend. Its own README reports 463 ms per decision on
32 threads, so expect seconds here; `make bench` measures it. The design stays playable
without either model: rule-based decisions and template monologues are a permanent path, not
a stub.
