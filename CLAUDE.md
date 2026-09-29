# poker-ai

## Purpose
Scratch repo for poker AI work. Scope, language and architecture are not decided yet —
further instructions pending. Update this file as soon as they arrive.

## Machine notes
Runs on the mini PC described in `~/claude_harness/CLAUDE.md`: Intel Alder Lake-N
(N100/N200-class), integrated graphics only, **no discrete GPU**. Anything that wants
CUDA has to run elsewhere; assume CPU-only for training and inference here.
Debian, kernel 6.1, shell is zsh.

## Conventions
- Numeric dates are always `YYYY-MM-DD`.
- Commit after each self-contained change rather than batching a session into one commit.
