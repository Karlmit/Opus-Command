# Opus Connector Skill

Use Opus Connectors when work must run outside the Linux workspace, especially
on Windows or on hardware attached to a Windows machine.

Before Windows-specific work, check available connectors. The `opus` CLI is
installed automatically in Opus workspaces:

```bash
opus connectors list
```

Use a connector when the task needs:

- Linux host tools outside the workspace container
- Docker or Docker Compose on a remote host
- Browser testing on connector-provided browsers or Playwright
- Windows PowerShell or CMD
- Android Studio, Gradle, ADB, emulators, or USB-connected Android devices
- Visual Studio Build Tools, MSBuild, Windows SDK tools
- Windows-only applications, local hardware, COM ports, or device drivers

Run commands through the connector whose name or labels match the task:

```bash
opus connector run <connector-label-or-name> -- powershell "Get-ComputerInfo"
opus connector run <connector-label-or-name> -- cmd "adb devices"
opus connector run <connector-label-or-name> -- bash "docker ps"
opus connector run <connector-label-or-name> --shell bash --script ./build.sh
cat ./build.sh | opus connector run <connector-label-or-name> --shell bash --stdin
```

Prefer labels such as `windows`, `android`, `adb`, `visual-studio`, `desktop`,
`vm`, `linux`, `docker`, `docker-compose`, `node`, `python`, `playwright`, or
`hardware`. `opus connectors list` also shows capability hints such as
`caps=docker,node,playwright`. If more than one connector matches, choose the
best labeled/capable connector for the task and state which connector you used.

Connector job artifacts are returned to:

```text
.opus/artifacts/<job-id>
```

Do not ask the user to use RDP, copy files manually, or start another AI session
when an Opus Connector can run the command.

For v2 Linux connectors, prefer native connector operations over token-heavy
workarounds:

```bash
opus connector put ./local.txt linux:/tmp/local.txt
opus connector get linux:/tmp/output.log ./output.log
opus connector jobs list linux
opus connector jobs cancel <job-id>
opus browser screenshot linux https://example.com ./screenshot.png
```

Linux connector file transfer is chunked through the connector protocol. If a
connector disconnects during a job, the job status becomes `lost` instead of
remaining frozen in `running`.
