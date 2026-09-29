.PHONY: install dev build start check fmt test bench simulate deploy-build deploy-up deploy-logs models-up

# deno lives in ~/.deno/bin and is deliberately not on PATH on this machine, so every
# target spells it out. Override with `make DENO=deno ...` anywhere it *is* on PATH.
DENO ?= $(HOME)/.deno/bin/deno
# client/package.json's scripts invoke plain `deno` - they have to, because the Docker
# client stage has it on PATH and nowhere else does. So npm gets a patched PATH here.
NPM = PATH="$(dir $(DENO)):$$PATH" npm

# The client needs react + esbuild; the api has no npm dependencies.
install:
	$(NPM) --prefix client install

# Deno server on :8780, which spawns the esbuild watcher for the client.
dev:
	$(DENO) task --cwd api dev

# Production bundle into api/client/.
build:
	$(NPM) --prefix client run build

start: build
	$(DENO) task --cwd api start

# The whole tree, not just the entry point: `deno check main.ts` only reaches what main.ts
# imports, so a broken test helper or an unreferenced module slips through it.
check:
	$(DENO) check --config api/deno.json api/**/*.ts shared/*.ts scripts/*.ts
	$(NPM) --prefix client run check

test:
	$(DENO) test --allow-all api/ shared/

fmt:
	$(DENO) fmt --config api/deno.json api scripts shared
	$(DENO) fmt --config client/deno.json client

# Plays whole tournaments headlessly and reports how each bot behaved. The check behind
# "each bot's behaviour is visibly distinct".
simulate:
	$(DENO) run -A scripts/simulate.ts $(ARGS)

# Measures what Jeff and the monologue LLM actually cost on this box. The whole design
# hinges on these numbers - see CLAUDE.md.
bench:
	$(DENO) run --allow-net --allow-env --allow-read scripts/bench-jeff.ts
	$(DENO) run --allow-net --allow-env --allow-read scripts/bench-llm.ts

# --- Deployment (Docker + tailnet-only `tailscale serve`; see deploy/ and CLAUDE.md) ---

models-up:
	./deploy/models-up.sh

deploy-build:
	./deploy/build.sh

deploy-up:
	./deploy/start.sh

deploy-logs:
	docker -c default logs -f poker-ai
