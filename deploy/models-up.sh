#!/bin/bash
# Starts the two model services on loopback: Jeff (decisions) and llama.cpp (monologues).
# Separate from the app so the app can be restarted without evicting 2 GB of loaded weights.
#
# The active docker context on this machine is `rootless` but the daemon running everything
# is rootful, hence `-c default` on every call.
if [[ -f "${UTIL_SH:-$HOME/scripts/util.sh}" ]]; then
  . "${UTIL_SH:-$HOME/scripts/util.sh}"
else
  echo_green() { printf '\033[32m%s\033[0m\n' "$*"; }
  echo_yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
  echo_red() { printf '\033[31m%s\033[0m\n' "$*"; }
fi
set -uo pipefail

cd "$(dirname "$0")/.."

DOCKER="docker -c default"
WEIGHTS="$PWD/models/weights"
JEFF_PORT=8781
LLAMA_PORT=8782
GGUF=qwen2.5-0.5b-instruct-q4_k_m.gguf

mkdir -p "$WEIGHTS"

# --- monologue: llama.cpp -----------------------------------------------------------------
# No cmake on this host, so the prebuilt CPU image is the only sane route.
if [[ ! -f "$WEIGHTS/$GGUF" ]]; then
  echo_yellow "downloading $GGUF (~470 MB)..."
  curl -sSL -m 900 -o "$WEIGHTS/$GGUF" \
    "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/$GGUF" \
    || { echo_red "download failed"; exit 1; }
fi

echo_yellow "starting poker-llama..."
$DOCKER rm -f poker-llama >/dev/null 2>&1 || true
$DOCKER run -d \
  --name poker-llama \
  --restart unless-stopped \
  --cpus=2 \
  -p 127.0.0.1:$LLAMA_PORT:8080 \
  -v "$WEIGHTS:/weights:ro" \
  ghcr.io/ggml-org/llama.cpp:server \
  -m "/weights/$GGUF" --host 0.0.0.0 --port 8080 -t 2 -c 1024 -n 48 \
  || { echo_red "poker-llama failed to start"; exit 1; }

# --- decisions: jeff ----------------------------------------------------------------------
if ! $DOCKER image inspect poker-jeff:latest >/dev/null 2>&1; then
  echo_yellow "building poker-jeff:latest (slow - it resolves the CPU torch stack)..."
  $DOCKER build -t poker-jeff:latest models/jeff \
    || { echo_red "jeff image build failed"; exit 1; }
fi

if [[ ! -d "$WEIGHTS/jeff-0.8b" ]]; then
  echo_yellow "downloading the Jeff checkpoint (~1.7 GB)..."
  $DOCKER run --rm -v "$WEIGHTS:/weights" poker-jeff:latest \
    uv run hf download mstrasser/Jeff-Qwen3.5-0.8B --local-dir /weights/jeff-0.8b \
    || { echo_red "checkpoint download failed"; exit 1; }
fi

echo_yellow "starting poker-jeff..."
$DOCKER rm -f poker-jeff >/dev/null 2>&1 || true
$DOCKER run -d \
  --name poker-jeff \
  --restart unless-stopped \
  --cpus=2 \
  -e OMP_NUM_THREADS=2 \
  -e MKL_NUM_THREADS=2 \
  -p 127.0.0.1:$JEFF_PORT:8781 \
  -v "$WEIGHTS:/weights" \
  poker-jeff:latest \
  || { echo_red "poker-jeff failed to start"; exit 1; }

# Jeff loads 1.7 GB of weights before it answers /health, which takes a while on this box.
echo_yellow "waiting for the model services..."
for name in "llama:$LLAMA_PORT" "jeff:$JEFF_PORT"; do
  label=${name%%:*}
  port=${name##*:}
  for _ in $(seq 1 60); do
    code=$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health" 2>/dev/null)
    [[ "$code" == "200" ]] && break
    sleep 2
  done
  if [[ "$code" == "200" ]]; then
    echo_green "$label is up on 127.0.0.1:$port"
  else
    echo_red "$label did not become healthy - check: docker -c default logs poker-$label"
  fi
done
