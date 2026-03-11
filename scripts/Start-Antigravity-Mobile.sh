#!/bin/bash
# Antigravity Mobile Launcher - macOS/Linux
# Grant execute permission: chmod +x Start-Antigravity-Mobile.sh

cd "$(dirname "$0")/.."

echo ""
echo "=========================================="
echo "  Antigravity Mobile Server"
echo "=========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed!"
    echo ""
    echo "Would you like to see installation instructions? [Y/n]"
    read -r response
    if [[ "$response" =~ ^[Nn]$ ]]; then
        echo "Please install Node.js and run this script again."
        exit 1
    fi
    echo ""
    echo "Please install Node.js using one of the following methods:"
    echo ""
    echo "  macOS (Homebrew):"
    echo "    brew install node"
    echo ""
    echo "  Ubuntu/Debian:"
    echo "    sudo apt update && sudo apt install nodejs npm"
    echo ""
    echo "  Fedora:"
    echo "    sudo dnf install nodejs npm"
    echo ""
    echo "  Or download from: https://nodejs.org/"
    echo ""
    exit 1
fi

echo "Found Node.js: $(node --version)"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "First-time setup - Installing dependencies..."
    echo "This may take a minute..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "ERROR: Could not install dependencies!"
        exit 1
    fi
    echo ""
    echo "Dependencies installed successfully!"
    echo ""
fi

# Check if cloudflared is installed (needed for remote access)
if ! command -v cloudflared &> /dev/null; then
    echo "cloudflared is not installed (required for Remote Access feature)."
    echo ""
    echo "Install cloudflared now? (optional) [y/N]"
    read -r install_cf
    if [[ "$install_cf" =~ ^[Yy]$ ]]; then
        echo ""
        if [[ "$(uname)" == "Darwin" ]]; then
            # macOS
            if command -v brew &> /dev/null; then
                echo "Installing cloudflared via Homebrew..."
                brew install cloudflared
            else
                echo "Homebrew not found. Please install cloudflared manually:"
                echo "  brew install cloudflared"
                echo "  or download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
            fi
        else
            # Linux
            echo "Installing cloudflared..."
            ARCH=$(uname -m)
            if [[ "$ARCH" == "x86_64" ]]; then
                CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
            elif [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
                CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
            else
                echo "Unsupported architecture: $ARCH"
                echo "Please download manually from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
                CF_URL=""
            fi
            if [[ -n "$CF_URL" ]]; then
                sudo curl -L "$CF_URL" -o /usr/local/bin/cloudflared && sudo chmod +x /usr/local/bin/cloudflared
                if [ $? -eq 0 ]; then
                    echo "cloudflared installed successfully!"
                else
                    echo "WARNING: Could not install cloudflared. Remote access feature will be unavailable."
                fi
            fi
        fi
        echo ""
    fi
fi

echo "=========================================="
echo "  Security Setup (Optional)"
echo "=========================================="
echo ""
echo -n "Enter a 4-6 digit PIN (press Enter to skip): "
read -r pin_input

if [[ -n "$pin_input" && ${#pin_input} -ge 4 && ${#pin_input} -le 6 && "$pin_input" =~ ^[0-9]+$ ]]; then
    export MOBILE_PIN="$pin_input"
    echo ""
    echo "✅ PIN authentication enabled!"
elif [[ -n "$pin_input" ]]; then
    echo ""
    echo "⚠️  Invalid PIN (must be 4-6 digits). Continuing without authentication..."
else
    echo ""
    echo "Continuing without authentication..."
fi

echo ""
echo "Starting..."
echo ""

# Install server dependencies if needed
if [ ! -d "server/node_modules" ]; then
    echo "📦 Installing server dependencies..."
    cd server && npm install && cd ..
    echo ""
fi

# Install client dependencies if needed
if [ ! -d "client/node_modules" ]; then
    echo "📦 Installing client dependencies..."
    cd client && npm install && cd ..
    echo ""
fi

# Build client (Preact → dist/)
echo "🔨 Building client..."
cd client && npm run build && cd ..
echo ""

# Launcher: start server + Antigravity + CDP
cd server && npx tsx src/launcher.ts
