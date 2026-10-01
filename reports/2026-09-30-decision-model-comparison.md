# Is a purpose-trained decision classifier worth it?

**Date:** 2026-09-30
**Question:** Jeff (and Jev, whose request format it copies) is described as a zero-shot
decision classifier. That technique is not new. Could an ordinary small LLM do the same job by
reading the log-probabilities of the answer letters — and on a four-core machine with no GPU,
would that be *better*?

**Short answer:** the technique really is the same, and swapping it in took an afternoon. The
purpose-trained model is still clearly better, and the reason is measurable. But the biggest
surprise is that a hand-written rule bot beats all of them at playing well.

## The technique is not new

Jeff's own README opens with "Fine-tunes of Qwen3.5 and Gemma 4 for **zero-shot
classification**". It does not claim a new paradigm, and it shouldn't: describing candidate
labels in natural language and reading a probability for each has been standard since roughly
2019, via NLI-based models such as BART-large-MNLI and DeBERTa-v3 zero-shot, later
one-pass variants like GLiClass, and the long-standing trick of reading an LLM's
log-probabilities over answer letters instead of generating text.

What Jeff adds over a 2019 NLI classifier is practical rather than conceptual:

- options described by their **consequences** in prose, not as topical labels
- **calibrated** probabilities rather than arbitrary scores
- up to 26 options in **one forward pass**
- one API covering choice, yes/no and score questions

Their own benchmark table shows where the value actually sits:

| | overall, 5 benchmarks |
|---|---|
| Qwen3.5-0.8B, untrained | 45.3 |
| Jeff-Qwen3.5-0.8B, same model fine-tuned | **79.1** |

Same size, same architecture. **The fine-tune is the product**, not the technique.

## The experiment

All three decision sources sit behind the same `DecisionClient` interface, so they can be
swapped without touching a line of game logic. Each was run over the same twelve hand-written
poker situations in `fixtures/sanity.ts`, each with the action a sensible player of that
personality would choose.

    make sanity                  # rule bot
    make SOURCE=jeff sanity      # the purpose-trained classifier
    make SOURCE=logprob sanity   # answer-letter log-probabilities from the 0.5B monologue model

| provider | sensible | median latency | extra memory |
|---|---|---|---|
| `rules` — hand-written | **12/12** | ~0 ms | none |
| `jeff` — Jeff-Qwen3.5-0.8B | 9/12 | 4.1 s | 4.05 GiB |
| `logprob` — Qwen2.5-0.5B Q4 | 5–7/12 | 2.0 s | none (reuses the monologue model) |

## Why the small model fails: it answers the label, not the question

The `logprob` provider is mechanically the same shape as Jeff — one forward pass, a probability
per caller-supplied option. It reuses the model already loaded for the inner monologue, so it
costs no extra memory at all. It is also not good enough, and the failure is specific.

Given a state describing **the best possible hand** facing a bet:

| option order | answer | distribution |
|---|---|---|
| fold listed first | **fold** | F=0.52 C=0.40 R=0.08 |
| fold listed last | **call** | R=0.07 C=0.63 F=0.30 |

The answer flips with the order of the list. And asked the same question with a content-free
state (`"N/A"`), one letter came back at **0.78** regardless of what the options meant.

Almost all of the raw distribution is label prior — position in the list, how common the letter
is, how the option happens to be phrased — and very little of it is about poker.

## Contextual calibration fixes the bias but not the quality

The standard remedy is to estimate the prior with a content-free input and divide it out
(`decision.calibrate`, cached per option set, one extra forward pass). It works, exactly as
advertised:

| | fold first | fold last |
|---|---|---|
| uncalibrated | fold (0.49) | call (0.55) |
| **calibrated** | **raise (0.45)** | **raise (0.56)** |

After calibration the answer is order-invariant *and* correct — raise with the best hand.

But on the twelve-case set, calibrated scored **5/12** against uncalibrated **7/12**. That
looks backwards until you notice the prior favours passive answers and five of the twelve cases
expect one: the uncalibrated 7 was partly the bias coinciding with the right answer. On twelve
cases the gap is inside the noise either way.

**The finding is what is left after the bias is removed: very little.** At 0.5B there is not
much poker judgement underneath, which is precisely what Jeff's untrained-vs-fine-tuned numbers
predict.

## The rule bot wins, and that is not a criticism of the classifier

12/12 against 9/12 looks damning until you check Jeff's own games table, where their
hand-coded rule bot ties or beats Jeff at all three games:

| | Doom | Frogger | Pac-Man |
|---|---|---|---|
| hand-coded rule bot | 6.55 | 10.25 | **94.1** |
| Jeff-Qwen3.5-0.8B | 6.55 | 10.3 | 57.0 |

A rule bot written by someone who knows the domain will usually beat a small general model at
that domain. That is expected, and it is why this project treats the rule bot as a permanent
path rather than a fallback.

What the classifier contributes here is not skill but **unpredictability**: it will occasionally
call with a hand a rule bot would fold, and that is the entertainment. Whether that is worth
4 GB of RAM and half a machine is a product decision, not a technical one.

## What this means for the project

- `decision.provider` selects `jeff`, `logprob` or `rules`. The default is `jeff`.
- `rules` is a defensible shipping configuration: better poker, no models, near-zero resources.
  It loses the surprises, which is the whole point of the bots, so it is not the default.
- `logprob` is not currently worth using, but it is kept because it costs nothing to keep and
  the comparison is the interesting part. It would be worth revisiting with a larger model —
  the open question is how much of Jeff's advantage is the fine-tune and how much is simply
  having more parameters, and `logprob` against a 3B would answer it.
- Anyone tempted to "save 4 GB by using a smaller model" should read the position-bias section
  first.

## Caveats

Twelve situations is a small set, written by one person, and it encodes one view of what
sensible play looks like. It is enough to catch a model folding pocket aces; it is not enough
to separate 7/12 from 5/12. Treat the ordering as real and the exact numbers as indicative.

**Update, 2026-10-01:** the set has since grown to 32 situations. The figures above were
measured on the original twelve and have not been re-run; the ordering is very unlikely to
have changed, but the numbers no longer correspond to the current fixture.
