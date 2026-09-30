# Running the Jeff decision classifier on this machine

**Date:** 2026-09-29
**Context:** this project uses `firelex/jeff` (checkpoint
`mstrasser/Jeff-Qwen3.5-0.8B`) as a local decision classifier and a 0.5B GGUF under
llama.cpp for flavour text. Both run as containers.

## Summary

Jeff works on this machine at **3.7 s per decision**, which is usable. Getting there needed one
genuine fix — removing `flash-linear-attention` — and one non-obvious tuning decision about
thread count. The numbers below are measured, not estimated.

## GOTCHA: `flash-linear-attention` makes every request fail on CPU

Eighteen of Jeff-Qwen3.5-0.8B's twenty-four layers are `linear_attention`. Transformers
dispatches those through `@use_kernel_func_from_hub_with_fallback("chunk_gated_delta_rule",
"fla")`, which resolves **at import time**: if `fla` imports successfully it is preferred, and
only an ImportError falls back to transformers' own `torch_chunk_gated_delta_rule`.

`fla` imports fine here. It even prints

    UserWarning: Triton is not supported on current platform, roll back to CPU.

and then calls a Triton kernel anyway, so **every single inference** dies with

    RuntimeError: 0 active drivers ([]). There should only be one.

The fix is to make `fla` unimportable. Nothing in Jeff's own source imports it — it is there to
accelerate GPU inference, which this machine cannot do.

Two traps in doing that:

- **The distribution is named `fla-core`, not `flash-linear-attention`** as `pyproject.toml`
  spells it. `uv pip uninstall flash-linear-attention` prints `warning: Skipping ... as it is
  not installed` and exits 0, having done nothing.
- Uninstalling leaves the package directory importable, so `rm -rf` the leftover too. Verify
  with an `import fla` that must *fail*, or the build passes and every request still 500s.

`models/jeff/Dockerfile` does all of this and fails the build if `fla` survives.

## GOTCHA: do not run the server through `uv run`

`uv run jeff-serve` re-syncs the environment on every invocation. That reinstalls the dev group
*and* `fla`, and makes container start depend on PyPI being reachable — a boot-time dependency on a package
index being reachable, which is not something a model server should have. Call the venv entry point
directly: `/opt/jeff/.venv/bin/jeff-serve`.

## GOTCHA: `uv sync` pulls the CUDA torch stack

`pyproject.toml` pins `torch==2.14.0` with no CPU index, so the default PyPI wheel drags in
2–3 GB of CUDA libraries that cannot run on Alder Lake-N graphics. Set `UV_TORCH_BACKEND=cpu`.

## Measured performance

Realistic prompts (~200 input tokens, a worded poker state and five options), median of ten
after a discarded warm-up:

| threads (`--cpus` = `OMP_NUM_THREADS`) | median | p95 |
|---|---|---|
| 2 | 8.3 s | 8.7 s |
| **3** | **3.7 s** | 3.8 s |
| 4 | 3.1 s | 3.3 s |

**The cliff is between 2 and 3 threads**, not where you would guess — going from 2 to 3 more
than halves the time, while 3 to 4 buys another 16%. So `--cpus=3` is the sweet spot: nearly
all the speed, and a core left for whatever else the machine is doing. The obvious-looking
`--cpus=2` would have been more than twice as slow.

**Keep `OMP_NUM_THREADS` equal to `--cpus`.** Torch does not read the cgroup quota, so the
default (`nproc` = 4) runs four threads inside a three-core budget and is measurably *slower*
than three.

Monologue model for comparison: Qwen2.5-0.5B-Instruct Q4_K_M under
`ghcr.io/ggml-org/llama.cpp:server` at 2 threads, **1.2 s median, 1.7 s p95**. There is no
cmake on this host, so the prebuilt image is the only sane route.

## API notes (v0.2.0 source, not the README)

The README documents the request only, and its one sentence about responses is wrong for one of
the three question types.

- `POST /v1/systemone`; also `GET /health`, `GET /v1/models`.
- **Max options is 26**, not the 255 in the pydantic schema — the server reads `max_options`
  from `decision_config.json` and 422s past it. `GET /health` reports the real number.
- **`noul` answers are `{"type":"noul","noul":<float>}` and nothing else** — no
  `probabilities`, no `confidence`. Uniform access across answer types throws.
- **`score` returns the expected *index*** over the criteria list (0..n-1), and `score.criteria`
  is a **list** of 2–10 entries while `choice.criteria` is a dict.
- The request model is `extra="forbid"`: any stray field is a 422, not politely ignored.
- **It serves one request at a time and rejects rather than queues**: `529`, header
  `retry-after: 1`, body `{"detail":"The model is busy. Retry shortly."}`. Confirmed live.
  A sustained 529 count means a second caller; a brief one during a redeploy is the outgoing
  container's last request still being served.

## Using a classifier for decisions, in general

Three things cost real time to discover and would apply to any similar use:

1. **Word buckets have to be relative to the situation, not absolute.** "Win chance > 80% =
   very strong" is fine heads-up and nonsense six-handed, where every hand averages a 1-in-6
   share. With absolute thresholds, pocket aces and seven-deuce both came out "very weak,
   almost certainly behind" and the model answered with a near-uniform distribution.
2. **Confidence near zero means no opinion, and sampling it is not variety.** Jeff's confidence
   is chance-corrected, so 0 is a uniform distribution. Sampling that at a low temperature
   turns the largest speck of noise into a deterministic choice. Below a floor, use code.
3. **The shape of the option menu biases the answer as much as the wording.** Offering two
   raise sizes against one fold and one call puts twice the probability mass on being
   aggressive; the model raised hands it should have folded. One sized option per intent fixed
   it without changing a word of the prompt.

And the README's warning that wording changes results is an understatement. On a twelve-case
sanity set, rephrasing one option from "put real money at risk" to "build the pot and make them
pay" — which reads better to a human — dropped the score and collapsed confidence toward zero
across every unrelated case. Tune these against a fixture, never by ear.
