# Opus Command

# Project Spec: Vibe Coding Workspace

## Name: Opus Command

## Vision

Create a self-hosted Docker web application specifically designed for AI-assisted software development ("vibe coding").

This is NOT intended to be a traditional IDE.

The target user is someone who primarily directs AI coding agents and only occasionally edits code manually.

The application should feel like an AI project cockpit rather than a browser-based IDE.

---

## Primary Goals

The application should make it easy to:

- Browse project files
- Read and edit text files
- View images
- Upload and download files
- Run and manage AI coding agents
- Access project terminals without tmux
- Continue working from multiple PCs, tablets, and phones
- View AI activity
- Review changes
- Manage Git safely
- Manage project-specific development environments

---

# Architecture

## Main Application Container (Control Plane)

The main Docker container acts as the control plane.

Responsibilities:

- Authentication
- User management
- Project management
- File browser
- Text editor
- Image viewer
- Terminal UI
- Notifications
- Git UI
- Workspace management
- Docker orchestration
- Session management

Required volumes:

```text
/projects
/app/data
```

The application should have access to Docker so it can create and manage workspace containers.

---

## Workspace Containers

Each project runs inside its own isolated workspace container.

A workspace container is created from a base image and mounted to the selected project folder.

Example:

```text
Main App

├── Project: BLAM
│   └── Workspace Container
│       ├── /workspace -> /projects/BLAM
│       ├── Claude Code
│       ├── Codex CLI
│       ├── Git
│       ├── Node.js
│       └── Persistent Home Volume
│
├── Project: Helpy
│   └── Workspace Container
│       ├── /workspace -> /projects/Helpy
│       ├── Claude Code
│       ├── Python
│       ├── Git
│       └── Persistent Home Volume
│
└── Project: Nordskift
    └── Workspace Container
        ├── /workspace -> /projects/Nordskift
        ├── Claude Code
        ├── Image Tools
        ├── Git
        └── Persistent Home Volume
```

Benefits:

- Project isolation
- Separate AI logins/configuration
- Different installed tools per project
- Easier recovery
- Easier upgrades
- Easier rebuilding
- Better security
- Persistent terminal sessions

---

# Authentication

## First Run

When the application starts for the first time:

1. Create Admin User
2. Username
3. Password
4. Confirm Password

## Security Requirements

- Secure password hashing
- Session-based authentication
- Secure cookies
- CSRF protection
- Login rate limiting
- Password change support
- Disable public signup option

---

# Project Management

## Create Project

User provides:

- Project Name
- Project Folder
- Workspace Template

System automatically:

1. Creates project record
2. Creates workspace container
3. Mounts project folder
4. Creates persistent workspace volume
5. Starts workspace container

---

## Project Dashboard

Each project should display:

- Project Name
- Workspace Status
- Active AI Sessions
- Active Terminal Sessions
- Git Status
- Changed Files
- Recent Activity
- Notifications

---

# File Management

The file manager should feel similar to VS Code.

Required:

- Folder Tree
- Create File
- Create Folder
- Rename
- Delete
- Copy
- Move
- Upload
- Download
- Search Files
- Search Content
- Copy filepath

Supported file types:

- Text
- Markdown
- JSON
- YAML
- Images
- Source Code

The system must prevent access outside the configured project folder.

---

# Editor

The editor is intentionally lightweight.

Required:

- Text Editing
- Syntax Highlighting
- Markdown Preview
- JSON Formatting
- YAML Formatting
- Image Viewer
- Save
- Auto Save (optional)
- Unsaved Changes Warning

Nice to Have:

- Split View
- Diff View
- Ask AI About File
- Explain File
- Summarize File

---

# Terminal System

The terminal system is one of the most important features.

Goal: eliminate the need for tmux.

Required:

- Multiple terminal sessions
- Named terminal sessions
- Persistent terminal sessions
- Session reconnect across devices
- Session reconnect after browser refresh
- Terminal scrollback persistence
- Mobile-friendly terminal UI
- Copy/Paste support
- Hide/Show terminal
- Resize terminal

Terminal state belongs to the workspace container, not the browser.

---

# AI Session Awareness

The application should understand when an AI coding agent is active.

Supported agents:

- Claude Code
- Codex CLI
- OpenCode
- Future CLI agents

Required:

- Detect active AI sessions
- Detect waiting-for-input states
- Show notifications when AI needs attention
- Show which terminal contains the active AI session
- Reconnect to AI sessions

Examples:

- Claude waiting for approval
- Codex requesting confirmation
- Agent waiting for user response

Notification methods:

- Project badge
- Terminal badge
- Browser notification
- Optional sound

---

# Git Integration

Git safety is critical.

Required:

- Git Status
- Current Branch
- Changed Files
- File Diff Viewer
- Revert File
- Revert All Changes
- Commit Changes
- Create Branch
- Create Snapshot

Recommended workflow:

1. Open Project
2. View Git Status
3. Create Snapshot
4. Start AI Session
5. Review Changes
6. Commit or Revert

---

# Workspace Lifecycle

Workspace containers must support:

- Start
- Stop
- Restart
- Rebuild
- Recreate
- View Logs
- View Health Status
- Reset Environment

Installed tools and AI logins must survive container restarts.

Use:

- Persistent Home Volume
- Persistent Config Volume
- Workspace Metadata

---

# Workspace Templates

## General Development

Includes:

- Git
- Claude Code
- Codex CLI
- curl
- wget

## Node.js Development

Includes:

- Node.js
- npm
- pnpm
- yarn
- Git
- Claude Code
- Codex CLI

## Python Development

Includes:

- Python
- pip
- venv
- Git
- Claude Code
- Codex CLI

## PowerShell Development

Includes:

- PowerShell
- Git
- Claude Code
- Codex CLI

---

# Mobile Experience

Mobile support is a first-class feature.

Required:

- Responsive layout
- File browsing
- File viewing
- Image viewing
- Terminal access
- AI session notifications
- Session switching

The user should be able to:

- Start work on a PC
- Continue on another PC
- Continue on a phone
- Continue on a tablet

Without losing terminal sessions or AI session context.

---

# Future Features

- Opus Connector, see /mnt/projects/claude/OpusCommand/OpusConnector_ProjectSpec.md
- AI Chat Sidebar
- Voice Input
- AI Session History
- AI Task Queue
- GitHub Integration
- Azure DevOps Integration
- One-Click Workspace Sharing
- Multi-User Support
- Team Workspaces
- Preview Web Apps Inside Browser
- Docker Compose Management
- Automatic Workspace Backups
- Workspace Snapshots
- Project Templates
- Claude Code Session Timeline
- AI Cost Tracking
- Workspace Resource Monitoring