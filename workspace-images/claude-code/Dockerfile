FROM node:20-slim

ENV HOME=/root
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install the latest Claude Code CLI
# npm and npx are included with node:20-slim
RUN npm install -g @anthropic-ai/claude-code

# Verify installations
RUN node --version && npm --version && npx --version && claude --version

WORKDIR /workspace

CMD ["/bin/bash"]
