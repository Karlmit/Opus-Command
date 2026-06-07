FROM python:3.12-slim-bookworm

ENV HOME=/root

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pipenv poetry

WORKDIR /workspace

# Claude Code: install Node.js first, then run `npm install -g @anthropic-ai/claude-code` inside the terminal.

CMD ["/bin/bash", "-l"]
