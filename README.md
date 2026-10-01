# poker-ai

Six AI bots play a Texas Hold'em tournament. You watch.

<img width="1422" height="894" alt="image" src="https://github.com/user-attachments/assets/8c83985e-344e-4e48-a13c-0d94028e47a6" />


Each bot has a personality and a mood that shifts as it wins and loses, decides what to do with
a small local classifier, and thinks out loud through a tiny local LLM. The audience sees
everything — every hole card, every private thought. The bots see only what a real player
would. Nobody at the table is human.

Everything runs locally. No cloud, no API keys.

    make install
    make models-up      # jeff + llama.cpp containers, on 8781 and 8782
    make dev            # then open http://127.0.0.1:8780

Deployed, it is tailnet-only at `https://poker.<tailnet>.ts.net`:

    make deploy-build && make deploy-up
    tailscale serve --service=svc:poker --bg 8780   # once, needs admin approval

## What it is made of

- **`api/`** — a Deno server that owns every rule, every decision and all of the pacing.
  - `engine/` is pure Texas Hold'em: deck, evaluator, equity, betting, side pots. No AI in it.
  - `bots/` turns game state into something a model can read, and its answer back into a move.
  - `inference/` is the single-slot queue in front of both models, and their clients.
  - `broadcast/` is the SSE hub and the beat clock.
- **`client/`** — React, built by esbuild, rendering the event stream. It holds no poker rules.
- **`shared/`** — the wire contract, imported by both sides.

## Useful commands

    make test                  # 46 tests, including a full tournament with both models down
    make simulate              # headless tournaments, per-bot behaviour stats
    make sanity                # hand-written situations vs the rule bot
    make SOURCE=jeff sanity    # the same set vs the classifier, as a tuning report
    make bench                 # what the models actually cost on this machine
    curl -s localhost:8780/api/debug | jq    # queue, latencies, fallbacks, memory

## It works without the models

That is not a fallback in the emergency sense — on a four-core machine with no GPU it is a
normal way to run. Rule-based bots play recognisably distinct poker on their own, template
monologues carry the personalities, and a full tournament finishes with both services stopped.
Jeff makes the bots less predictable; it is not what makes them characters.

## Findings

Two write-ups in `reports/`, both of which cost real time to learn:

- **[Is a purpose-trained decision classifier worth it?](reports/2026-09-30-decision-model-comparison.md)**
  — the rule bot, Jeff and a plain LLM's answer-letter log-probabilities, measured against the
  same twelve situations. Includes why the small model answers the label rather than the
  question, and why a hand-written rule bot beats all of them at playing well.
- **[Running the Jeff classifier on CPU](reports/2026-09-29-jeff-on-cpu.md)** — what it takes to
  get it running without a GPU, measured latency against thread count, and the API details its
  README gets wrong.

See `CLAUDE.md` for how to work on the code. The original specification was removed once v1
was complete; `reports/2026-10-01-spec-coverage.md` records what it required and what was
deliberately left out.

## Licence

Apache 2.0, see [LICENSE](LICENSE). The decision model it talks to, [firelex/jeff](https://github.com/firelex/jeff), is MIT-licensed code with Apache 2.0 weights; neither is bundled here.
