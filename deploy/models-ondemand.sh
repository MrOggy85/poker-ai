#!/bin/bash
# Keeps the two model containers (Jeff + llama.cpp, ~2.6 GB resident) running only while
# someone is watching. The app itself (~50 MB) stays up: it is what answers the page load
# and reports `viewers` on /api/debug, which is the signal this script follows.
#
#   viewers > 0                      -> start poker-jeff + poker-llama if stopped
#   viewers == 0 for IDLE_MIN minutes -> stop them (frees the RAM; weights reload on demand)
#
# Run from user cron every minute; flock makes overlapping runs a no-op, and each run loops
# for ~55 s polling every POLL_S, so reaction time is seconds rather than a minute:
#
#   * * * * * /home/oskar/poker-ai/deploy/models-ondemand.sh >> /home/oskar/poker-ai/deploy/data/ondemand.log 2>&1
#
# A cold start takes Jeff roughly a minute to load. Until it answers /health the decision
# breaker trips and the rule bot plays; it half-opens after 30 s and Jeff takes over by itself.
#
#   models-ondemand.sh status   show container state and the idle timer
#   models-ondemand.sh up|down  force the models on or off right now
PATH=/usr/local/bin:/usr/bin:/bin
DOCKER="docker -c default"
MODELS="poker-jeff poker-llama"
APP_URL=http://127.0.0.1:8780/api/debug
IDLE_MIN=${IDLE_MIN:-10}
POLL_S=5
STATE=$HOME/poker-ai/deploy/data/ondemand.last-seen

log() { echo "[$(date '+%F %T')] $*"; }

running() { [[ "$($DOCKER inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == "true" ]]; }

any_running() { for m in $MODELS; do running "$m" && return 0; done; return 1; }

models_up() { log "starting models"; $DOCKER start $MODELS >/dev/null; }
models_down() { log "stopping models"; $DOCKER stop $MODELS >/dev/null; }

viewers() {
  curl -sS -m 3 "$APP_URL" 2>/dev/null | grep -oP '"viewers":\K[0-9]+'
}

case "${1:-watch}" in
  up) models_up; exit ;;
  down) models_down; exit ;;
  status)
    for m in $MODELS; do echo "$m: $($DOCKER inspect -f '{{.State.Status}}' "$m" 2>&1)"; done
    echo "viewers: $(viewers || echo 'app unreachable')"
    [[ -f $STATE ]] && echo "last viewer seen: $(( $(date +%s) - $(cat "$STATE") ))s ago (stop after $((IDLE_MIN * 60))s)"
    exit ;;
esac

exec 9>"$STATE.lock"
flock -n 9 || exit 0

for _ in $(seq 1 $((55 / POLL_S))); do
  v=$(viewers)
  now=$(date +%s)
  if [[ -z "$v" ]]; then
    : # app down or restarting: change nothing
  elif (( v > 0 )); then
    echo "$now" > "$STATE"
    running poker-jeff && running poker-llama || models_up
  else
    [[ -f $STATE ]] || echo "$now" > "$STATE"
    if any_running && (( now - $(cat "$STATE") >= IDLE_MIN * 60 )); then
      models_down
    fi
  fi
  sleep $POLL_S
done
