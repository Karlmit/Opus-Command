#!/bin/bash
# ensure-secrets.sh — create the Opus Connect API key and TLS certificate if
# missing. Both live on the flash (/boot) so they survive reboots. Idempotent;
# run by the rc script before every start and by the plugin installer.

CFG_DIR=/boot/config/plugins/opus-connect
CERT_DIR=$CFG_DIR/cert

mkdir -p "$CFG_DIR" "$CERT_DIR"

# API key: 64 hex chars, write-protected. Read per request by the agent, so a
# regenerate (regen-key.sh) applies without a daemon restart.
if [ ! -s "$CFG_DIR/api-key" ]; then
  umask 077
  openssl rand -hex 32 > "$CFG_DIR/api-key"
  chmod 600 "$CFG_DIR/api-key"
  echo "opus-connect: generated new API key"
fi

# Self-signed TLS certificate (10 years). Identity comes from SHA-256
# fingerprint pinning in Opus Command, not from CN/SAN, so a hostname change
# does not invalidate it. agent.pem = cert + key (what PHP's local_cert wants);
# agent.crt stays separate so the settings page can show the fingerprint.
if [ ! -s "$CERT_DIR/agent.pem" ]; then
  umask 077
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$CERT_DIR/agent.key" -out "$CERT_DIR/agent.crt" \
    -subj "/CN=opus-connect.$(hostname 2>/dev/null || echo unraid)" >/dev/null 2>&1
  cat "$CERT_DIR/agent.crt" "$CERT_DIR/agent.key" > "$CERT_DIR/agent.pem"
  chmod 600 "$CERT_DIR/agent.pem" "$CERT_DIR/agent.key"
  rm -f "$CERT_DIR/agent.key"
  echo "opus-connect: generated new TLS certificate"
fi
