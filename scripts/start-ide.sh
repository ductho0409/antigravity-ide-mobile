#!/bin/bash
# Launch Antigravity IDE with CDP enabled on port 9223
# (Port 9222 is reserved for Chrome agent browser)
# IMPORTANT: All existing Antigravity instances must be closed first!

echo "🛑 Closing any running Antigravity instances..."
pkill -f "Antigravity.app/Contents/MacOS/Electron" 2>/dev/null
sleep 3

echo "🚀 Launching Antigravity IDE with CDP on port 9223..."
nohup /Applications/Antigravity.app/Contents/MacOS/Electron --remote-debugging-port=9223 > /dev/null 2>&1 &
sleep 3

# Verify CDP is running
if curl -s http://localhost:9223/json/version > /dev/null 2>&1; then
    echo "✅ CDP active on port 9223!"
    echo "📱 Mobile dashboard: http://localhost:3333"
else
    echo "⏳ IDE is starting up, CDP may take a few more seconds..."
    echo "   Check with: curl http://localhost:9223/json/version"
fi
