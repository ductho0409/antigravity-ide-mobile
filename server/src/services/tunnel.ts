/**
 * Tunnel Manager - Cloudflare tunnel for remote access
 * 
 * Features:
 * - Quick tunnel (random URL, no auth needed)
 * - Named tunnel (custom domain, requires cloudflared login)
 * - Auto-start from config
 * - Status tracking + stop/restart
 * - Multi-instance support (dashboard + preview)
 * 
 * 1:1 migration from tunnel.mjs
 */

import { spawn, exec } from 'child_process';
import type { ChildProcess } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const PID_FILE = join(PROJECT_ROOT, 'data', '.tunnel-pids.json');

// ============================================================================
// Types
// ============================================================================

type TunnelMode = 'quick' | 'named';
type TunnelStatus = 'stopped' | 'starting' | 'active' | 'error';
type TunnelId = string;

interface TunnelState {
    mode: TunnelMode | null;
    status: TunnelStatus;
    url: string | null;
    error: string | null;
    pid: number | null;
    startedAt: number | null;
}

interface TunnelInstance {
    process: ChildProcess | null;
    state: TunnelState;
}

interface TunnelStartResult {
    success: boolean;
    url?: string;
    error?: string;
}

interface TunnelStopResult {
    success: boolean;
}

interface DetectResult {
    available: boolean;
    hostname?: string;
    tunnelId?: string;
}

interface PersistedTunnelState {
    wasActive: boolean;
    mode: TunnelMode;
    port: number;
    tunnelName?: string;
    hostname?: string;
    timestamp: number;
}

// ============================================================================
// State
// ============================================================================

const instances = new Map<string, TunnelInstance>();

function getInstance(id: string = 'dashboard'): TunnelInstance {
    if (!instances.has(id)) {
        instances.set(id, {
            process: null,
            state: { mode: null, status: 'stopped', url: null, error: null, pid: null, startedAt: null }
        });
    }
    return instances.get(id)!;
}

function getTunnelStateFile(tunnelId: string = 'dashboard'): string {
    const suffix = tunnelId === 'dashboard' ? '' : `-${tunnelId.replace(/:/g, '-')}`;
    return join(PROJECT_ROOT, 'data', `.tunnel-state${suffix}.json`);
}


// ============================================================================
// PID File Persistence (surgical kill of orphaned processes)
// ============================================================================

function saveManagedPid(tunnelId: string, pid: number): void {
    try {
        const pids = loadManagedPids();
        pids[tunnelId] = pid;
        writeFileSync(PID_FILE, JSON.stringify(pids, null, 2));
    } catch { /* ignore */ }
}

function removeManagedPid(tunnelId: string): void {
    try {
        const pids = loadManagedPids();
        delete pids[tunnelId];
        writeFileSync(PID_FILE, JSON.stringify(pids, null, 2));
    } catch { /* ignore */ }
}

function loadManagedPids(): Record<string, number> {
    try {
        if (existsSync(PID_FILE)) {
            return JSON.parse(readFileSync(PID_FILE, 'utf-8'));
        }
    } catch { /* ignore */ }
    return {};
}

// ============================================================================
// Cloudflared availability check
// ============================================================================

async function isCloudflaredInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
        exec('cloudflared --version', (err, stdout) => {
            resolve(!err && stdout.includes('cloudflared'));
        });
    });
}

/**
 * Kill orphaned cloudflared processes from previous server runs
 */
export function killOrphanedCloudflared(): Promise<void> {
    return new Promise((resolve) => {
        // First: surgical kill via PID file
        const pids = loadManagedPids();
        const hasPids = Object.keys(pids).length > 0;

        for (const [id, pid] of Object.entries(pids)) {
            try {
                process.kill(pid);
            } catch { /* already dead */ }
            removeManagedPid(id);
        }

        // Clean stale state files for all known instances
        for (const id of instances.keys()) {
            try {
                const stateFile = getTunnelStateFile(id);
                if (existsSync(stateFile)) {
                    const raw = readFileSync(stateFile, 'utf-8');
                    const state = JSON.parse(raw);
                    if (Date.now() - state.timestamp > 5 * 60 * 1000) {
                        unlinkSync(stateFile);
                    }
                }
            } catch { /* ignore */ }
        }

        // Fallback: pkill only if PID file was empty/missing (crash recovery)
        if (!hasPids) {
            const cmd = process.platform === 'win32'
                ? 'taskkill /F /IM cloudflared.exe 2>nul'
                : 'pkill -f "cloudflared tunnel" 2>/dev/null';
            exec(cmd, () => {
                setTimeout(resolve, 3000);
            });
        } else {
            // PIDs were killed surgically, brief wait for process cleanup
            setTimeout(resolve, 1000);
        }
    });
}

// ============================================================================
// State Persistence (survives tsx watch restarts)
// ============================================================================

/**
 * Save tunnel state to disk so next server instance can auto-restart
 */
function savePersistentState(mode: TunnelMode, port: number, tunnelName?: string, hostname?: string, tunnelId: string = 'dashboard'): void {
    try {
        const state: PersistedTunnelState = {
            wasActive: true,
            mode,
            port,
            tunnelName,
            hostname,
            timestamp: Date.now()
        };
        writeFileSync(getTunnelStateFile(tunnelId), JSON.stringify(state, null, 2));
    } catch { /* ignore write errors */ }
}

/**
 * Clear persisted tunnel state (on intentional stop)
 */
function clearPersistentState(tunnelId: string = 'dashboard'): void {
    try {
        const stateFile = getTunnelStateFile(tunnelId);
        if (existsSync(stateFile)) unlinkSync(stateFile);
    } catch { /* ignore */ }
}

/**
 * Load persisted tunnel state from previous server run.
 * Returns null if no state or if state is stale (> 5 minutes old).
 */
export function loadPersistentState(tunnelId: string = 'dashboard'): PersistedTunnelState | null {
    try {
        const stateFile = getTunnelStateFile(tunnelId);
        if (!existsSync(stateFile)) return null;
        const raw = readFileSync(stateFile, 'utf-8');
        const state = JSON.parse(raw) as PersistedTunnelState;
        // Reject stale state (> 5 min old — not a tsx watch restart)
        if (Date.now() - state.timestamp > 5 * 60 * 1000) {
            clearPersistentState(tunnelId);
            return null;
        }
        return state;
    } catch {
        return null;
    }
}

// ============================================================================
// Quick Tunnel (random URL, no auth)
// ============================================================================

async function startQuickTunnel(port: number, tunnelId: string = 'dashboard'): Promise<TunnelStartResult> {
    const inst = getInstance(tunnelId);
    return new Promise((resolve) => {
        // Use --config /dev/null to prevent loading ~/.cloudflared/config.yml
        // which may contain named tunnel ingress rules that return 404
        const noConfigFlag = process.platform === 'win32' ? 'NUL' : '/dev/null';
        const args = ['tunnel', '--config', noConfigFlag, '--url', `http://localhost:${port}`];

        inst.process = spawn('cloudflared', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });
        if (inst.process.pid) saveManagedPid(tunnelId, inst.process.pid);

        let resolved = false;
        let output = '';

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                resolve({
                    success: false,
                    error: 'Tunnel start timed out (30s). Output: ' + output.slice(-200)
                });
            }
        }, 30000);

        inst.process.stderr?.on('data', (data: Buffer) => {
            const chunk = data.toString();
            output += chunk;

            // Look for the tunnel URL in stderr (cloudflared logs to stderr)
            const urlMatch = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (urlMatch && !resolved) {
                resolved = true;
                clearTimeout(timeout);
                inst.state = {
                    mode: 'quick',
                    status: 'active',
                    url: urlMatch[0],
                    error: null,
                    pid: inst.process?.pid ?? null,
                    startedAt: Date.now()
                };
                savePersistentState('quick', port, undefined, undefined, tunnelId);
                resolve({ success: true, url: urlMatch[0] });
            }
        });

        inst.process.stdout?.on('data', (data: Buffer) => {
            const chunk = data.toString();
            output += chunk;

            const urlMatch = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (urlMatch && !resolved) {
                resolved = true;
                clearTimeout(timeout);
                inst.state = {
                    mode: 'quick',
                    status: 'active',
                    url: urlMatch[0],
                    error: null,
                    pid: inst.process?.pid ?? null,
                    startedAt: Date.now()
                };
                savePersistentState('quick', port, undefined, undefined, tunnelId);
                resolve({ success: true, url: urlMatch[0] });
            }
        });

        inst.process.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                inst.state.status = 'error';
                inst.state.error = err.message;
                resolve({ success: false, error: err.message });
            }
        });

        inst.process.on('exit', (code) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve({ success: false, error: `Process exited with code ${code}` });
            }
            inst.state.status = 'stopped';
            inst.state.url = null;
            inst.state.pid = null;
            inst.process = null;
            removeManagedPid(tunnelId);
        });
    });
}

// ============================================================================
// Named Tunnel (custom domain, requires auth)
// ============================================================================

async function startNamedTunnel(
    tunnelName: string,
    hostname: string,
    port: number,
    tunnelId: string = 'dashboard'
): Promise<TunnelStartResult> {
    const inst = getInstance(tunnelId);
    return new Promise((resolve) => {
        const args = [
            'tunnel', 'run',
            '--url', `http://localhost:${port}`,
            tunnelName
        ];

        inst.process = spawn('cloudflared', args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        if (inst.process.pid) saveManagedPid(tunnelId, inst.process.pid);

        let resolved = false;
        let output = '';

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                // For named tunnels, connection might take longer
                // Check if process is still running
                if (inst.process && !inst.process.killed) {
                    inst.state = {
                        mode: 'named',
                        status: 'active',
                        url: `https://${hostname}`,
                        error: null,
                        pid: inst.process.pid ?? null,
                        startedAt: Date.now()
                    };
                    resolve({ success: true, url: `https://${hostname}` });
                } else {
                    resolve({
                        success: false,
                        error: 'Tunnel start timed out. Output: ' + output.slice(-200)
                    });
                }
            }
        }, 15000);

        inst.process.stderr?.on('data', (data: Buffer) => {
            const chunk = data.toString();
            output += chunk;

            // Named tunnels log "Registered tunnel connection" when active
            if (chunk.includes('Registered tunnel connection') && !resolved) {
                resolved = true;
                clearTimeout(timeout);
                inst.state = {
                    mode: 'named',
                    status: 'active',
                    url: `https://${hostname}`,
                    error: null,
                    pid: inst.process?.pid ?? null,
                    startedAt: Date.now()
                };
                savePersistentState('named', port, tunnelName, hostname, tunnelId);
                resolve({ success: true, url: `https://${hostname}` });
            }
        });

        inst.process.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                inst.state.status = 'error';
                inst.state.error = err.message;
                resolve({ success: false, error: err.message });
            }
        });

        inst.process.on('exit', (code) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve({ success: false, error: `Process exited with code ${code}` });
            }
            inst.state.status = 'stopped';
            inst.state.url = null;
            inst.state.pid = null;
            inst.process = null;
            removeManagedPid(tunnelId);
        });
    });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start a tunnel
 */
export async function startTunnel(
    mode: TunnelMode,
    port: number,
    tunnelName?: string,
    hostname?: string,
    tunnelId: string = 'dashboard'
): Promise<TunnelStartResult> {
    const inst = getInstance(tunnelId);

    // Stop existing tunnel first
    if (inst.process) {
        await stopTunnel(tunnelId);
    }

    // Only kill orphaned cloudflared if NO instances are active
    if (!Array.from(instances.values()).some(i => i.process !== null)) {
        await killOrphanedCloudflared();
    }

    // Check if cloudflared is installed
    const installed = await isCloudflaredInstalled();
    if (!installed) {
        return {
            success: false,
            error: 'cloudflared is not installed. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
        };
    }

    inst.state = {
        mode,
        status: 'starting',
        url: null,
        error: null,
        pid: null,
        startedAt: null
    };

    console.log(`🚇 Starting ${mode} tunnel on port ${port}...`);

    if (mode === 'named' && tunnelName && hostname) {
        return startNamedTunnel(tunnelName, hostname, port, tunnelId);
    }
    return startQuickTunnel(port, tunnelId);
}

/**
 * Stop the active tunnel
 */
export async function stopTunnel(tunnelId: string = 'dashboard'): Promise<TunnelStopResult> {
    const inst = getInstance(tunnelId);
    if (!inst.process) {
        return { success: true };
    }

    return new Promise((resolve) => {
        const proc = inst.process;
        if (!proc) {
            resolve({ success: true });
            return;
        }

        proc.on('exit', () => {
            inst.process = null;
            inst.state = {
                mode: null,
                status: 'stopped',
                url: null,
                error: null,
                pid: null,
                startedAt: null
            };
            clearPersistentState(tunnelId);
            console.log('🚇 Tunnel stopped');
            resolve({ success: true });
        });

        // Try graceful kill first
        proc.kill('SIGTERM');

        // Force kill after 3 seconds
        setTimeout(() => {
            try {
                proc.kill('SIGKILL');
            } catch {
                // already dead
            }
            resolve({ success: true });
        }, 3000);
    });
}

/**
 * Get tunnel status
 */
export function getStatus(tunnelId: string = 'dashboard'): TunnelState {
    return { ...getInstance(tunnelId).state };
}

/**
 * Check if tunnel is active
 */
export function isActive(tunnelId: string = 'dashboard'): boolean {
    const inst = getInstance(tunnelId);
    return inst.state.status === 'active' && inst.process !== null;
}

/**
 * Detect named tunnel info from ~/.cloudflared/config.yml
 */
export function detectNamedTunnel(): DetectResult {
    const configPath = join(homedir(), '.cloudflared', 'config.yml');
    if (!existsSync(configPath)) {
        return { available: false };
    }

    try {
        const content = readFileSync(configPath, 'utf-8');

        // Parse tunnel ID
        const tunnelMatch = content.match(/^tunnel:\s*(.+)$/m);
        const tunnelId = tunnelMatch?.[1]?.trim();

        // Parse hostname from ingress rules
        const hostnameMatch = content.match(/hostname:\s*(.+)/i);
        const hostname = hostnameMatch?.[1]?.trim();

        if (tunnelId) {
            return { available: true, tunnelId, hostname };
        }
        return { available: false };
    } catch {
        return { available: false };
    }
}

/**
 * Get all active preview tunnels
 */
export function getActivePreviewTunnels(): Array<{ tunnelId: string; url: string | null; status: string; port: number; startedAt: number | null }> {
    const result: Array<{ tunnelId: string; url: string | null; status: string; port: number; startedAt: number | null }> = [];
    for (const [id, inst] of instances) {
        if (id.startsWith('preview:')) {
            const port = parseInt(id.split(':')[1], 10);
            result.push({
                tunnelId: id,
                url: inst.state.url,
                status: inst.state.status,
                port,
                startedAt: inst.state.startedAt
            });
        }
    }
    return result;
}

/**
 * Stop all active preview tunnels
 */
export async function stopAllPreviewTunnels(): Promise<void> {
    const previewKeys = Array.from(instances.keys()).filter(k => k.startsWith('preview:'));
    await Promise.all(previewKeys.map(k => stopTunnel(k)));
}
