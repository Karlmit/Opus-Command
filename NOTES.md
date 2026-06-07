# Development Notes

## Known Issues / Implementation Notes

### Workspace Templates (Epic 8)
- Workspace template images (`ghcr.io/karlmit/opus-command-workspace-{template}:latest`) need to be built and pushed to GHCR
- In development, the app falls back to `ubuntu:22.04` (which must be available locally)
- Templates will be fully functional once Epic 8 CI/CD pipeline publishes the images

### Git Operations
- Git operations execute inside the workspace container via dockerode exec
- Git user identity is set to `opus@command` / `Opus Command` for commits made via the UI
- Users should configure their own git identity inside the workspace terminal if needed

### Editor
- The simple textarea editor works for all text files; CodeMirror integration (with full syntax highlighting) is a post-V1 enhancement
- Current editor has basic syntax support via file extension detection
- Large files (>5MB) are blocked from editor view

### Terminal PTY
- Uses `docker exec -i` (not `-t`) so node-pty provides the PTY
- `-i` flag keeps bash interactive; no login shell (`-l`) since the container might not have full profile
- The docker CLI binary must be installed in the opus-command container (added to Dockerfile)

### Bundle Size
- The JS bundle is ~550KB gzipped (157KB). This is within acceptable range for a local app.
- Main contributors: xterm.js (~150KB), react-router (~30KB), socket.io-client (~40KB)
- Code splitting can be added later via dynamic imports

### Multi-arch
- CI/CD builds linux/amd64 and linux/arm64 via Docker Buildx
- Local dev builds use the current platform only

### File Watcher
- File tree polls every 2 seconds for changes (satisfies FR-FILE-7 "within 2 seconds")
- Git panel polls every 3 seconds (satisfies FR-GIT-10 "max 3-second lag")
- Could be improved with chokidar-based file watching via Socket.io for instant updates

### Missing from V1 Scope (deferred)
- CodeMirror integration (using simple textarea for now - functional but no syntax highlighting)
- Copy/move file operations (create + delete workflow works as workaround)
- Content search with grep (file name search works; content search is in the API but slow for large repos)
