#!/bin/bash
# Stop Antigravity Mobile - macOS/Linux
# Grant execute permission: chmod +x Stop-Antigravity-Mobile.sh

echo ""
echo "=========================================="
echo "  Stopping Antigravity Mobile Server"
echo "=========================================="
echo ""

PORT=3333
PID=""

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - use lsof
    PID=$(lsof -ti :$PORT 2>/dev/null)
else
    # Linux - try multiple methods
    if command -v lsof &> /dev/null; then
        PID=$(lsof -ti :$PORT 2>/dev/null)
    elif command -v fuser &> /dev/null; then
        PID=$(fuser $PORT/tcp 2>/dev/null)
    elif command -v ss &> /dev/null; then
        # Get PID using awk instead of grep -P
        PID=$(ss -tlnp 2>/dev/null | awk -v port=":$PORT " '$0 ~ port {match($0, /pid=[0-9]+/); print substr($0, RSTART+4, RLENGTH-4)}')
    fi
fi

if [ -n "$PID" ]; then
    echo "Found server process with PID: $PID"
    kill -9 $PID 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "Server stopped successfully!"
    else
        echo "Could not stop process $PID"
        echo "You may need to run with sudo: sudo ./Stop-Antigravity-Mobile.sh"
    fi
else
    echo "No server found running on port $PORT."
fi

# Kill any orphaned cloudflared tunnel processes
CF_PIDS=$(pgrep -f "cloudflared tunnel" 2>/dev/null)
if [ -n "$CF_PIDS" ]; then
    echo "Stopping cloudflared tunnel (PID: $CF_PIDS)..."
    kill $CF_PIDS 2>/dev/null
    sleep 1
    # Force kill if still alive
    for pid in $CF_PIDS; do
        kill -0 $pid 2>/dev/null && kill -9 $pid 2>/dev/null
    done
    echo "Cloudflared stopped!"
fi

echo ""
