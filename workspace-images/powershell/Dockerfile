FROM mcr.microsoft.com/powershell:7.4-ubuntu-22.04

ENV HOME=/root

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js for Claude Code CLI
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g @anthropic-ai/claude-code 2>/dev/null \
    || echo "Claude Code installation: configure manually"

WORKDIR /workspace

CMD ["/usr/bin/pwsh", "-l"]
