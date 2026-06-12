#!/bin/bash
# regen-key.sh — replace the Opus Connect API key. The agent reads the key file
# on every request, so the new key applies immediately without a restart. The
# old key stops working the moment this script finishes.

CFG_DIR=/boot/config/plugins/opus-connect
mkdir -p "$CFG_DIR"
umask 077
openssl rand -hex 32 > "$CFG_DIR/api-key"
chmod 600 "$CFG_DIR/api-key"
echo "opus-connect: API key regenerated — update it in Opus Command settings"
