#!/bin/bash
# Starts the spectator app. The model services are separate - see models-up.sh - so restarting
# the app never evicts 2 GB of loaded weights.
#
# Tailnet-only, like kotoba: the host port is bound to loopback and odin's own tailscaled
# serves it. Expose it once with:
#
#   tailscale serve --service=svc:poker --bg 8780
#
# There is no login because nothing untrusted can reach it. Never add `tailscale funnel` here.
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
CONTAINER_NAME=poker-ai
IMAGE=poker-ai:latest
PORT=8780
NETWORK=poker-net

if ! $DOCKER image inspect $IMAGE >/dev/null 2>&1; then
  echo_red "$IMAGE does not exist - build it with ./deploy/build.sh first"
  exit 1
fi

$DOCKER network create $NETWORK >/dev/null 2>&1 || true
mkdir -p deploy/data

echo_yellow "stopping..."
$DOCKER stop $CONTAINER_NAME >/dev/null 2>&1 || true
$DOCKER rm -f $CONTAINER_NAME >/dev/null 2>&1 || true

# 127.0.0.1 inside a container is the container, not the host, so the model services are
# addressed by container name on a shared network. models-up.sh joins them to it.
echo_yellow "starting..."
$DOCKER run \
  -d \
  --name $CONTAINER_NAME \
  -u 1000 \
  --restart unless-stopped \
  --cpus=2 \
  --network $NETWORK \
  -p 127.0.0.1:$PORT:$PORT \
  -v "$PWD/deploy/data:/app/data" \
  -e TZ=Asia/Tokyo \
  -e DECISION_URL=http://poker-jeff:8781 \
  -e MONOLOGUE_URL=http://poker-llama:8080 \
  $IMAGE \
  || { echo_red "failed to start"; exit 1; }

for _ in $(seq 1 20); do
  code=$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" 2>/dev/null)
  [[ "$code" == "200" ]] && break
  sleep 1
done
[[ "$code" == "200" ]] && echo_green "poker-ai is up on 127.0.0.1:$PORT" || echo_red "not healthy yet"

# Ask the question that matters - can it be reached over the tailnet - rather than grepping
# `tailscale serve status`. head -1 matters: MagicDNSSuffix appears more than once.
SUFFIX=$(tailscale status --json 2>/dev/null | grep -oP '(?<="MagicDNSSuffix": ")[^"]+' | head -1)
URL="https://poker.${SUFFIX:-tailnet}"
if [[ "$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$URL/api/health" 2>/dev/null)" == "200" ]]; then
  echo_green "served at $URL"
else
  echo_yellow "not reachable over the tailnet yet."
  echo_yellow "  if this is the first deploy:  tailscale serve --service=svc:poker --bg $PORT"
  echo_yellow "  otherwise check $URL/api/health"
fi
