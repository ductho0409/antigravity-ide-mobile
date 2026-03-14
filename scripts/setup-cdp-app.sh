#!/bin/bash
# ============================================================================
# Setup Antigravity CDP.app — macOS Application Shortcut
# Creates a native .app bundle in /Applications that launches Antigravity IDE
# with Chrome DevTools Protocol (CDP) enabled on port 9223
# ============================================================================

set -e

APP_PATH="/Applications/Antigravity CDP.app"
IDE_PATH="/Applications/Antigravity.app"

echo "🔧 Creating Antigravity CDP.app..."

# Check IDE exists
if [ ! -d "$IDE_PATH" ]; then
    echo "❌ Antigravity IDE not found at $IDE_PATH"
    echo "   Please install Antigravity IDE first."
    exit 1
fi

# Create .app bundle structure
mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources"

# Create launcher script
cat > "$APP_PATH/Contents/MacOS/Antigravity CDP" << 'LAUNCHER'
#!/bin/bash
pkill -f "Antigravity.app/Contents/MacOS/Electron" 2>/dev/null
sleep 2
/Applications/Antigravity.app/Contents/MacOS/Electron --remote-debugging-port=9223 &
LAUNCHER
chmod +x "$APP_PATH/Contents/MacOS/Antigravity CDP"

# Create Info.plist
cat > "$APP_PATH/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Antigravity CDP</string>
    <key>CFBundleName</key>
    <string>Antigravity CDP</string>
    <key>CFBundleIconFile</key>
    <string>antigravity</string>
    <key>CFBundleIdentifier</key>
    <string>com.antigravity.cdp-launcher</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
</dict>
</plist>
PLIST

# Copy icon from Antigravity IDE (if available)
if [ -f "$IDE_PATH/Contents/Resources/antigravity.icns" ]; then
    cp "$IDE_PATH/Contents/Resources/antigravity.icns" "$APP_PATH/Contents/Resources/"
    echo "✅ Icon copied from Antigravity IDE"
fi

echo "✅ Antigravity CDP.app created at $APP_PATH"
echo "   Double-click in /Applications or Launchpad to launch IDE with CDP on port 9223"
echo ""
echo "📱 After launching, start the mobile server:"
echo "   pm2 start ecosystem.config.cjs"
echo "   Access: http://<YOUR_IP>:3333"
