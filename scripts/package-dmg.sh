#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 /path/to/YourApp.app /path/to/output.dmg"
  exit 1
fi

APP_PATH="$1"
DMG_PATH="$2"

if [ ! -d "$APP_PATH" ]; then
  echo "App not found at: $APP_PATH"
  exit 1
fi

echo "Packaging $APP_PATH -> $DMG_PATH"

TMPDIR=$(mktemp -d)
WORKDIR="$TMPDIR/volume"
mkdir -p "$WORKDIR"

# Copy app into a folder; this will be the DMG contents
cp -R "$APP_PATH" "$WORKDIR/"

# Create a compressed read-only DMG
hdiutil create -volname "VoiceHotkeyApp" -srcfolder "$WORKDIR" -ov -format UDZO "$DMG_PATH"

echo "DMG created at: $DMG_PATH"

rm -rf "$TMPDIR"
