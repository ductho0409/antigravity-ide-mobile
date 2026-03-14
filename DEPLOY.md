# 🚀 Deployment Guide — Antigravity Mobile

> Step-by-step instructions for deploying on a **new macOS machine**.
> Designed to be read by both humans and AI assistants.

## Prerequisites

- **macOS** (tested on macOS 13+)
- **Node.js 18+** (`brew install node` or [download](https://nodejs.org/))
- **Antigravity IDE** installed at `/Applications/Antigravity.app`
- **Git** (`xcode-select --install` or `brew install git`)

---

## Step 1: Clone & Build

```bash
cd ~
git clone https://github.com/ductho0409/antigravity-ide-mobile.git
cd antigravity-ide-mobile

# Install dependencies
cd server && npm install && cd ..
cd client && npm install && npm run build && cd ..

# Build server
cd server && npm run build && cd ..
```

## Step 2: Create CDP App Shortcut

This creates `/Applications/Antigravity CDP.app` — a native macOS app that launches the IDE with Chrome DevTools Protocol on port 9223:

```bash
bash scripts/setup-cdp-app.sh
```

After running, **Antigravity CDP** will appear in Launchpad and `/Applications/`.

> **Why CDP?** The mobile server communicates with the IDE via CDP (Chrome DevTools Protocol). Without `--remote-debugging-port=9223`, the mobile dashboard cannot control the IDE (send messages, read chat, stream screen, etc.).

## Step 3: Setup pm2 (Process Manager)

```bash
# Install pm2 globally
npm install -g pm2

# Start the server
pm2 start ecosystem.config.cjs

# Auto-start on login
pm2 startup launchd && pm2 save
```

### pm2 Commands

| Command | Description |
|---------|-------------|
| `pm2 status` | Check server status |
| `pm2 logs antigravity-mobile` | View live logs |
| `pm2 restart antigravity-mobile` | Restart server |
| `pm2 stop antigravity-mobile` | Stop server |

## Step 4: Launch & Access

1. **Open Antigravity CDP** from Launchpad (or double-click in `/Applications/`)
2. Wait ~5 seconds for IDE to start
3. Verify CDP: `curl -s http://localhost:9223/json/version`
4. Access mobile dashboard:
   - **Same machine:** http://localhost:3333
   - **Phone (same Wi-Fi):** http://YOUR_IP:3333
   - **Via Tailscale:** http://TAILSCALE_IP:3333

---

## Updating

When code changes are pushed to GitHub:

```bash
cd ~/antigravity-ide-mobile
git pull origin main
cd server && npm run build && cd ..
cd client && npm run build && cd ..
pm2 restart antigravity-mobile
```

Or one-liner:

```bash
cd ~/antigravity-ide-mobile && git pull origin main && cd server && npm run build && cd ../client && npm run build && cd .. && pm2 restart antigravity-mobile
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| CDP not connecting | Launch IDE via `Antigravity CDP.app` or `bash scripts/start-ide.sh` |
| Port 9222 conflict | We use port **9223** — check `data/config.json` → `devices[0].cdpPort` |
| Can't access from phone | Same network? Check firewall: `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --listapps` |
| Message send fails silently | Server retries 3x with 1s delay. If still fails: IDE may be sleeping — wake Mac |
| pm2 not found | `npm install -g pm2` |
| Build errors | `cd client && rm -rf node_modules && npm install` |

---

## Architecture Notes

- **Server** runs on port 3333 (configurable via `PORT` env var)
- **CDP port** is 9223 (avoids conflict with Chrome agent on 9222)
- **Messages** are sent to IDE via CDP `Input.insertText` + `Input.dispatchKeyEvent`
- **Chat display** is scraped from IDE DOM via CDP and streamed to mobile via WebSocket
- **Clipboard backup** — each message is copied to clipboard before sending (fallback for HTTP contexts)
- **Retry logic** — CDP `injectAndSubmit` retries 3 times with 1s delay if IDE is unresponsive
- **Timeout** — all API calls have 15s timeout to prevent hanging requests
