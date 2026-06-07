FROM node:20-bookworm-slim

ENV HOME=/root

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm yarn

WORKDIR /workspace

# Claude Code: run `npm install -g @anthropic-ai/claude-code` inside the terminal after first start.

CMD ["/bin/bash", "-l"]
