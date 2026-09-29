# Monologue model

`deploy/models-up.sh` runs the prebuilt CPU image `ghcr.io/ggml-org/llama.cpp:server` - this
machine has no cmake, so building llama.cpp from source is not on the table.

Weights live in `models/weights/` (gitignored) and are downloaded by `models-up.sh`:

- **`qwen2.5-0.5b-instruct-q4_k_m.gguf`** (~400 MB) - the default. One or two short sentences
  is all this model is ever asked for, so 0.5B at 4-bit is deliberate, not a compromise.
- If `make bench` shows it is too slow, drop to `SmolLM2-360M-Instruct` Q4_K_M. The monologue
  is flavour: a template line is an acceptable outcome, a stalled game is not.

The server is started with `-t 2` to match the container's CPU limit, a small context and a
hard `n_predict` cap, because the inference queue serialises everything anyway.
