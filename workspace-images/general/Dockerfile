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
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN curl -fsSL https://raw.githubusercontent.com/anthropics/claude-code/main/install.sh | sh 2>/dev/null \
    || npm install -g @anthropic-ai/claude-code 2>/dev/null \
    || echo "Claude Code installation: configure manually after container start"

WORKDIR /workspace

CMD ["/bin/bash", "-l"]
