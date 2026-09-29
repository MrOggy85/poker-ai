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

# The checkpoint is ~1.7 GB and lives on a mounted volume, not in the image, so rebuilding
# the image never re-downloads it.
ENV JEFF_BACKEND=pytorch \
    JEFF_HOST=0.0.0.0 \
    PORT=8781 \
    JEFF_CHECKPOINT=/weights/jeff-0.8b \
    HF_HOME=/weights/hf

EXPOSE 8781
CMD ["uv", "run", "jeff-serve"]
