# Opus Connector for Linux

The Linux connector pairs a Linux host with Opus Command and lets workspaces run
commands on that host through the connector protocol.

Initial targets:

- Ubuntu
- Debian
- Linux Mint
- Unraid

## Install

### One-file installer

From the Opus Command repo, build the installer:

```bash
cd connectors/linux
npm run build:installer
```

Copy `../../dist/opus-linux-connector-installer.sh` to the Linux machine and run:

```bash
sudo ./opus-linux-connector-installer.sh --server http://OPUS_HOST:3000 --pair PAIRING_TOKEN
```

On a Linux desktop with Zenity available, you can launch the graphical installer:

```bash
./opus-linux-connector-installer.sh --gui
```

If the executable installer is opened with no terminal arguments from a graphical
desktop, it also tries to open the graphical installer automatically. The GUI
collects the dependency profile, service/autostart choices, pairing details, and
status UI port, then asks for administrator approval through PolicyKit.

Useful installer options:

```bash
sudo ./opus-linux-connector-installer.sh --profile full --service yes
sudo ./opus-linux-connector-installer.sh --profile minimal --service no --autostart yes
```

On Unraid or another Linux distribution without `apt`/systemd, install Node.js
and npm first, then run:

```bash
sudo ./opus-linux-connector-installer.sh --profile none --service no
cd /opt/opus-connector && node src/index.js --home /var/lib/opus-connector
```

### Manual install

Install Node.js 20 or newer first, then install dependencies:

```bash
cd connectors/linux
npm install --omit=dev
```

Run a preflight report:

```bash
node src/index.js --preflight
node src/index.js --preflight --json
```

Optional dependency profiles for Debian/Ubuntu/Linux Mint:

```bash
sudo ./install.sh minimal
sudo ./install.sh docker
sudo ./install.sh browser
sudo ./install.sh full
```

Pair with Opus Command:

```bash
node src/index.js --server http://OPUS_HOST:3000 --pair PAIRING_TOKEN --name "Linux Server"
```

## Status UI

The connector starts a local status UI by default:

```text
http://127.0.0.1:3899
```

The UI shows pairing state, connection state, detected capabilities, and recent
logs. If the connector is not paired yet, the UI includes a pairing form.

Options:

```bash
node src/index.js --ui-port 3901
node src/index.js --ui-host 0.0.0.0
node src/index.js --no-ui
```

Install as a systemd service:

```bash
sudo node src/index.js --install-service
sudo systemctl status opus-connector
```

The service stores state in `/var/lib/opus-connector` when installed as root.
For non-root/manual runs, the default home is `~/.opus-connector`.

Start after desktop login instead:

```bash
node src/index.js --install-autostart
```

Self-update from a newer one-file installer:

```bash
sudo node src/index.js --self-update --installer ./opus-linux-connector-installer.sh
sudo node src/index.js --self-update --installer-url https://example.com/opus-linux-connector-installer.sh
```

## Jobs

Supported shells:

- `bash`
- `sh`
- `python` / `python3`
- `pwsh`
- direct executables

Artifacts written to `$OPUS_CONNECTOR_ARTIFACT_DIR` are uploaded after the job
finishes.

## Connector v2 Features

Run a command:

```bash
opus connector run linux -- bash "uname -a"
```

Run a script without shell quoting:

```bash
opus connector run linux --shell bash --script ./build.sh
cat ./build.sh | opus connector run linux --shell bash --stdin
```

Start an async job and manage it:

```bash
opus connector run linux --wait false -- bash "sleep 60"
opus connector jobs list linux
opus connector jobs status JOB_ID
opus connector jobs cancel JOB_ID
```

Transfer files:

```bash
opus connector put ./local.txt linux:/tmp/local.txt
opus connector get linux:/tmp/local.txt ./downloaded.txt
```

File transfer uses chunked connector WebSocket messages. Uploads stream raw
bytes from the workspace CLI to Opus Command, and downloads stream connector
chunks back through the HTTP response.

If the connector disconnects while a job is still queued, running, or canceling,
Opus Command marks the job as `lost` and records that the connector disconnected
before completion.

Capture a browser screenshot when the connector has Playwright:

```bash
opus browser screenshot linux https://example.com ./screenshot.png
```
