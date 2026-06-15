# Opus Connector for Windows

The Windows connector pairs a Windows host with Opus Command and lets workspaces
run jobs on that host through the connector protocol. It is built primarily to
**run and test PowerShell**, and ships as an Electron tray app with a built-in
auto-updater.

It speaks the same **v2 connector protocol** as the Linux connector, so it has
parity on jobs, job cancellation, file transfer, inline scripts, capability
detection, and feedback.

## Features

- **Shells:** `powershell` (Windows PowerShell), `pwsh` (PowerShell 7), `cmd`,
  `python`, and direct executables (`exec`).
- **Inline scripts:** send `.ps1` / `.cmd` / `.py` script bodies; the connector
  materializes them to disk and runs them with the right interpreter.
- **Jobs:** synchronous or async (`--wait false`), with `cancel` that kills the
  whole process tree (`taskkill /T /F`).
- **File transfer:** bidirectional `put` / `get` (streamed and base64).
- **Capability detection:** Windows PowerShell, PowerShell 7, .NET SDK, Node.js,
  npm, Python, Git, Docker (+ daemon reachability), WSL, winget, Chocolatey, and
  Playwright. Reported on pair, on connect, and in every heartbeat.
- **Feedback:** agents can file feedback reports stored under the connector home.
- **Auto-update:** the tray app checks GitHub releases, downloads the new
  installer, runs it silently, and relaunches.
- **Start at login:** the installer registers a machine-wide Run key.

## Install layout

| Path | Purpose |
|------|---------|
| `C:\OpusConnector` | Installed app files (`OpusConnector.exe`) |
| `C:\ProgramData\OpusConnector` | Config, logs, working folders, artifacts, feedback |

## Build the installer

Requires Node.js and [NSIS](https://nsis.sourceforge.io/) (`makensis` on `PATH`).

```powershell
cd connectors/windows
npm install
npm run build:installer   # → dist/OpusConnector-Setup-<version>.exe
npm run build:manifest    # → dist/opus-windows-connector.json
```

CI (`.github/workflows/windows-connector.yml`) does this automatically on every
`v*` tag and attaches both files to that tag's GitHub Release.

## Pair

1. Install `OpusConnector-Setup-<version>.exe`.
2. Launch Opus Connector (Start menu or `C:\OpusConnector\OpusConnector.exe`).
3. In Opus Command: Settings → Opus Connectors → create a pairing token.
4. Paste the server URL, pairing token, name, and labels, then click **Connect**.

Headless / CLI pairing is also supported:

```powershell
& "C:\OpusConnector\OpusConnector.exe" --server https://opus.example.com --pair TOKEN --labels "windows,powershell"
node src\index.js --preflight      # print detected capabilities
```

## Auto-update

The connector version is independent of the Opus Command app version. On each
`v*` release the CI publishes:

- `OpusConnector-Setup-<connectorVersion>.exe`
- `opus-windows-connector.json` — `{ "version", "installer", "notes" }`

The tray app polls the repo's latest releases, reads the manifest, and if its
`version` is newer than the running build it downloads the matching installer
and runs it with `/S`. The silent installer stops the running app, replaces the
files, and relaunches.

> **Releasing:** keep `package.json` `version` and `PRODUCT_VERSION` in
> `installer.nsi` in sync — the manifest's `installer` filename is derived from
> the package version and must match the NSIS `OutFile`.

## Capabilities & PowerShell focus

`node src\index.js --preflight` (add `--json` for machine-readable output) prints
what the host can do. PowerShell is always the default shell; a typical job from
a workspace looks like:

```bash
opus connector run windows -- powershell "Get-ComputerInfo | Select-Object CsName, OsName"
```
