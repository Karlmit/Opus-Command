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
RUN npm install -g @anthropic-ai/claude-code

# Smoke-test node/npm — skip claude --version as it can fail non-interactively
RUN node --version && npm --version && npx --version

# Workspace shell config — applied to every interactive bash session via /etc/bash.bashrc
# 1. PATH: home volume bin dirs always take precedence over system dirs
# 2. npm prefix: global installs land in ~/.npm-global (home volume) not /usr/local
# 3. bare `cd` returns to /workspace (project root) not /root (home volume)
RUN printf '\n# Opus Command workspace\n\
export PATH="$HOME/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"\n\
export NPM_CONFIG_PREFIX="$HOME/.npm-global"\n\
cd() { builtin cd "${@:-/workspace}"; }\n' >> /etc/bash.bashrc

# Bundle the CLAUDE.md template so the startup command can copy it to ~/.claude/
COPY CLAUDE.md /etc/opus-command/CLAUDE.md

WORKDIR /workspace

CMD ["/bin/bash"]
