# poker-ai

Six AI bots play a Texas Hold'em tournament. You watch.

Each bot has a personality and a mood that shifts as it wins and loses, decides what to do
with a small local classifier, and thinks out loud through a tiny local LLM. The audience sees
everything - all hole cards, every private thought. The bots see only what a real player would.
Nobody at the table is human.

Everything runs locally. No cloud, no API keys.

    make install
    make models-up      # jeff + llama.cpp containers
    make dev            # then open http://127.0.0.1:8780

See `PROJECT.md` for the specification and `CLAUDE.md` for how to work on it.
