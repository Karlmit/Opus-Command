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

# Make bare `cd` always return to the project root (/workspace),
# not to the home volume (/root). Claude Code config still lives in /root.
# /etc/bash.bashrc is sourced by every interactive bash session.
RUN echo 'cd() { builtin cd "${@:-/workspace}"; }' >> /etc/bash.bashrc

CMD ["/bin/bash"]
