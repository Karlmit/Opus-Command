FROM mcr.microsoft.com/powershell:7.4-ubuntu-22.04

ENV HOME=/root

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Claude Code: install Node.js first, then run `npm install -g @anthropic-ai/claude-code` inside the terminal.

CMD ["/usr/bin/pwsh", "-l"]
