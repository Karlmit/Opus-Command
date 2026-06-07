# Reconciliation: Open Source Repository & Update Requirements (Supplemental Spec) vs PRD

**Date:** 2026-06-07
**Source:** Supplemental spec — "Open Source Repository & Update Requirements"
**PRD:** prd.md (same directory)

---

## Summary

**Total gaps found: 3**

Two are missing data/requirement items; one is an underspecified detail. All other requirements in the supplemental spec are adequately covered by the PRD. Connector metadata is intentionally excluded per task instructions.

---

## Gaps

### GAP-1 — "Application configuration" Missing from Data Persistence Enumeration (MISSING)

**Source reference:** "Data Persistence: Container replacement must never remove: Users, Settings, Projects, Workspace metadata, Connector metadata, Session history, **Application configuration**"

**Status in PRD:** FR-DIST-5 states: "All user-generated data (accounts, settings, projects, workspace metadata, session history) stored exclusively in `/app/data`." The term "Application configuration" is not listed. "Settings" (user-facing toggles) and "Application configuration" (system-level config such as server port, agent detection patterns, session secrets, environment-derived config) may refer to distinct data categories that both require persistence.

**Why it matters:** If application-level config (e.g., agent pattern definitions referenced in FR-AI-7 as "a configurable format") is stored separately from user settings and is not explicitly required to be in `/app/data`, it could be written inside the container filesystem and lost on container replacement — violating the zero-touch upgrade guarantee.

---

### GAP-2 — Docker Compose Reference Example Does Not Specify Unraid-Optimised Host Paths (WEAKENED)

**Source reference:** Docker Distribution section provides an explicit Docker Compose example with host paths `/mnt/user/appdata/opus-command:/app/data` and `/mnt/user/projects:/projects`, representing standard Unraid appdata conventions.

**Status in PRD:** FR-DIST-4 says "Reference Docker Compose configuration included in the README" and names the required mounts (`/app/data`, `/projects`, `/var/run/docker.sock`) but does not prescribe the example host-side paths. The spec's example uses Unraid-conventional paths that signal to Unraid users exactly where to mount volumes.

**Why it matters:** The spec is prescriptive about what the published Docker Compose example must look like for Unraid compatibility. The PRD delegates this to the README without specifying that the example must use Unraid-conventional paths — this detail could be dropped during implementation.

---

### GAP-3 — Zero-Touch Upgrade UX Flow Not Captured as a Verifiable Requirement (WEAKENED)

**Source reference:** "Zero-Touch Upgrades: The preferred user experience is: 1. User sees update available in Unraid; 2. User clicks Update Container; 3. Container restarts; 4. Application works immediately. No additional commands should ever be required."

**Status in PRD:** Section 3 Goals & Success Metrics includes "Zero-touch upgrades: Container replacement with existing data volume restores full app state; no manual steps." FR-DIST-6 covers automatic DB migrations on startup. FR-DIST-7 covers compatibility with Unraid/Watchtower/Portainer. However, the four-step upgrade flow is a UX acceptance scenario — a testable end-to-end condition — not a functional requirement or acceptance criterion anywhere in the PRD.

**Why it matters:** Without this as an explicit acceptance criterion (or NFR), a developer could satisfy all individual FRs and still ship something that requires a manual `docker exec` step after upgrade. The spec frames this as a hard constraint ("No additional commands should **ever** be required"), which is stronger than the PRD's goal-level statement.

---

## Items Confirmed Covered

The following supplemental spec items were verified as present and adequately captured in the PRD:

- Open source repository at `https://github.com/Karlmit/Opus-Command` (PRD Section 1)
- Docker image distributed via GHCR as `ghcr.io/karlmit/opus-command:latest` and `ghcr.io/karlmit/opus-command:vX.Y.Z` (FR-DIST-1)
- GitHub Actions workflow builds, tags, and pushes on every push to `main` and every tagged release (FR-DIST-2)
- Multi-arch image (`linux/amd64` and `linux/arm64`) (FR-DIST-2, NFR-5)
- Docker Compose reference config in README with required volume and socket mounts (FR-DIST-4)
- Compatibility with Unraid Docker, Docker Compose, Portainer, and Watchtower without custom scripts (FR-DIST-7, NFR-7)
- No self-updates in V1; update instructions direct user to their container management tool (FR-UPD-4)
- Settings > Updates panel with current version, latest version, release notes, and Check For Updates button (FR-UPD-1, FR-UPD-2)
- Update comparison and display of update-available status with GitHub release link (FR-UPD-3)
- Version embedded at build time from git tag / package.json (FR-UPD-5)
- All user data stored in `/app/data`; container replacement without removing volume preserves all data (FR-DIST-5)
- Database migrations run automatically on startup; no manual commands (FR-DIST-6)
- Users, Settings, Projects, Workspace metadata, Session history all enumerated as persistent data (FR-DIST-5)
- Connector metadata intentionally excluded per task instructions (future product)

---

## Recommended PRD Actions

| Gap | Action |
|-----|--------|
| GAP-1 | Extend FR-DIST-5 to explicitly include "Application configuration" in the enumerated list of persistent data categories, and clarify that agent detection pattern config (FR-AI-7) must be stored in `/app/data`, not in the container filesystem. |
| GAP-2 | Update FR-DIST-4 to specify that the reference Docker Compose example must use Unraid-conventional host paths (`/mnt/user/appdata/opus-command:/app/data`, `/mnt/user/projects:/projects`) to serve as a usable drop-in for Unraid users. |
| GAP-3 | Add an acceptance criterion to FR-DIST-6 or NFR-6: "A container pull-and-replace cycle (equivalent to Unraid 'Update Container') must result in a fully operational application with no post-restart manual steps required from the user." |
