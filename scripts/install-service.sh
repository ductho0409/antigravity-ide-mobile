#!/bin/bash
# Antigravity Mobile Bridge — macOS Service Installer
# Installs/reinstalls as a launchd user agent (auto-start on login)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_NAME="com.antigravity.mobile-bridge"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
LOG_DIR="$PROJECT_DIR/logs"
SERVER_DIR="$PROJECT_DIR/server"

# Find node
NODE_PATH="$(which node 2>/dev/null || echo "/opt/homebrew/bin/node")"
if [ ! -x "$NODE_PATH" ]; then
    echo "❌ Node.js not found. Install it first: brew install node"
    exit 1
fi

echo "╔══════════════════════════════════════════╗"
echo "║  📱 Antigravity Mobile Service Installer ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Node: $NODE_PATH"

# 1. Build if needed
if [ ! -d "$SERVER_DIR/node_modules" ]; then
    echo "📦 Installing dependencies..."
    cd "$PROJECT_DIR/client" && npm install
    cd "$SERVER_DIR" && npm install
    cd "$PROJECT_DIR" && npm run build
fi

# 2. Create log directory
mkdir -p "$LOG_DIR"

# 3. Resolve tsx loader paths
TSX_PREFLIGHT="$SERVER_DIR/node_modules/tsx/dist/preflight.cjs"
TSX_LOADER="file://$SERVER_DIR/node_modules/tsx/dist/loader.mjs"

# 4. Unload old service if exists
if launchctl list 2>/dev/null | grep -q "$PLIST_NAME"; then
    echo "🔄 Stopping existing service..."
    launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

# 5. Generate plist — uses node directly (avoids macOS bash permission issues)
cat > "$PLIST_DEST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>--require</string>
        <string>$TSX_PREFLIGHT</string>
        <string>--import</string>
        <string>$TSX_LOADER</string>
        <string>$SERVER_DIR/src/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SERVER_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/server.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/server.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
EOF

# 6. Load service
launchctl load "$PLIST_DEST"
echo "✅ Service loaded and started"

# 7. Verify
sleep 3
if curl -s --connect-timeout 2 http://localhost:3333/api/health | grep -q '"ok"' 2>/dev/null; then
    echo ""
    echo "╔══════════════════════════════════════════╗"
    echo "║  ✅ Service installed successfully!       ║"
    echo "╠══════════════════════════════════════════╣"
    echo "║  Dashboard:  http://localhost:3333       ║"
    echo "║  Auto-start: ✅ On login                 ║"
    echo "╚══════════════════════════════════════════╝"
elif launchctl list 2>/dev/null | grep -q "$PLIST_NAME"; then
    echo ""
    echo "✅ Service registered (may take a few seconds to fully start)"
    echo "   Dashboard: http://localhost:3333"
else
    echo "❌ Service failed. Check: cat $LOG_DIR/server.error.log"
    exit 1
fi

echo ""
echo "Commands:"
echo "  Stop:    launchctl unload $PLIST_DEST"
echo "  Start:   launchctl load   $PLIST_DEST"
echo "  Restart: launchctl unload $PLIST_DEST && launchctl load $PLIST_DEST"
echo "  Logs:    tail -f $LOG_DIR/server.log"
echo "  Remove:  bash $PROJECT_DIR/scripts/uninstall-service.sh"
