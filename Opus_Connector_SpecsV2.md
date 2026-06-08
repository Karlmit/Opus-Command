# Opus Connector Specification (MVP)

## Purpose

Opus Connector extends Opus Command beyond Docker workspaces.

It allows AI agents running inside Opus Command workspaces to securely execute commands on remote Windows machines and return results.

The primary goal is to allow Claude Code and Codex CLI running on Unraid to interact with:

* Windows PowerShell
* Windows applications
* Android Studio
* ADB-connected Android devices
* Visual Studio Build Tools
* Windows-specific software
* Hardware connected to Windows

Without requiring:

* RDP sessions
* Multiple AI sessions
* Manual file transfers
* Manual project cloning

---

# Architecture

```text
Browser
    │
    ▼
Opus Command
    │
    ├── Workspace Containers
    │      ├── Claude Code
    │      ├── Codex CLI
    │      └── Project Files
    │
    └── Connectors
           ├── Windows Desktop
           ├── Windows VM
           └── Future Connectors
```

Opus Command is the control plane.

Opus Connector executes tasks.

---

# Primary Goals

Allow AI agents to:

* Execute PowerShell commands
* Execute Windows commands
* Run Android builds
* Run tests
* Access connected devices
* Return output
* Return artifacts

Without leaving Opus Command.

---

# Windows Connector MVP

The Windows Connector must:

* Register with Opus Command
* Maintain a secure outbound connection
* Execute commands
* Stream output live
* Return exit codes
* Store temporary project files
* Upload artifacts back to Opus Command

---

# Installation

Default working directory:

```text
C:\OpusConnector
```

Directory structure:

```text
C:\OpusConnector

├── config
├── logs

├── Helpy
│   ├── jobs
│   ├── artifacts
│   └── temp

├── BLAM
│   ├── jobs
│   ├── artifacts
│   └── temp

└── OpusCommand
```

Each project receives its own workspace.

---

# Connectivity

Connector should never require inbound ports.

Architecture:

```text
Windows Connector
        │
Outbound HTTPS/WSS
        │
        ▼
Opus Command
```

Benefits:

* Works behind NAT
* Works from any network
* No VPN required
* No port forwarding required

Examples:

* Home PC
* Workstation
* Windows VM
* Laptop

---

# Command Execution

Supported command types:

## PowerShell

```powershell
Get-ComputerInfo
```

```powershell
.\Build.ps1
```

## Command Prompt

```cmd
gradlew assembleDebug
```

```cmd
adb devices
```

## Executables

Examples:

* Android Studio tools
* MSBuild
* Visual Studio Build Tools
* Custom utilities

---

# Output Streaming

Connector must stream:

* stdout
* stderr
* exit code
* execution time

Back to Opus Command in real time.

Example:

```text
Running PowerShell...
Downloading modules...
Build successful
Exit Code: 0
```

---

# File Transfer

## MVP

Simple managed file transfer through Opus Command.

```text
Workspace
    ↓
Connector
    ↓
Execution
    ↓
Artifacts
    ↓
Workspace
```

No RClone.

No SMB dependency.

No manual file copies.

---

# Artifacts

Connector can return:

* APK files
* ZIP files
* Logs
* Screenshots
* Reports
* Generated assets

Artifacts are stored in the project.

Example:

```text
Project
└── .opus
    └── artifacts
        └── job-001
```

---

# Opus CLI Integration

Workspaces communicate with connectors using an Opus CLI.

Examples:

```bash
opus connectors list
```

```bash
opus connector run windows-pc -- powershell "Get-ComputerInfo"
```

```bash
opus connector upload windows-pc build.ps1
```

```bash
opus connector artifacts get job-123
```

Claude Code and Codex CLI should be able to use these commands naturally.

No custom AI skill is required.

---

# Security Model (MVP)

Security is focused on preventing unauthorized access to connectors.

Once a trusted user is authenticated in Opus Command, Claude/Codex are trusted to execute commands on that user's behalf.

No approval popups are required in MVP.

---

## Pairing

Connector registration uses a one-time pairing token.

Flow:

```text
Opus Command
    ↓
Generate Pairing Token
    ↓
Install Connector
    ↓
Paste Token
    ↓
Connector Registers
    ↓
Permanent Connector Secret Issued
```

Pairing tokens automatically expire.

---

## Authentication

Each connector receives:

* Connector ID
* Connector Secret

Stored locally.

Future improvements:

* Windows Credential Manager
* Certificate authentication
* Mutual TLS

---

## Encryption

All communication uses:

```text
HTTPS
WSS
TLS
```

No unencrypted communication.

---

## Command Execution Authorization

MVP:

```text
Authenticated User
        ↓
Claude/Codex
        ↓
Connector Executes
```

No approval workflow.

No command allowlists.

No RBAC.

Future versions may support:

* Connector permissions
* Trusted projects
* Dangerous command warnings
* Approval workflows
* Command policies

---

## Audit Logging

Every command execution records:

* User
* Project
* Connector
* Command
* Start time
* End time
* Exit code

Example:

```text
2026-06-08

User: Karl
Project: Helpy
Connector: Windows Desktop

Command:
pwsh .\Build.ps1

Exit Code: 0
```

---

# Phase 2 – Android Development

Support:

* Android Studio
* Gradle
* ADB
* Connected Android devices
* APK builds
* Emulator support
* Screenshot capture

Example workflow:

```text
Claude Code
    ↓
Build Android App
    ↓
Connector
    ↓
Gradle Build
    ↓
APK Returned
```

---

# Phase 3 – Advanced Connector Features

Support:

* Multiple connectors
* Connector groups
* Connector labels
* Build pipelines
* Scheduled jobs
* Connector health monitoring

---

# Phase 4 – Hardware Testing

Support:

* USB devices
* COM ports
* Serial devices
* Embedded hardware
* Android devices

---

# Success Criteria

A user should be able to:

1. Run Claude Code inside an Opus Workspace.
2. Ask Claude to execute a PowerShell script.
3. Claude uses Opus CLI.
4. Windows Connector executes the script.
5. Output streams back live.
6. Generated files return to the project.
7. Claude continues working using the results.

Without:

* RDP
* Manual file copying
* Additional AI sessions
* Cloning the project to another machine

```
```
