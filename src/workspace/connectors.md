# Opus Connector Skill

Use Opus Connectors when work must run outside the Linux workspace, especially
on a paired Linux host, Windows VM, or machine with attached hardware.

Before connector-specific work, check available connectors. The `opus` CLI is
installed automatically in Opus workspaces and reports status, labels, and
capability hints:

```bash
opus connectors list
```

Use a connector when the task needs:

- Linux host tools outside the workspace container
- Docker or Docker Compose on a remote host
- Browser testing on connector-provided browsers or Playwright
- host files, services, local networks, or hardware that are not mounted into
  the workspace
- Windows PowerShell or CMD
- Android Studio, Gradle, ADB, emulators, or USB-connected Android devices
- Visual Studio Build Tools, MSBuild, Windows SDK tools
- Windows-only applications, local hardware, COM ports, or device drivers

Run commands through the connector whose name or labels match the task:

```bash
opus connector run <connector-label-or-name> -- powershell "Get-ComputerInfo"
opus connector run <connector-label-or-name> -- cmd "adb devices"
opus connector run <connector-label-or-name> -- bash "docker ps"
opus connector run linux -- bash 'docker compose version || docker-compose --version'
opus connector run <connector-label-or-name> --shell bash --script ./build.sh
cat ./build.sh | opus connector run <connector-label-or-name> --shell bash --stdin
```

Prefer labels such as `windows`, `android`, `adb`, `visual-studio`, `desktop`,
`vm`, `linux`, `docker`, `docker-compose`, `node`, `python`, `playwright`, or
`hardware`. `opus connectors list` also shows capability hints such as
`caps=docker,node,playwright`. If more than one connector matches, choose the
best labeled/capable connector for the task and state which connector you used.

For Linux connectors, do not assume the host shell environment matches this
workspace. Check required commands directly on the connector, and quote connector
environment variables so the local workspace shell does not expand them first:

```bash
opus connector run linux -- bash 'node --version; python3 --version; docker --version'
opus connector run linux -- bash 'mkdir -p "$OPUS_CONNECTOR_ARTIFACT_DIR"; echo ok > "$OPUS_CONNECTOR_ARTIFACT_DIR/result.txt"'
```

For Windows connectors, the default shell is `powershell` (Windows PowerShell);
use `pwsh` for PowerShell 7, `cmd` for batch, or `python`. Send whole scripts
with `--script file.ps1` or piped `--stdin` — the connector runs them with the
matching interpreter. Use forward-slash drive paths for file transfer.

```bash
opus connector run windows -- powershell "Get-Service | Where-Object Status -eq 'Running'"
opus connector run windows --shell pwsh --script ./deploy.ps1
cat ./test.ps1 | opus connector run windows --shell powershell --stdin
opus connector put ./build.zip windows:C:/Temp/build.zip
opus connector get windows:C:/Temp/result.log ./result.log
```

Connector job artifacts are returned to:

```text
.opus/artifacts/<job-id>
```

Do not ask the user to use RDP, copy files manually, or start another AI session
when an Opus Connector can run the command.

For v2 connectors (Linux and Windows), prefer native connector operations over
token-heavy workarounds:

```bash
opus connector put ./local.txt linux:/tmp/local.txt
opus connector get linux:/tmp/output.log ./output.log
opus connector run linux --wait false -- bash 'sleep 60; echo done'
opus connector run windows -- powershell "Get-Process | Select-Object -First 5"
opus connector jobs list linux
opus connector jobs status <job-id>
opus connector jobs cancel <job-id>
opus connector artifacts get <job-id>
opus connector feedback submit linux --title "Issue summary" --message "What failed and what would help"
opus connector feedback submit windows --title "Issue summary" --message "What failed and what would help"
opus connector feedback list windows
opus connector feedback mark-read windows <feedback-id>
opus browser screenshot linux https://example.com ./screenshot.png
```

Job cancel, file transfer, inline scripts, and feedback work on any v2 connector;
the Windows connector targets PowerShell (`powershell`/`pwsh`), while Playwright
browser screenshots require the Linux connector. Connector file transfer is
chunked through the connector protocol. If a connector disconnects during a job,
the job status becomes `lost` instead of
remaining frozen in `running`.

When connector behavior is confusing, broken, or missing a capability, leave a
feedback report on the connector device instead of relying only on chat context.
This works the same for Linux and Windows connectors. Keep reports specific:
include the command attempted, observed output, expected behavior, and any
suggested improvement. Feedback reports are stored on the connector host and can
be listed later with `opus connector feedback list`; on Windows they also appear
in the Opus Connector tray app under "Agent Feedback".
