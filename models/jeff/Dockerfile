# syntax=docker/dockerfile:1
#
# Jeff, the decision classifier, as a local service. There is no official image, and this
# machine has no pip, no venv and no uv on the host - so everything happens in here.

FROM python:3.12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# jeff's pyproject sets `required-version = ">=0.12.19"`, so uv is not optional.
RUN pip install --no-cache-dir "uv>=0.12.19"

WORKDIR /opt
# Pin this to a commit sha once a known-good one exists; `main` is a moving target and the
# response shapes this project parses are not a stable API.
ARG JEFF_REF=main
RUN git clone --depth 1 --branch ${JEFF_REF} https://github.com/firelex/jeff.git

WORKDIR /opt/jeff
# Without this, uv resolves torch==2.14.0 to the default PyPI wheel, which drags in the whole
# CUDA runtime: 2-3 GB of GPU libraries that cannot run on this machine's integrated graphics.
ENV UV_TORCH_BACKEND=cpu
RUN uv sync --no-dev

# flash-linear-attention has to go. 18 of this model's 24 layers are linear attention, and
# transformers dispatches those to fla's Triton kernels whenever fla merely *imports*
# (`use_kernel_func_from_hub_with_fallback`, which resolves at import time and falls back to
# its own torch implementation only when the import fails). fla prints "Triton is not
# supported on current platform, roll back to CPU" and then calls a Triton kernel anyway, so
# every single request died with `RuntimeError: 0 active drivers ([])`.
#
# Nothing in jeff's own source imports fla - it is there to accelerate GPU inference, which
# this machine does not have. Removing it makes transformers use torch_chunk_gated_delta_rule
# and torch_recurrent_gated_delta_rule, which are pure PyTorch and work on CPU.
# NB: the distribution is `fla-core`, not `flash-linear-attention` as pyproject.toml spells
# it. Uninstalling the latter succeeds while doing nothing at all ("Skipping ... as it is not
# installed" is only a warning), so the verify step below is what makes this reliable.
# NB: the distribution is `fla-core`, not `flash-linear-attention` as pyproject.toml spells
# it - uninstalling the latter succeeds while doing nothing at all. The rm clears what the
# uninstall leaves behind (stale __pycache__ keeps the package importable), and the import
# check is what makes this reliable: if fla ever comes back, the build fails here rather than
# every request failing at runtime.
RUN uv pip uninstall fla-core || true
RUN rm -rf /opt/jeff/.venv/lib/python3.12/site-packages/fla \
  && if /opt/jeff/.venv/bin/python -c 'import fla' 2>/dev/null; then \
       echo 'fla is still importable - linear attention would hit Triton and fail'; exit 1; \
     fi \
  && echo 'fla is gone; linear attention will use the torch path'

# The checkpoint is ~1.7 GB and lives on a mounted volume, not in the image, so rebuilding
# the image never re-downloads it.
ENV JEFF_BACKEND=pytorch \
    JEFF_HOST=0.0.0.0 \
    PORT=8781 \
    JEFF_CHECKPOINT=/weights/jeff-0.8b \
    HF_HOME=/weights/hf

EXPOSE 8781
# The venv entry point directly, not `uv run`: uv re-syncs on every run, which reinstalls the
# dev group (and fla) and makes container start depend on PyPI being reachable. A model server
# that will not boot when an index is down is not worth the convenience.
CMD ["/opt/jeff/.venv/bin/jeff-serve"]
