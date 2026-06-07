FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV HOME=/root

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    ca-certificates \
    gnupg \
    sudo \
    nano \
    vim \
    htop \
    bash-completion \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Claude Code and Codex CLI are installed by the user inside the terminal after first start.
# Run: npm install -g @anthropic-ai/claude-code
# API keys persist in the home volume (~/.claude, ~/.codex).

CMD ["/bin/bash", "-l"]
