FROM python:3.12-bookworm

ENV HOME=/root

RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pipenv poetry

# Install Node.js for Claude Code CLI
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g @anthropic-ai/claude-code 2>/dev/null \
    || echo "Claude Code installation: configure manually"

WORKDIR /workspace

CMD ["/bin/bash", "-l"]
