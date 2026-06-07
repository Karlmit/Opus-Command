FROM node:20-bookworm

ENV HOME=/root

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm yarn

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code 2>/dev/null \
    || echo "Claude Code installation: configure manually after container start"

WORKDIR /workspace

CMD ["/bin/bash", "-l"]
