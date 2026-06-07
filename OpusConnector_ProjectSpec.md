# Opus Connector

# Project Spec: Remote Execution Connectors

## Name: Opus Connector

## Purpose

Opus Connectors allow a project workspace to use tools, operating systems, hardware, and software that are not available on the main server.

The Opus Command remains the central location for:

- Project files
- AI sessions
- Git repositories
- User interaction
- Workspace management

Connectors extend a project by providing additional execution environments.

Examples:

- Windows VM
- Windows PC
- Linux machine
- macOS machine
- Android build machine
- Dedicated test machine
- Raspberry Pi
- Future cloud-hosted runners

---

## Goals

Allow AI coding agents to:

- Run commands on remote machines
- Test platform-specific code
- Access platform-specific tools
- Access connected hardware
- Build applications
- Execute automated tests
- Return logs and artifacts

Without requiring users to:

- Open additional AI sessions
- Manually switch computers
- Manually move files between machines

The Control Plane should remain the single interface used by the user.

---

## Connector Architecture

```text
Opus Command
│
├── Project Files
├── Git Repository
├── AI Sessions
├── Workspace Containers
│
└── Opus Connectors
     ├── Windows VM
     ├── Windows Desktop
     ├── Android Build Machine
     ├── macOS Build Machine
     └── Linux Test Machine
```

Connectors communicate with the Control Plane using a secure authenticated connection.

---

## Connector Agent

A lightweight Connector Agent should run on each connected machine.

Responsibilities:

- Register with Control Plane
- Authenticate
- Report health status
- Report available capabilities
- Receive approved jobs
- Execute commands
- Stream logs
- Return artifacts
- Sync project files
- Report failures

---

## Connector Capabilities

Each connector should advertise its capabilities.

Example:

```json
{
  "name": "Windows Development PC",
  "os": "Windows 11",
  "capabilities": [
    "powershell",
    "dotnet",
    "android-studio",
    "adb",
    "gradle",
    "windows-gui",
    "usb-access"
  ]
}
```

The Control Plane should use capabilities to determine which connector can perform a task.

---

## Example Use Cases

### Windows Development

Project requires:

- PowerShell
- Intune testing
- Windows-only software

AI requests:

```text
Run PowerShell script
Install dependency
Execute Windows-specific test
```

The Control Plane routes the task to a Windows Connector.

---

### Android Development

Project requires:

- Android Studio
- Gradle
- Connected Android device

AI requests:

```text
Build Android APK
Install APK
Run tests
Capture screenshots
```

The Control Plane routes the task to an Android-capable Connector.

Results are returned to the project.

---

### macOS Development

Project requires:

- Xcode
- iOS Simulator
- Apple SDKs

AI requests:

```text
Build iOS App
Run simulator
Capture screenshots
```

The Control Plane routes the task to a macOS Connector.

---

## File Synchronization

The project folder on the server is always the source of truth.

```text
Unraid Project Folder
        ↓
Temporary Connector Workspace
        ↓
Execution
        ↓
Artifacts / Changes Returned
        ↓
Project Folder Updated
```

Connectors should never permanently own project files.

This prevents drift between environments.

---

## Artifacts

Connectors can return artifacts to the project.

Examples:

- APK files
- EXE installers
- Screenshots
- Build logs
- Test reports
- Generated assets
- Videos
- Coverage reports

Artifacts should be stored in the project and visible through the Control Plane.

---

## Command Execution

Connectors should execute tasks as jobs.

Example:

```json
{
  "project": "MyApp",
  "connector": "Windows Development PC",
  "command": "pwsh ./scripts/test.ps1"
}
```

The Control Plane should:

1. Create job
2. Send job to connector
3. Stream logs
4. Track status
5. Return results

---

## Security

Connectors must authenticate with the Control Plane.

Requirements:

- Connector registration token
- TLS communication
- Connector permissions
- Project-level access control
- Job audit logging

The Control Plane must always know:

- Who requested a task
- Which connector executed it
- Which files were modified

---

## Approval System

The Control Plane should support approval workflows.

Examples:

```text
AI wants to execute:
PowerShell script

Approve?
[Approve]
[Deny]
```

```text
AI wants to install:
Android SDK Component

Approve?
[Approve]
[Deny]
```

Projects may optionally allow trusted commands without manual approval.

---

## Connector Dashboard

Each connector should display:

- Name
- Operating System
- Online Status
- Capabilities
- Active Jobs
- Last Check-In
- CPU Usage
- Memory Usage
- Disk Usage

---

## Future Features

- Live Remote Desktop
- Remote Browser Access
- Android Device Mirroring
- iPhone Device Mirroring
- USB Device Management
- GPU Workloads
- Cloud Runners
- Kubernetes Runners
- Distributed Build Systems
- AI Agent Task Scheduling
- Automatic Test Farms
- Hardware Lab Management