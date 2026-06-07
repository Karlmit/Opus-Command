You are building Opus Command — a self-hosted Docker web app and AI project cockpit.

## Your mission
Build as much as possible without stopping. Work through the epics in order, test with Docker along the way, and push to GitHub after each completed story. Only stop if you hit a genuine blocker you cannot resolve.

## Read these files first (in this order)
1. /mnt/projects/claude/OpusCommand/_bmad-output/planning-artifacts/epics.md  ← stories + acceptance criteria
2. /mnt/projects/claude/OpusCommand/_bmad-output/planning-artifacts/prds/prd-OpusCommand-2026-06-07/prd.md  ← full requirements
3. /mnt/projects/claude/OpusCommand/_bmad-output/planning-artifacts/ux-designs/ux-OpusCommand-2026-06-07/DESIGN.md  ← color tokens, typography, components
4. /mnt/projects/claude/OpusCommand/_bmad-output/planning-artifacts/ux-designs/ux-OpusCommand-2026-06-07/EXPERIENCE.md  ← layout, behavior, interactions

## Build location
/mnt/projects/claude/OpusCommand/ — this is the project root. Planning artifacts are in _bmad-output/ and _bmad/ subdirectories. Your code goes at the root alongside them.

## Tech stack (decided — do not deviate)
- Backend: Node.js LTS + Express.js
- Frontend: React + Vite (SPA served by Express)
- Database: SQLite + Drizzle ORM (file at /app/data/db.sqlite)
- Real-time: Socket.io
- Terminal: node-pty + xterm.js
- Docker: dockerode
- Git: simple-git
- Auth: express-session + bcrypt
- CI/CD: GitHub Actions + Docker Buildx

## Build order
Epic 1 → Epic 2 → Epic 4 → Epic 5 → Epic 3 → Epic 6 → Epic 7 → Epic 8
(Terminal before AI awareness; files/editor can come after terminal)

## Testing with Docker
You have access to Docker in this terminal. After completing each story:
- Build the Docker image: docker build -t opus-command-dev .
- Run it: docker compose up -d (create a dev docker-compose.yml)
- Test the acceptance criteria from epics.md against the running container
- Fix any failures before moving to the next story

## GitHub
Remote: https://github.com/Karlmit/Opus-Command
- Initialize git at the project root if not already done
- Push after every completed story with a clear commit message: "Story X.Y: [title]"
- Push after every epic with a tag: git tag epic-N-complete

## Rules
- Implement acceptance criteria exactly as written in epics.md
- Follow DESIGN.md token values exactly (colors, spacing, typography, radius)
- Never store data inside the container — always /app/data or /projects volumes
- Accent color #3B82F6 is reserved ONLY for AI state signals — do not use it decoratively
- All panels use 1px solid border token — no decorative shadows in dark mode
- Commit frequently with meaningful messages
- If a test fails, fix it before moving on
- If you are blocked on something non-critical, document it in a NOTES.md and continue

Start with Story 1.1. Go.
