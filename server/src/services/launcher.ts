/**
 * Launcher - Start HTTP server & Antigravity IDE with CDP
 * 
 * Features:
 * - Finds the Antigravity executable across platforms
 * - Launches with --remote-debugging-port for CDP
 * - Waits for CDP ready before proceeding
 * - Starts the HTTP server
 * - Protocol handling (antigravity://)
 * 
 * 1:1 migration from launcher.mjs
 */

import { spawn, exec } from 'child_process';
import type { ChildProcess } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { platform } from 'os';

// ============================================================================
// Types
// ============================================================================

interface LaunchOptions {
    port?: number;
    cdpPort?: number;
    workspace?: string;
    args?: string[];
    skipIDE?: boolean;
    skipDuplicateCheck?: boolean;
}

interface LaunchResult {
    success: boolean;
    ideProcess?: ChildProcess;
    cdpPort?: number;
    error?: string;
}

interface ProcessCheck {
    running: boolean;
    pid?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CDP_PORT = 9222;

// ============================================================================
// Find Antigravity Executable
// ============================================================================

export function findAntigravityPath(): string | null {
    const os = platform();

    const candidates: string[] = [];

    if (os === 'darwin') {
        candidates.push(
            '/Applications/Antigravity.app/Contents/MacOS/Electron',
            '/Applications/Antigravity.app/Contents/Resources/app/bin/code',
            join(process.env.HOME || '', 'Applications', 'Antigravity.app', 'Contents', 'MacOS', 'Electron'),
        );
    } else if (os === 'win32') {
        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        const localAppData = process.env.LOCALAPPDATA || '';
        candidates.push(
            join(programFiles, 'Antigravity', 'Antigravity.exe'),
            join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
            join(localAppData, 'Antigravity', 'Antigravity.exe'),
        );
    } else {
        // Linux
        candidates.push(
            '/usr/bin/antigravity',
            '/usr/local/bin/antigravity',
            join(process.env.HOME || '', '.local', 'bin', 'antigravity'),
            '/opt/Antigravity/antigravity',
            '/snap/bin/antigravity',
        );
    }

    for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
    }

    return null;
}

/**
 * Try to find antigravity via system PATH
 */
async function findAntigravityInPath(): Promise<string | null> {
    const os = platform();
    const cmd = os === 'win32' ? 'where antigravity' : 'which antigravity';

    return new Promise<string | null>((resolvePromise) => {
        exec(cmd, (err, stdout) => {
            if (!err && stdout.trim()) {
                const path = stdout.trim().split('\n')[0].trim();
                if (existsSync(path)) {
                    resolvePromise(path);
                    return;
                }
            }
            resolvePromise(null);
        });
    });
}

// ============================================================================
// Check if already running
// ============================================================================

async function isAlreadyRunning(cdpPort: number): Promise<ProcessCheck> {
    return new Promise((resolvePromise) => {
        const os = platform();
        const cmd = os === 'win32'
            ? `netstat -ano | findstr :${cdpPort}`
            : `lsof -i :${cdpPort} -t 2>/dev/null`;

        exec(cmd, (err, stdout) => {
            if (!err && stdout.trim()) {
                const pidStr = stdout.trim().split('\n')[0].trim();
                const pid = parseInt(pidStr, 10);
                resolvePromise({ running: true, pid: isNaN(pid) ? undefined : pid });
            } else {
                resolvePromise({ running: false });
            }
        });
    });
}

// ============================================================================
// Wait for CDP to be ready
// ============================================================================

export async function waitForCDP(port: number, maxWaitMs: number = 30000): Promise<boolean> {
    const start = Date.now();
    const pollInterval = 500;

    while (Date.now() - start < maxWaitMs) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
                signal: AbortSignal.timeout(2000)
            });
            if (res.ok) {
                console.log(`✅ CDP ready on port ${port}`);
                return true;
            }
        } catch {
            // Not ready yet
        }
        await new Promise(r => setTimeout(r, pollInterval));
    }

    console.error(`❌ CDP did not respond on port ${port} within ${maxWaitMs / 1000}s`);
    return false;
}

// ============================================================================
// Launch Antigravity IDE
// ============================================================================

export async function launchIDE(options: LaunchOptions = {}): Promise<LaunchResult> {
    const cdpPort = options.cdpPort || DEFAULT_CDP_PORT;

    // Check if already running
    if (!options.skipDuplicateCheck) {
        const check = await isAlreadyRunning(cdpPort);
        if (check.running) {
            console.log(`ℹ️ Antigravity already running on CDP port ${cdpPort} (PID: ${check.pid || 'unknown'})`);
            const cdpReady = await waitForCDP(cdpPort, 5000);
            if (cdpReady) {
                return { success: true, cdpPort };
            }
        }
    }

    // Find executable
    let exePath = findAntigravityPath();
    if (!exePath) {
        exePath = await findAntigravityInPath();
    }
    if (!exePath) {
        return { success: false, error: 'Antigravity executable not found' };
    }

    console.log(`🚀 Launching Antigravity: ${exePath}`);

    // Build args
    const args: string[] = [
        `--remote-debugging-port=${cdpPort}`,
    ];

    if (options.workspace) {
        args.push(options.workspace);
    }

    if (options.args) {
        args.push(...options.args);
    }

    try {
        const ideProcess = spawn(exePath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
        });

        ideProcess.unref();

        ideProcess.stdout?.on('data', (data: Buffer) => {
            const line = data.toString().trim();
            if (line) console.log(`[IDE stdout] ${line}`);
        });

        ideProcess.stderr?.on('data', (data: Buffer) => {
            const line = data.toString().trim();
            if (line && !line.includes('DevTools listening')) {
                console.log(`[IDE stderr] ${line}`);
            }
        });

        ideProcess.on('exit', (code) => {
            console.log(`[IDE] Process exited with code ${code}`);
        });

        // Wait for CDP to be ready
        console.log(`⏳ Waiting for CDP on port ${cdpPort}...`);
        const cdpReady = await waitForCDP(cdpPort);

        if (!cdpReady) {
            return { success: false, error: `CDP not ready after launch (port ${cdpPort})` };
        }

        return { success: true, ideProcess, cdpPort };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

// ============================================================================
// Protocol handler registration
// ============================================================================

export function registerProtocolHandler(): void {
    const os = platform();
    console.log(`ℹ️ Protocol handler registration for ${os} not implemented yet`);
    // Future: register antigravity:// protocol handler
}

// ============================================================================
// Find workspace from recent files
// ============================================================================

export function findRecentWorkspace(): string | null {
    const os = platform();
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';

    let storagePath: string | null = null;

    if (os === 'darwin') {
        storagePath = join(homeDir, 'Library', 'Application Support', 'Antigravity', 'storage.json');
    } else if (os === 'win32') {
        storagePath = join(process.env.APPDATA || '', 'Antigravity', 'storage.json');
    } else {
        storagePath = join(homeDir, '.config', 'Antigravity', 'storage.json');
    }

    if (!storagePath || !existsSync(storagePath)) return null;

    try {
        const data = JSON.parse(readFileSync(storagePath, 'utf-8')) as Record<string, unknown>;
        const recent = (data.openedPathsList as { workspaces3?: string[] })?.workspaces3;
        if (recent && recent.length > 0) {
            return recent[0].replace('file://', '');
        }
    } catch {
        // ignore
    }

    return null;
}
