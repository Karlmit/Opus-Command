# Opus Connector Skill

Use Opus Connectors when work must run outside the Linux workspace, especially
on Windows or on hardware attached to a Windows machine.

Before Windows-specific work, check available connectors:

```bash
opus connectors list
```

Use a connector when the task needs:

- Windows PowerShell or CMD
- Android Studio, Gradle, ADB, emulators, or USB-connected Android devices
- Visual Studio Build Tools, MSBuild, Windows SDK tools
- Windows-only applications, local hardware, COM ports, or device drivers

Run commands through the connector whose name or labels match the task:

```bash
opus connector run <connector-label-or-name> -- powershell "Get-ComputerInfo"
opus connector run <connector-label-or-name> -- cmd "adb devices"
```

Prefer labels such as `windows`, `android`, `adb`, `visual-studio`, `desktop`,
or `vm`. If more than one connector matches, choose the best labeled connector
for the task and state which connector you used.

Connector job artifacts are returned to:

```text
.opus/artifacts/<job-id>
```

Do not ask the user to use RDP, copy files manually, or start another AI session
when an Opus Connector can run the command.
