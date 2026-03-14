#!/bin/bash
# Antigravity Mobile Bridge — macOS Service Uninstaller

PLIST_NAME="com.antigravity.mobile-bridge"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

if [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    rm "$PLIST_PATH"
    echo "✅ Service removed: $PLIST_NAME"
else
    echo "ℹ️ Service not installed"
fi
