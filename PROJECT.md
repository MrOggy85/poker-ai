# AI Poker Tournament — Project Specification

## 1. Overview

Build a **Texas Hold'em tournament played entirely by AI bots**, running locally on a MacBook and watched live in a web browser.

- Every bot has its own **personality** and a **mood** that changes during the game.
- Bots decide their actions using a small local **decision model** (Jeff, a Jev-compatible classifier).
- Bots have an **inner monologue** written by a very small local LLM. Only the audience sees it — never other bots.
- The audience sees everything: all hole cards, all thoughts, all moods. The bots see only what a real player would see.
- There is no human player. The user is a spectator.

The implementation language and frameworks are up to the implementer. This document describes **what** to build and **how the parts fit together**, not which libraries to use.

## 2. Goals and non-goals

### Goals
- Entertaining to watch: bots feel distinct, bluff, get tilted, and "think out loud".
- Fully local: no cloud APIs, no API keys, works offline after models are downloaded.
- **Low resource usage** is a top priority. Prefer the smallest models and simplest architecture that work.
- Server-authoritative game; the browser is only a viewer.
- Reproducible games via a random seed.

### Non-goals
- No streaming software, no OBS, no video encoding.
- No human players, no accounts, no multiplayer networking.
- No optimal / game-theory-perfect poker. Personality matters more than winning.
- Rich, long monologues are **not** required. Short and cheap is better.

## 3. Hardware and resource constraints

- Target: Apple Silicon MacBook (M-series). Should also work (slower) on CPU-only machines.
- Target total memory for both models: **under ~4 GB**, lower is better.
- Load each model **once** at startup and keep it in memory. Never reload per request.
- Run **at most one model inference at a time** (a single inference queue). The game does not need parallelism; pacing hides latency.
- When the game is paused, no inference should run.
- Use quantized weights (e.g. 4-bit) for the monologue LLM.
- Keep prompts short. Smaller input = faster and more accurate decisions.

## 4. Models

### 4.1 Decision model: Jeff (Jev-compatible)

- Project: https://github.com/firelex/jeff
- Recommended checkpoint: **Jeff-Qwen3.5-0.8B** (https://huggingface.co/mstrasser/Jeff-Qwen3.5-0.8B). The README reports ~28 ms per decision on an M4 Max with the MLX backend, and that the 0.8B plays games better than the 2B.
- Run it as a local HTTP service using the project's own server (`jeff-serve`), with the MLX backend on Apple Silicon. Follow the README's quick start.
- Endpoint: `POST /v1/systemone` (same request format as TypeSafe's Jev).
- Question types:
  - `choice` — pick one of up to 255 options
  - `noul` — yes/no, returned as a probability
  - `score` — a point on a described scale
- The response contains a probability per option, the chosen option and a confidence. **Check the Jeff README / source for the exact response shape** before implementing the client.

Example request shape (from the Jeff README):

```json
{
  "model": "jeff-latest",
  "state": "Plain-text description of the situation.",
  "questions": {
    "action": {
      "type": "choice",
      "instructions": "What does the player do?",
      "criteria": { "1": "Option one", "2": "Option two" }
    }
  }
}
```

Important properties to design around:
- It is a **classifier, not a planner**. It cannot do arithmetic or predict the future reliably.
- **Wording matters enormously.** Options should describe their consequences in plain words.
- Use **short option keys** (`"1"`, `"2"`, …) with descriptive text.
- Independent questions can be batched in one request.
- English, text only.

The decision model must sit behind a small **Decision Client interface** in the code, so it can be swapped later (e.g. for hosted Jev or a rule-based fallback) without touching game logic.

### 4.2 Monologue model: tiny local LLM

- Use the **smallest instruct LLM that produces readable one-liners**, around 0.5B–1B parameters, 4-bit quantized. Run it with a lightweight local runtime (e.g. llama.cpp or MLX).
- Output length: **one or two short sentences, max ~40 tokens.** Set a hard token limit.
- Quality expectations are low on purpose. Short, punchy, in-character lines are the goal.
- Must sit behind a **Monologue Client interface** so it can be swapped or disabled.
- **Template fallback:** if the LLM is disabled, slow, or fails, use pre-written template lines per personality and action (e.g. `"{name} smirks. Nobody believes that raise."`). The game must be fully playable with templates only.

## 5. System architecture

```
+-----------------------------------------------------------+
|                         SERVER                            |
|                                                           |
|  +---------------+     +--------------------------+       |
|  | Tournament    |---->| Game Engine (Hold'em)    |       |
|  | Director      |     | rules, deck, pot, blinds |       |
|  +---------------+     +------------+-------------+       |
|         |                           |                     |
|         v                           v                     |
|  +---------------+     +--------------------------+       |
|  | Pacing /      |     | Hand Evaluator +         |       |
|  | Broadcast     |     | Equity Estimator         |       |
|  | Controller    |     +--------------------------+       |
|  +-------+-------+                  |                     |
|          |              +-----------v--------------+      |
|          |              | Bot Brain (per player)   |      |
|          |              | personality, mood,       |      |
|          |              | opponent notes           |      |
|          |              +-----+-------------+------+      |
|          |                    |             |             |
|          |          +---------v---+   +-----v---------+   |
|          |          | Decision    |   | Monologue     |   |
|          |          | Client      |   | Client        |   |
|          |          +------+------+   +-----+---------+   |
|          |                 |                |             |
|          |          +------v----------------v---------+   |
|          |          |  Inference Queue (1 at a time)  |   |
|          |          +------+----------------+---------+   |
|          |                 |                |             |
|          v                 v                v             |
|  +---------------+   [Jeff service]   [Tiny LLM runtime]  |
|  | Event Stream  |                                        |
|  +-------+-------+                                        |
+----------|------------------------------------------------+
           | push updates (e.g. SSE or WebSocket)
           v
+-----------------------------------------------------------+
|                 BROWSER (spectator view)                  |
+-----------------------------------------------------------+
```

### Components

1. **Game Engine** — Pure, deterministic Texas Hold'em rules: deck, dealing, betting rounds, side pots, showdown, chip movement. No AI logic inside. Given a state and an action, returns the new state. Seeded RNG.
2. **Hand Evaluator + Equity Estimator** — Ranks hands and estimates a player's win chance (e.g. quick Monte Carlo against random opponent hands, a few hundred samples to keep it cheap). Also computes pot odds. This is where all poker math lives.
3. **Bot Brain** — One per player. Holds personality, current mood, and simple opponent notes. Builds the text state for the decision model, calls it, picks the final action, then requests the monologue.
4. **Decision Client** — Talks to the Jeff service. Handles timeouts and fallback.
5. **Monologue Client** — Talks to the tiny LLM. Handles timeouts and template fallback.
6. **Inference Queue** — Serializes all model calls to keep memory and CPU/GPU use low.
7. **Tournament Director** — Seating, blind levels, eliminations, table balancing (if multiple tables), final results.
8. **Mood System** — Random and event-driven mood changes.
9. **Pacing / Broadcast Controller** — Controls game speed so it is watchable, and waits for monologues before revealing actions.
10. **Event Stream** — Sends game events to the browser. The browser never computes game logic.
11. **Spectator Web View** — Renders the table, cards, chips, thoughts and moods.

## 6. Game engine

- Standard No-Limit Texas Hold'em. Implement correctly, including all-ins and side pots.
- Default setup: **one table, 6 players** (configurable 2–9). Optional multi-table mode later.
- Tournament format: everyone starts with equal chips; blinds increase every N hands; players are eliminated at 0 chips; last player standing wins.
- The engine exposes, for the current player: the list of **legal actions** and valid bet amounts.
- The engine must reject illegal actions. If a bot ever returns an illegal action, the Bot Brain falls back to check/fold.

## 7. Bot players

### 7.1 Personality

Each bot has a static personality defined in config:

| Field | Description |
|---|---|
| `name` | Display name |
| `description` | 1–2 sentences of plain-text personality, used in the decision state and monologue prompt |
| `play_style` | Short words: e.g. "tight", "loose", "aggressive", "passive" |
| `bluff_tendency` | Plain-text hint, e.g. "bluffs often when others look weak" |
| `sampling_temperature` | How random the bot's final choice is (see 8.4). Reckless bots are higher |
| `voice` | Speaking style for the monologue, e.g. "sarcastic", "nervous", "philosophical" |
| `avatar` | Emoji or simple icon for the UI |

Suggested starting cast (make them clearly different):
- **The Rock** — very tight, only plays premium hands, calm.
- **The Maniac** — raises almost everything, loves chaos.
- **The Calling Station** — hates folding, calls too much, friendly.
- **The Shark** — balanced and calculating, cold.
- **The Nervous Rookie** — scared of big bets, folds under pressure.
- **The Showman** — bluffs for drama, talks big.

### 7.2 Mood

Mood is dynamic and describes the bot's current emotional state. Suggested moods: `calm`, `confident`, `tilted`, `bored`, `nervous`, `euphoric`, `suspicious`, `desperate`.

Mood changes by:
- **Events:** losing a big pot → likely `tilted`; winning with a bluff → `euphoric`; short stack → `desperate`; folding many hands in a row → `bored`.
- **Random drift:** with a small configurable probability each hand, switch to a random mood (this is the "make it interesting" knob).
- Moods decay back toward the personality's default over a few hands.

Mood is included in the decision state as plain text and shown in the UI.

### 7.3 Opponent notes (simple memory)

The models have no memory. The Bot Brain keeps small, code-computed notes about opponents, based only on **public** information:
- How often each opponent raised / folded recently.
- Whether an opponent was caught bluffing at a showdown.

Convert notes into short words before sending to the model, e.g. "Anna plays very tight", "Viktor was caught bluffing last hand". Keep only the most relevant 1–3 notes per decision.

## 8. Decision flow (Jeff)

### 8.1 Steps per turn
1. Engine provides legal actions for the current bot.
2. Equity Estimator computes the bot's win chance and pot odds.
3. Bot Brain converts numbers into **words** (see 8.2).
4. Bot Brain builds a **short** text state (see 8.3) and discrete options.
5. Decision Client calls Jeff.
6. Bot Brain samples the final action from the returned probabilities (see 8.4).
7. Engine applies the action.

### 8.2 Translate numbers into words

The model is weak at numbers. Always describe strength and consequences in plain language:

| Win chance | Words |
|---|---|
| > 80% | "very strong, almost certainly ahead" |
| 60–80% | "strong, probably ahead" |
| 40–60% | "medium, could go either way" |
| 20–40% | "weak, probably behind" |
| < 20% | "very weak, almost certainly behind" |

Similarly for pot odds ("calling is cheap compared to the pot" vs. "calling is expensive"), stack size ("short stack, close to elimination"), and position.

### 8.3 State and options

Keep the state short (a few sentences). Include only:
- Personality description and current mood.
- Own hand strength in words (optionally the actual cards).
- Board and street in brief.
- Pot size, amount to call, own stack — described in words where possible.
- The last relevant action(s) at the table.
- 1–3 opponent notes.

**Never include other players' hole cards.**

Bet sizes are **discrete options**. Only include options that are currently legal. Each option describes its consequence:

```json
{
  "model": "jeff-latest",
  "state": "You are Viktor, a reckless player who loves bluffing. Mood: tilted, you just lost a big pot. Your hand is strong, probably ahead. Flop is out. Anna raised; she plays very tight. Calling is cheap compared to the pot. You have a medium stack.",
  "questions": {
    "action": {
      "type": "choice",
      "instructions": "What does Viktor do now?",
      "criteria": {
        "1": "Fold: lose nothing more, give up the pot",
        "2": "Call: stay in and see the next card",
        "3": "Raise half the pot: put some pressure on Anna",
        "4": "Raise the full pot: big pressure, risk many chips",
        "5": "All-in: risk everything to win the pot now"
      }
    }
  }
}
```

Keep option wording **consistent** between turns (the Jeff README reports that consistent wording changed game results significantly).

### 8.4 Sampling for personality and variety

Do **not** always take the top option. Sample from the returned probabilities, reshaped by the bot's `sampling_temperature`:
- Low temperature (The Rock, The Shark): nearly always the top choice.
- High temperature (The Maniac, The Showman): more surprising choices and bluffs.
- Mood can adjust temperature (e.g. `tilted` raises it).

The seeded RNG must be used here so games are reproducible.

### 8.5 Optional extra questions (batched, same request)

Cheap audience flavor, asked in the same request as the action:
- `noul`: "Does {name} believe the opponent is bluffing?" → shown in the UI as a suspicion meter.
- `score`: "How much pressure does {name} feel right now?" (0–10) → can feed the mood system.

Only add these if they don't noticeably slow the game.

### 8.6 Fallbacks
- Jeff service unreachable or timed out → simple rule-based decision from equity and personality.
- Returned option not legal → check if possible, otherwise fold.
- Log every fallback.

## 9. Inner monologue

### 9.1 When
- Generate the monologue **after** the action is decided, so thoughts always match actions.
- To save resources, not every action needs a thought. Suggested rules:
  - Always for raises, all-ins, big calls, and showdowns.
  - Sometimes (configurable probability) for routine checks/calls/folds.
  - Otherwise use a template line or no line.

### 9.2 Prompt

Short prompt to the tiny LLM, including only:
- Name, personality, voice, mood.
- The action just chosen and its reason in words (e.g. "raised because hand is strong and Anna looks weak").
- Optionally the real hole cards (the audience can see them anyway).

Instruction: "Write one short inner thought (max 20 words) in first person, in character. Do not mention probabilities."

Hard limit ~40 output tokens. Strip anything after the first line.

### 9.3 Secrecy
- Monologues go **only to the Event Stream / audience**.
- They are **never** included in any other bot's state or opponent notes.

## 10. Information hiding (critical)

The Bot Brain for player X may only use:
- X's own hole cards.
- Public board cards, pot, stacks, and public actions.
- X's own mood and personality.
- X's opponent notes built from public info.

It must never see other players' hole cards, other bots' moods, or other bots' monologues. Enforce this in code by building each bot's view from a **filtered public view + own private data**, never from the full server state. Add a test for this.

## 11. Pacing / broadcast controller

The game must be watchable, not as fast as possible.
- Configurable speeds: e.g. slow / normal / fast / turbo (turbo skips monologues and animations, useful for testing).
- Per action: show "thinking" indicator → reveal monologue → reveal action.
- Minimum delay per action (e.g. 1–2 s at normal speed). If the monologue takes longer, wait for it (or use a template after a timeout).
- Pause / resume at any time. Pausing stops scheduling new inference.
- Short pause after each hand to show the winner.

## 12. Spectator web view

Server-authoritative. The browser only renders events and sends control commands (pause, speed).

### Layout
- **Poker table** with seats around it:
  - Avatar, name, chip stack, current bet.
  - **Hole cards face up** (audience sees all).
  - **Mood badge** (emoji + word).
  - **Thought bubble** with the latest inner monologue, visually distinct (e.g. italic, cloud shape) so it is clear it is private.
  - Active-player highlight and "thinking…" state.
  - Dealer button and blinds markers.
- **Board cards** and **pot** in the middle.
- **Side panel:**
  - Tournament standings (chips, eliminated players).
  - Blind level and hand number.
  - Action log (public actions only, compact).
  - Optional: each player's equity as a small bar (audience-only info, like TV poker).
- **Controls:** pause/resume, speed selector, start new tournament (with seed).

### Updates
- Push events from the server (e.g. Server-Sent Events or WebSocket) rather than polling.
- On page load or reconnect, the server sends a full snapshot, then incremental events.
- Keep the page lightweight: simple animations only, no heavy graphics.

## 13. Event model (server → browser)

Suggested event types (names and payloads are guidance, not strict):

| Event | Payload |
|---|---|
| `snapshot` | Full current state for (re)connect |
| `hand_started` | Hand number, dealer, blinds, players' stacks |
| `cards_dealt` | Each player's hole cards (audience view) |
| `board_dealt` | Street and new board cards |
| `player_thinking` | Player id |
| `player_thought` | Player id, monologue text |
| `player_action` | Player id, action, amount |
| `mood_changed` | Player id, old mood, new mood, reason |
| `pot_updated` | Pot and side pots |
| `showdown` | Revealed hands, winners, amounts |
| `player_eliminated` | Player id, finishing place |
| `blinds_increased` | New blind level |
| `tournament_finished` | Final standings |
| `speed_changed` / `paused` / `resumed` | Control state |

Browser → server commands: `pause`, `resume`, `set_speed`, `new_tournament(seed?)`.

## 14. Configuration

A single config file (format up to the implementer) containing:
- Model endpoints / paths, timeouts, max tokens.
- Enable/disable monologue LLM (templates only mode).
- Monologue probability for routine actions.
- Number of players, starting chips, blind schedule, hands per level.
- Personalities list (see 7.1).
- Mood settings: random drift probability, decay speed.
- Default speed and delays.
- Random seed.

## 15. Logging and replay

- Log every hand as structured data: seed, deals, actions, the exact decision state and options sent, returned probabilities, sampled choice, monologue, mood changes.
- This log is used to debug bots and to tune option wording.
- Optional: replay a finished hand/tournament from its log in the web view.

## 16. Testing and evaluation

- **Engine unit tests:** betting rounds, all-ins, side pots, hand ranking, blind increases, eliminations.
- **Information-hiding test:** assert no bot's decision state or prompt contains another player's hole cards or thoughts.
- **Decision sanity set:** 30–50 hand-written situations with the expected sensible action per personality (e.g. The Rock folds a very weak hand facing a big raise). Run against Jeff and report agreement. Use this to tune wording.
- **Personality check:** simulate many hands in turbo mode (no monologue) and compare stats per bot (fold %, raise %, all-in %). Personalities should be clearly different.
- **Resource check:** measure memory and average time per decision and per monologue; report them in a debug panel or log.
- **Fallback test:** game completes a full tournament with the Jeff service down and with the LLM disabled.

## 17. Suggested milestones

1. Game engine + hand evaluator with random-action bots, rendered in the browser.
2. Rule-based bots with personalities and moods (no models yet).
3. Jeff integration: word-based state, discrete options, sampling, fallbacks.
4. Monologue: templates first, then the tiny LLM behind the same interface.
5. Pacing controller, thought bubbles, mood badges, standings.
6. Logging, sanity set evaluation, wording tuning.
7. Polish: equity bars, suspicion meter, replay.

## 18. Acceptance criteria

- A full 6-player tournament runs from start to finish on a MacBook without manual intervention.
- Both models run locally; the game still works with the LLM disabled and with Jeff unavailable (rule fallback).
- Bots never access hidden information (verified by test).
- Each bot's behavior is visibly distinct, and moods change during play.
- The browser shows all hole cards, moods, thoughts, board, pot and standings, updating live.
- Pause and speed controls work.
- Games are reproducible with the same seed (given the same model outputs).
- Memory use stays within the target, and only one inference runs at a time.
