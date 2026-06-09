FROM node:20-slim

ENV HOME=/root
ENV DEBIAN_FRONTEND=noninteractive
ENV IS_SANDBOX=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    wget \
    ca-certificates \
    bubblewrap \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (gh)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Install the latest Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Smoke-test node/npm — skip claude --version as it can fail non-interactively
RUN node --version && npm --version && npx --version

# Install terminal-agent — owns PTY sessions so they survive Opus Command restarts
COPY terminal-agent.js /opt/terminal-agent/index.js
COPY terminal-agent-package.json /opt/terminal-agent/package.json
RUN cd /opt/terminal-agent && npm install --omit=dev

# Workspace shell config — applied to every interactive bash session via /etc/bash.bashrc
# 1. PATH: home volume bin dirs always take precedence over system dirs
# 2. npm prefix: global installs land in ~/.npm-global (home volume) not /usr/local
# 3. bare `cd` returns to /workspace (project root) not /root (home volume)
RUN printf '\n# Opus Command workspace\n\
export PATH="$HOME/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"\n\
export NPM_CONFIG_PREFIX="$HOME/.npm-global"\n\
export IS_SANDBOX=1\n\
cd() { builtin cd "${@:-/workspace}"; }\n' >> /etc/bash.bashrc

# Bundle agent instruction templates so workspace startup can copy them into place.
COPY CLAUDE.md /etc/opus-command/CLAUDE.md
COPY AGENTS.md /etc/opus-command/AGENTS.md
COPY skills/connectors.md /etc/opus-command/skills/connectors.md
COPY opus-cli.js /usr/local/bin/opus
RUN chmod +x /usr/local/bin/opus

WORKDIR /workspace

CMD ["/bin/bash"]
