# Opus Connect — Unraid plugin

Opus Connect is the secure bridge between [Opus Command](https://github.com/Karlmit/Opus-Command)
and an Unraid server. It replaces Opus Command's legacy root-SSH access for the
Unraid LXC workspace backend: instead of holding a root SSH private key, Opus
Command holds an API key for this agent and can only invoke a **fixed set of
pre-approved, validated actions**.

## Why

With direct SSH, Opus Command effectively has a root shell on the Unraid host —
anyone who compromises the app (or its data volume, which stores the SSH key)
owns the server. With Opus Connect:

- **No SSH key in the app.** The agent's API key only unlocks the named actions
  below — there is no general shell.
- **Server-side enforcement.** The agent validates everything itself: container
  names must match `opus-workspace-…`, project paths must stay under the
  configured share root, and the LXC base path / share root / distro defaults
  come from the plugin's own settings on Unraid — the caller cannot redirect
  them.
- **No host shell construction.** Every command is spawned from an argv array
  (`proc_open`); caller-supplied strings are never interpolated into a host
  shell. Caller-supplied scripts run only *inside* the validated workspace
  container via `lxc-attach`.
- **Encrypted transport.** TLS with a self-signed certificate generated at
  install. Opus Command pins the certificate's SHA-256 fingerprint on the first
  successful connection test and refuses to send credentials if it ever
  changes. Secrets (API key, provisioning payloads) never travel in clear text.
- **Throttled auth + audit log.** Failed API-key attempts are delayed and
  logged; every action is logged with source IP, action, target, and duration
  to `/var/log/opus-connect/agent.log` (RAM disk — never wears the flash).
- **Optional IP allowlist.** Restrict callers to the Opus Command host's LAN IP.

## Install

1. On Unraid: **Plugins → Install Plugin** and paste:

   ```
   https://raw.githubusercontent.com/Karlmit/Opus-Command/main/unraid-plugin/opus-connect.plg
   ```

2. Open **Settings → Opus Connect**. The page shows the agent URL
   (`https://<unraid-lan-ip>:9123`), the generated API key, and the TLS
   certificate fingerprint. Check that the *Project share root* matches where
   your Opus workspace projects live (default `/mnt/user/opus-projects`).

3. In Opus Command: **Settings → Workspace → Unraid LXC**, choose
   **Opus Connect agent**, paste the agent URL and API key, and press
   **Test Connection**. The first successful test pins the certificate
   fingerprint automatically. Then **Run LXC Preflight**.

The agent starts at boot (the plugin re-installs from flash on every boot and
the `started` event re-asserts it) and also right after plugin install/update.
Requires the Unraid **LXC plugin** for the workspace actions; `host.ping`
works without it.

State on the flash (`/boot/config/plugins/opus-connect/`): `opus-connect.cfg`
(settings), `api-key` (0600), `cert/agent.pem` + `cert/agent.crt`. Uninstalling
the plugin deletes all of it, including the key and certificate.

## Action surface

The agent answers `POST /v1/rpc` (`{ action, params }`, Bearer auth) with
exactly these actions — nothing else:

| Action | What it does |
| --- | --- |
| `host.ping` | hostname + agent version (connection test) |
| `lxc.preflight` | check LXC tools, paths, helper |
| `lxc.create` | create workspace container + `/workspace` bind mount |
| `lxc.status` | container state + LAN IP (for the terminal proxy) |
| `lxc.start` / `lxc.stop` / `lxc.restart` / `lxc.destroy` | lifecycle (destroy never touches project files) |
| `lxc.waitAttachable` | readiness gate after start (init-pid race) |
| `lxc.provision` | run a provisioning script *inside* the container (stdin) |
| `workspace.exec` | run one command *inside* the container (Git menu, Docker-in-workspace controls, terminal-agent restart) |
| `terminal.setAgentToken` | rotate the in-container terminal-agent token (stdin, 0600) |
| `terminal.probeAgent` | health-probe the in-container terminal-agent over the LAN (IP resolved server-side) |

The complete mapping from Opus Command's legacy SSH calls to these actions is
documented in the repo at `.planning/unraid-lxc-ssh-actions.md`.

## Settings page

**Settings → Opus Connect** on Unraid lets you: enable/disable the agent,
change the port (default `9123`), set an allowed-IP list, set the project share
root and LXC base path (blank = auto-detect from `lxc.lxcpath`), set distro
defaults for new containers, regenerate the API key (applies instantly — the
agent re-reads it per request), restart the agent, and view recent activity.

## Repo layout / packaging

```
unraid-plugin/
  opus-connect.plg     installer (entities: version, package MD5)
  package.sh           builds archive/opus-connect-<ver>-x86_64-1.txz
  archive/             the built package the .plg downloads
  source/              package contents
    etc/rc.d/rc.opus-connect              start/stop script
    usr/local/opus-connect/agentd.php     the agent daemon (single-file PHP, no deps)
    usr/local/opus-connect/*.sh           secrets/apply/regen helpers
    usr/local/emhttp/plugins/opus-connect/  webGUI settings page
```

`package.sh` copies the canonical `opus-lxc` helper from
`../src/workspace/opus-lxc.sh` at build time (single source of truth), stamps
the version into the agent, rebuilds the `.txz`, and updates the `.plg`
version + MD5 entities. After changing anything under `source/` or the helper:

```bash
cd unraid-plugin && ./package.sh        # version defaults to today (Y.M.D)
```

Commit the regenerated `archive/*.txz` and `opus-connect.plg` together — the
`.plg` downloads the package from this repo's `main` branch.
