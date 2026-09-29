#!/bin/bash
# Builds the app image. Separate from start.sh so a rebuild is always deliberate.
if [[ -f "${UTIL_SH:-$HOME/scripts/util.sh}" ]]; then
  . "${UTIL_SH:-$HOME/scripts/util.sh}"
else
  echo_green() { printf '\033[32m%s\033[0m\n' "$*"; }
  echo_yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
  echo_red() { printf '\033[31m%s\033[0m\n' "$*"; }
fi
set -uo pipefail

cd "$(dirname "$0")/.."

IMAGE=poker-ai:latest

# .git is excluded from the build context, so the hash has to be passed in - without it
# build.ts tags the bundle 'dev' and index.html stops busting the browser cache.
BUILD_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo dev)

echo_yellow "building $IMAGE (BUILD_HASH=$BUILD_HASH)..."
docker -c default build --build-arg "BUILD_HASH=$BUILD_HASH" -t $IMAGE . \
  && echo_green "built $IMAGE" \
  || { echo_red "build failed"; exit 1; }
