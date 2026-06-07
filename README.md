# Opus Command

A self-hosted Docker web app and AI project cockpit. Replaces tmux, SSH, and fragmented tooling with a unified interface for directing AI coding agents.

**Key features:**
- Persistent terminal sessions — survive browser refresh, reconnect from any device
- AI session awareness — detects when Claude Code/Codex CLI/OpenCode needs input
- Lightweight git UI — snapshot before AI sessions, review diffs, revert, commit
- Mobile-first — full access from phone with touch-optimised terminal

## Quick Start

```yaml
# docker-compose.yml
services:
  opus-command:
    image: ghcr.io/karlmit/opus-command:latest
    container_name: opus-command
    ports:
      - "3000:3000"
    volumes:
      - opus-data:/app/data        # Application data + SQLite database
      - /projects:/projects         # Your project files
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - SESSION_SECRET=your-secret-here  # Change this!
    restart: unless-stopped

volumes:
  opus-data:
```

```bash
docker compose pull && docker compose up -d
```

Open http://localhost:3000 in your browser. First startup shows a setup screen to create your admin account.

## Volumes

| Mount | Purpose |
|-------|---------|
| `/app/data` | SQLite database, session data, agent pattern config |
| `/projects` | Project files (not deleted when projects are removed) |
| `/var/run/docker.sock` | Required for workspace container management |

## Updating

**Docker Compose:**
```bash
docker compose pull && docker compose up -d
```

**Unraid / Portainer / Watchtower:** Use the standard Docker update workflow. All data in the `opus-data` volume is preserved automatically.

## Workspace Templates

Workspace containers provide isolated development environments:

| Template | Tools |
|----------|-------|
| General Development | Git, curl, wget, Claude Code |
| Node.js Development | Node.js LTS, npm, pnpm, yarn, Git, Claude Code |
| Python Development | Python 3, pip, venv, Git, Claude Code |
| PowerShell Development | PowerShell 7, Git, Claude Code |

Template images: `ghcr.io/karlmit/opus-command-workspace-{template}:latest`

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `SESSION_SECRET` | dev secret | **Change in production!** |
| `DATA_DIR` | `/app/data` | Data directory path |
| `PROJECTS_DIR` | `/projects` | Projects directory path |
| `PORT` | `3000` | HTTP port |

## AI Agent Detection

Opus Command monitors terminal output for AI agent waiting states. The pattern file is at `/app/data/agent-patterns.json` and can be edited without restarting the container.

## License

MIT — see LICENSE
