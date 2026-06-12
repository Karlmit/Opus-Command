#!/usr/bin/env bash
#
# package.sh — build the Opus Connect Unraid plugin package.
#
# Stages source/, pulls in the canonical opus-lxc helper from
# ../src/workspace/opus-lxc.sh (single source of truth — never edit the copy),
# stamps the version, builds archive/opus-connect-<version>-x86_64-1.txz, and
# updates the version + MD5 entities in opus-connect.plg.
#
# Usage: ./package.sh [version]   (default: today's date, Unraid-style Y.M.D)

set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-$(date +%Y.%m.%d)}"
PKG="opus-connect-$VERSION-x86_64-1.txz"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cp -a source/. "$STAGE/"

# Canonical helper script — shared with the SSH transport, owned by the plugin
# in agent mode. Copied at build time so there is exactly one source file.
cp ../src/workspace/opus-lxc.sh "$STAGE/usr/local/opus-connect/opus-lxc"

sed -i "s/@VERSION@/$VERSION/g" "$STAGE/usr/local/opus-connect/agentd.php"

chmod 755 "$STAGE/etc/rc.d/rc.opus-connect" \
          "$STAGE/usr/local/opus-connect/agentd.php" \
          "$STAGE/usr/local/opus-connect/opus-lxc" \
          "$STAGE/usr/local/opus-connect/"*.sh \
          "$STAGE/usr/local/emhttp/plugins/opus-connect/event/started"

mkdir -p "$STAGE/install"
cat > "$STAGE/install/slack-desc" <<'EOF'
opus-connect: opus-connect (Opus Command host agent)
opus-connect:
opus-connect: Secure agent that lets Opus Command manage LXC workspaces on this
opus-connect: Unraid server without SSH access. Exposes only pre-approved,
opus-connect: validated actions over TLS with API-key authentication.
opus-connect:
opus-connect: https://github.com/Karlmit/Opus-Command
EOF

mkdir -p archive
rm -f archive/opus-connect-*.txz archive/opus-connect-*.txz.md5
(cd "$STAGE" && tar --owner=0 --group=0 -cJf - .) > "archive/$PKG"

MD5=$(md5sum "archive/$PKG" | awk '{print $1}')
echo "$MD5" > "archive/$PKG.md5"

sed -i -E "s|(<!ENTITY version   \")[^\"]*|\1$VERSION|" opus-connect.plg
sed -i -E "s|(<!ENTITY pkgMD5    \")[^\"]*|\1$MD5|" opus-connect.plg

echo "built archive/$PKG"
echo "md5   $MD5"
echo "plg   version + MD5 entities updated"
