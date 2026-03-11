#!/usr/bin/env node
/**
 * Antigravity Mobile Launcher (TypeScript)
 * 1:1 port from src/launcher.mjs
 *
 * One-click script that:
 * 1. Starts the HTTP/TypeScript server
 * 2. Finds Antigravity installation (Windows/Mac/Linux)
 * 3. Launches Antigravity with CDP enabled (--remote-debugging-port=9222)
 *
 * Usage: npx tsx src/launcher.ts
 */

import { spawn, exec } from 'child_process';
import { existsSync } from 'fs';
import { platform, homedir, networkInterfaces } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CDP_PORT = 9222;
const HTTP_PORT = parseInt(process.env['PORT'] || '3333', 10);

// ============================================================================
// Antigravity Installation Paths by Platform
// ============================================================================
const ANTIGRAVITY_PATHS: Record<string, string[]> = {
    win32: [
        join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'Antigravity.exe'),
        join(process.env.LOCALAPPDATA || '', 'Antigravity', 'Antigravity.exe'),
        join(process.env.PROGRAMFILES || '', 'Antigravity', 'Antigravity.exe'),
        join(process.env['PROGRAMFILES(X86)'] || '', 'Antigravity', 'Antigravity.exe'),
        join(homedir(), 'AppData', 'Local', 'Programs', 'Antigravity', 'Antigravity.exe'),
        join(homedir(), 'AppData', 'Local', 'Antigravity', 'Antigravity.exe'),
    ],
    darwin: [
        '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
        join(homedir(), 'Applications', 'Antigravity.app', 'Contents', 'MacOS', 'Antigravity'),
    ],
    linux: [
        '/usr/bin/antigravity',
        '/usr/local/bin/antigravity',
        '/opt/Antigravity/antigravity',
        join(homedir(), '.local', 'bin', 'antigravity'),
    ],
};

// ============================================================================
// Helper Functions
// ============================================================================
function log(emoji: string, message: string): void {
    console.log(`${emoji}  ${message}`);
}

function logSection(title: string): void {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  ${title}`);
    console.log(`${'─'.repeat(50)}`);
}

async function findAntigravityPath(): Promise<string | null> {
    const os = platform();
    const paths = ANTIGRAVITY_PATHS[os] || [];

    for (const p of paths) {
        if (p && existsSync(p)) return p;
    }

    // Try system commands
    if (os === 'win32') {
        return await findViaCommand('where Antigravity.exe');
    } else {
        return await findViaCommand('which antigravity');
    }
}

async function findViaCommand(cmd: string): Promise<string | null> {
    return new Promise((resolve) => {
        exec(cmd, (_err, stdout) => {
            const path = stdout?.split('\n')[0]?.trim();
            resolve(path && existsSync(path) ? path : null);
        });
    });
}

async function isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const cmd = platform() === 'win32'
            ? `netstat -ano | findstr :${port} | findstr LISTENING`
            : `lsof -i :${port}`;

        exec(cmd, (_err, stdout) => {
            resolve(!!stdout && stdout.trim().length > 0);
        });
    });
}

function getLocalIPs(): Array<{ address: string; name: string }> {
    const ips: Array<{ address: string; name: string }> = [];
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of (nets[name] || [])) {
            if (net.family === 'IPv4' && !net.internal) {
                ips.push({ address: net.address, name: name.toLowerCase() });
            }
        }
    }
    return ips;
}

function getBestIP(ipEntries: Array<{ address: string; name: string }>): string {
    // Prefer real network interfaces (Wi-Fi, Ethernet) over virtual adapters
    const realPatterns = ['wi-fi', 'wifi', 'wlan', 'ethernet', 'eth', 'en0', 'en1'];
    const virtualPatterns = ['vmware', 'virtualbox', 'vbox', 'hyper-v', 'vethernet', 'docker', 'wsl', 'loopback'];

    // Filter to 192.168.x.x IPs that aren't .1 (gateway/host addresses)
    const candidates = ipEntries.filter(e =>
        e.address.startsWith('192.168.') && !e.address.endsWith('.1')
    );

    // Try real interface names first
    for (const pattern of realPatterns) {
        const match = candidates.find(e => e.name.includes(pattern));
        if (match) return match.address;
    }

    // Try any non-virtual candidate
    const nonVirtual = candidates.find(e =>
        !virtualPatterns.some(v => e.name.includes(v))
    );
    if (nonVirtual) return nonVirtual.address;

    // Fall back to any 192.168.x.x
    const any192 = ipEntries.find(e => e.address.startsWith('192.168.'));
    if (any192) return any192.address;

    return ipEntries[0]?.address || 'YOUR_IP';
}

async function waitForServer(port: number, timeout = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const res = await fetch(`http://localhost:${port}/api/health`);
            if (res.ok) return true;
        } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

async function waitForCDP(port: number, timeout = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const res = await fetch(`http://localhost:${port}/json/version`);
            if (res.ok) return true;
        } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

// ============================================================================
// Main Launch Sequence
// ============================================================================
async function main(): Promise<void> {
    console.log(`
╔════════════════════════════════════════════════════════╗
║          ⚡ Antigravity Mobile Launcher                ║
╠════════════════════════════════════════════════════════╣
║  One-click setup for mobile streaming + CDP control    ║
╚════════════════════════════════════════════════════════╝
    `);

    const os = platform();
    log('💻', `Platform: ${os}`);

    // ========================================================================
    // Step 1: Start HTTP Server (TypeScript)
    // ========================================================================
    logSection('🌐 Starting HTTP Server');

    const serverEntryPath = join(__dirname, 'index.ts');

    if (!existsSync(serverEntryPath)) {
        log('❌', `HTTP server not found at: ${serverEntryPath}`);
        process.exit(1);
    }

    let serverRunning = false;

    if (await isPortInUse(HTTP_PORT)) {
        // Port is in use — verify the server is actually healthy
        const isHealthy = await waitForServer(HTTP_PORT, 3000);

        if (isHealthy) {
            log('✅', `HTTP server already running on port ${HTTP_PORT}`);
            serverRunning = true;

            // Push MOBILE_PIN to the already-running server
            if (process.env.MOBILE_PIN) {
                try {
                    const pinRes = await fetch(`http://localhost:${HTTP_PORT}/api/internal/set-pin`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pin: process.env.MOBILE_PIN }),
                    });
                    const pinData = await pinRes.json() as { success?: boolean; error?: string };
                    if (pinData.success) {
                        log('🔐', 'PIN authentication synced to running server');
                    } else {
                        log('⚠️', `Failed to sync PIN: ${pinData.error}`);
                    }
                } catch (e) {
                    log('⚠️', `Could not sync PIN to running server: ${(e as Error).message}`);
                }
            }
        } else {
            // Port held by a stale/zombie process — kill it and start fresh
            log('⚠️', `Port ${HTTP_PORT} is occupied by an unresponsive process. Cleaning up...`);
            await new Promise<void>((resolve) => {
                const cmd = platform() === 'win32'
                    ? `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${HTTP_PORT} ^| findstr LISTENING') do taskkill /PID %a /F`
                    : `lsof -ti :${HTTP_PORT} | xargs kill -9`;
                exec(cmd, () => setTimeout(resolve, 1500));
            });
            log('🧹', 'Stale process removed');
        }
    }

    if (!serverRunning) {
        log('🚀', 'Starting HTTP server...');

        // Spawn TypeScript server as detached background process
        const httpServer = spawn('npx', ['tsx', serverEntryPath], {
            cwd: join(__dirname, '..'),
            stdio: 'ignore',
            detached: true,
            windowsHide: true,
            env: { ...process.env }, // Pass all environment variables including MOBILE_PIN
        });
        httpServer.unref();

        // Wait for server to be ready (15s for cold start with Telegram + tunnel)
        const serverReady = await waitForServer(HTTP_PORT, 15000);
        if (serverReady) {
            log('✅', `HTTP server started on port ${HTTP_PORT}`);
        } else {
            log('⚠️', 'HTTP server may still be starting...');
        }
    }

    // ========================================================================
    // Step 2: Find Antigravity
    // ========================================================================
    logSection('🔍 Finding Antigravity');

    const antigravityPath = await findAntigravityPath();

    if (!antigravityPath) {
        log('❌', 'Could not find Antigravity installation!');
        console.log('\nPlease install Antigravity or specify path:');
        console.log('  ANTIGRAVITY_PATH=/path/to/antigravity npx tsx src/launcher.ts\n');
        process.exit(1);
    }

    log('✅', `Found: ${antigravityPath}`);

    // ========================================================================
    // Step 3: Check if Antigravity already running with CDP
    // ========================================================================
    logSection('🔌 Checking CDP');

    const cdpAlreadyRunning = await waitForCDP(CDP_PORT, 2000);

    if (cdpAlreadyRunning) {
        log('✅', `CDP already active on port ${CDP_PORT}`);
    } else {
        // Check if Antigravity is already running (without CDP)
        const antigravityRunning: boolean = await new Promise((resolve) => {
            const cmd = platform() === 'win32'
                ? 'tasklist /FI "IMAGENAME eq Antigravity.exe" /NH'
                : 'pgrep -f Antigravity';
            exec(cmd, (_err, stdout) => {
                resolve(!!stdout && stdout.toLowerCase().includes('antigravity'));
            });
        });

        if (antigravityRunning) {
            log('⚠️', 'Antigravity is running but CDP is not active on port 9222');
            log('📝', 'Closing existing Antigravity and relaunching with CDP...');

            // Kill existing Antigravity to relaunch with CDP flag
            await new Promise<void>((resolve) => {
                const cmd = platform() === 'win32'
                    ? 'taskkill /IM Antigravity.exe /F'
                    : 'pkill -f Antigravity';
                exec(cmd, () => {
                    setTimeout(resolve, 1500); // Wait for process to fully exit
                });
            });
        }

        // ====================================================================
        // Step 4: Launch Antigravity with CDP
        // ====================================================================
        logSection('🚀 Launching Antigravity');

        log('📝', `Starting with --remote-debugging-port=${CDP_PORT}`);

        const antigravity = spawn(antigravityPath, [`--remote-debugging-port=${CDP_PORT}`], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
        });
        antigravity.unref();

        // Wait for CDP to be ready
        log('⏳', 'Waiting for Antigravity to start...');
        const cdpReady = await waitForCDP(CDP_PORT, 15000);

        if (cdpReady) {
            log('✅', 'CDP is now active!');
        } else {
            log('⚠️', 'CDP not responding - Antigravity may need more time');
        }
    }

    // ========================================================================
    // Step 5: Final Status
    // ========================================================================
    logSection('✨ Status Check');

    // Check CDP
    try {
        const res = await fetch(`http://localhost:${CDP_PORT}/json/version`);
        const data = await res.json() as { Browser?: string };
        log('✅', `CDP: ${data.Browser || 'Active'}`);
    } catch {
        log('❌', 'CDP: Not responding');
    }

    // Check HTTP + Tunnel
    let tunnelLine = '';
    try {
        const res = await fetch(`http://localhost:${HTTP_PORT}/api/health`);
        if (res.ok) log('✅', 'HTTP Server: Running');
        else throw new Error();

        // Query admin status (includes tunnel info) — launcher runs from localhost
        try {
            const statusRes = await fetch(`http://localhost:${HTTP_PORT}/api/admin/status`);
            const statusData = await statusRes.json() as {
                tunnelActive?: boolean;
                tunnelUrl?: string | null;
            };
            if (statusData.tunnelActive && statusData.tunnelUrl) {
                log('✅', `Tunnel: ${statusData.tunnelUrl}`);
                tunnelLine = statusData.tunnelUrl;
            } else {
                log('ℹ️ ', 'Tunnel: Not active (enable via Admin Panel)');
            }
        } catch { /* admin status may not be available yet */ }
    } catch {
        log('❌', 'HTTP Server: Not responding');
    }

    // ========================================================================
    // Done!
    // ========================================================================
    const ips = getLocalIPs();
    const mainIP = getBestIP(ips);

    const tunnelBlock = tunnelLine
        ? `║  🚇 Tunnel (Remote Access):                            ║\n║     ${tunnelLine.padEnd(51)}║\n║                                                        ║\n`
        : `║  🚇 Tunnel: Not active                                 ║\n║                                                        ║\n`;

    console.log(`
╔════════════════════════════════════════════════════════╗
║                   🎉 READY TO GO!                      ║
╠════════════════════════════════════════════════════════╣
║                                                        ║
║  📱 Mobile Dashboard:                                  ║
║     http://${mainIP}:${HTTP_PORT}                            ║
║                                                        ║
║  🖥️  Local Access:                                     ║
║     http://localhost:${HTTP_PORT}                             ║
║                                                        ║
║  ⚙️  Admin Panel:                                      ║
║     http://localhost:${HTTP_PORT}/admin                       ║
║                                                        ║
${tunnelBlock}╚════════════════════════════════════════════════════════╝
    `);

    if (ips.length > 1) {
        log('🌐', 'All available IPs:');
        ips.forEach(e => console.log(`     http://${e.address}:${HTTP_PORT}`));
    }

    console.log('\n✅ You can close this window - servers will keep running.\n');

    // Auto-open admin panel in default browser
    const adminUrl = `http://localhost:${HTTP_PORT}/admin`;
    try {
        const openCmd = os === 'win32' ? `start "" "${adminUrl}"`
            : os === 'darwin' ? `open "${adminUrl}"`
                : `xdg-open "${adminUrl}"`;
        exec(openCmd);
        log('🌐', 'Admin panel opened in browser');
    } catch {
        log('📝', `Open admin panel manually: ${adminUrl}`);
    }
}

// ============================================================================
// CLI
// ============================================================================
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Antigravity Mobile Launcher

Usage: npx tsx src/launcher.ts [options]

Options:
  --help, -h    Show this help

Environment Variables:
  ANTIGRAVITY_PATH   Custom path to Antigravity executable
    `);
    process.exit(0);
}

// Custom path from env
if (process.env.ANTIGRAVITY_PATH) {
    const customPath = process.env.ANTIGRAVITY_PATH;
    if (existsSync(customPath)) {
        ANTIGRAVITY_PATHS[platform()] = [customPath];
    }
}

// Run!
main().catch(err => {
    console.error('\n❌ Error:', (err as Error).message);
    process.exit(1);
});
