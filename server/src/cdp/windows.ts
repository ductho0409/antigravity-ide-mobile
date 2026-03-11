/**
 * CDP Windows — Multi-window discovery, switch, launch, workspaces
 */
import { getCdpUrl, setActiveDevice, setActiveTarget } from './core.js';

// ============================================================================
// Multi-Window Management
// ============================================================================

/** Ports to scan for Antigravity CDP endpoints */
const CDP_SCAN_PORTS = [9222, 9223, 9224, 9225, 9226, 7800, 7801, 7802];

/** Titles to exclude (not real editor windows) */
const EXCLUDED_TITLES = ['settings', 'launchpad', 'extensions', 'welcome', 'keyboard shortcuts', 'release notes'];

interface DiscoveredTarget {
    id: string;
    port: number;
    title: string;
    url: string;
    wsUrl: string;
    type: string;
}

interface Workspace {
    name: string;
    path: string;
    uri: string;
    lastUsed: number;
}

/**
 * Discover ALL available CDP targets across multiple ports.
 * Returns workbench windows only (excludes Settings, Launchpad, etc.)
 */
export async function discoverAllTargets(): Promise<DiscoveredTarget[]> {
    const allTargets: DiscoveredTarget[] = [];

    for (const port of CDP_SCAN_PORTS) {
        try {
            const response = await fetch(`http://localhost:${port}/json/list`, {
                signal: AbortSignal.timeout(2000)
            });
            const list = await response.json() as Array<Record<string, string>>;

            for (const t of list) {
                if (!t.webSocketDebuggerUrl) continue;

                const isWorkbench = t.url?.includes('workbench.html') && !t.url?.includes('jetski');
                const isAntigravityPage = t.type === 'page' && t.title?.includes('Antigravity');

                if (!isWorkbench && !isAntigravityPage) continue;
                if (t.url?.includes('localhost:3333')) continue;

                const titleLower = (t.title || '').toLowerCase();
                if (EXCLUDED_TITLES.some(ex => titleLower.includes(ex))) continue;

                allTargets.push({
                    id: `${port}:${t.id}`,
                    port,
                    title: t.title || 'Untitled',
                    url: t.url || '',
                    wsUrl: t.webSocketDebuggerUrl,
                    type: 'workbench'
                });
            }
        } catch (_) {
            // Port not responding, skip
        }
    }
    return allTargets;
}

/**
 * Switch active device to a specific target by its composite ID (port:id)
 */
export function switchToTarget(targetId: string, targets: DiscoveredTarget[]): { success: boolean; target?: { id: string; title: string; port: number }; error?: string } {
    const target = targets.find(t => t.id === targetId);
    if (!target) {
        return { success: false, error: 'Target not found. Refresh targets list.' };
    }
    const [portStr, ...tabParts] = targetId.split(':');
    const tabId = tabParts.join(':');

    setActiveDevice(target.port);
    setActiveTarget(tabId);
    console.log(`🔀 Switched to target: port=${target.port}, tabId=${tabId}, title=${target.title}`);
    return { success: true, target: { id: target.id, title: target.title, port: target.port } };
}

/**
 * Close a specific window/target by its composite ID (port:tabId).
 * Uses CDP HTTP endpoint /json/close/{tabId}
 */
export async function closeWindow(targetId: string): Promise<{ success: boolean; error?: string }> {
    const colonIdx = targetId.indexOf(':');
    if (colonIdx === -1) {
        return { success: false, error: 'Invalid target ID format' };
    }
    const port = parseInt(targetId.substring(0, colonIdx), 10);
    const tabId = targetId.substring(colonIdx + 1);

    if (!port || !tabId) {
        return { success: false, error: 'Invalid target ID — missing port or tabId' };
    }

    try {
        const res = await fetch(`http://127.0.0.1:${port}/json/close/${tabId}`, {
            signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
            console.log(`🗑️ Closed window: port=${port}, tabId=${tabId}`);
            return { success: true };
        }
        const text = await res.text().catch(() => '');
        return { success: false, error: `CDP close failed (${res.status}): ${text}` };
    } catch (e) {
        return { success: false, error: `Close failed: ${(e as Error).message}` };
    }
}

/**
 * Launch a new Antigravity window.
 */
export async function launchNewWindow(folder?: string): Promise<{ success: boolean; port?: number; targetsBefore?: number; targetsAfter?: number; note?: string; error?: string }> {
    const { spawn, exec } = await import('child_process');
    const { existsSync } = await import('fs');
    const os = await import('os');
    const path = await import('path');

    const platform = os.platform();
    const home = os.homedir();

    // Find active CDP port
    let activePort = 9222;
    for (const port of CDP_SCAN_PORTS) {
        try {
            const check = await fetch(`http://localhost:${port}/json/version`, {
                signal: AbortSignal.timeout(1000)
            });
            if (check.ok) { activePort = port; break; }
        } catch { /* port not reachable */ }
    }

    // Count targets before
    let targetsBefore = 0;
    try {
        const res = await fetch(`http://localhost:${activePort}/json/list`, {
            signal: AbortSignal.timeout(2000)
        });
        if (res.ok) {
            const targets = await res.json() as unknown[];
            targetsBefore = targets.length;
        }
    } catch (_) {
        return { success: false, error: 'No running Antigravity found. Start Antigravity first.' };
    }

    // Find the antigravity CLI
    const findCLI = async (): Promise<string | null> => {
        const cliPaths = platform === 'darwin' ? [
            path.join(home, '.antigravity', 'antigravity', 'bin', 'antigravity'),
            '/usr/local/bin/antigravity',
        ] : platform === 'win32' ? [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'bin', 'antigravity.cmd'),
        ] : [
            '/usr/bin/antigravity',
            '/usr/local/bin/antigravity',
            path.join(home, '.local', 'bin', 'antigravity'),
        ];

        for (const p of cliPaths) {
            if (p && existsSync(p)) return p;
        }

        return new Promise((resolve) => {
            const cmd = platform === 'win32' ? 'where antigravity' : 'which antigravity';
            exec(cmd, (err, stdout) => {
                const found = stdout?.split('\n')[0]?.trim();
                resolve(found ? found : null);
            });
        });
    };

    const cliPath = await findCLI();
    if (!cliPath) {
        return { success: false, error: 'Could not find antigravity CLI. Is it installed?' };
    }

    // Open new window
    const args = ['-n'];
    if (folder) {
        args.push(folder);
    }
    console.log(`🚀 Opening new window: ${cliPath} ${args.join(' ')}`);

    try {
        const subprocess = spawn(cliPath, args, {
            detached: true,
            stdio: 'ignore',
            shell: platform === 'win32'
        });
        subprocess.unref();

        console.log('⏳ Waiting for new window to appear...');

        let targetsAfter = targetsBefore;
        for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
                const res = await fetch(`http://localhost:${activePort}/json/list`, {
                    signal: AbortSignal.timeout(2000)
                });
                if (res.ok) {
                    const targets = await res.json() as unknown[];
                    targetsAfter = targets.length;
                    if (targetsAfter > targetsBefore) {
                        break;
                    }
                }
            } catch (_) {
                console.log(`  Attempt ${attempt + 1}/6: checking...`);
            }
        }

        if (targetsAfter > targetsBefore) {
            console.log(`✅ New window opened! Targets: ${targetsBefore} → ${targetsAfter}`);
            return { success: true, port: activePort, targetsBefore, targetsAfter };
        } else {
            console.log(`⚠️ Window may have opened but target count unchanged (${targetsAfter})`);
            return {
                success: true, port: activePort, targetsBefore, targetsAfter,
                note: 'Window opened but may take longer to appear. Try refreshing windows list in ~10s.'
            };
        }

    } catch (e) {
        return { success: false, error: `Failed to run ${cliPath} -n: ${(e as Error).message}` };
    }
}

/**
 * Get recent workspaces from Antigravity's workspaceStorage.
 */
export async function getRecentWorkspaces(): Promise<{ workspaces: Workspace[] }> {
    const { readFileSync, readdirSync, statSync, existsSync } = await import('fs');
    const os = await import('os');
    const path = await import('path');

    const platform = os.platform();
    const home = os.homedir();

    const storageDirs: Record<string, string> = {
        darwin: path.join(home, 'Library', 'Application Support', 'Antigravity', 'User', 'workspaceStorage'),
        win32: path.join(process.env.APPDATA || '', 'Antigravity', 'User', 'workspaceStorage'),
        linux: path.join(home, '.config', 'Antigravity', 'User', 'workspaceStorage'),
    };

    const storageDir = storageDirs[platform];
    if (!storageDir || !existsSync(storageDir)) {
        return { workspaces: [] };
    }

    const workspaces: Workspace[] = [];
    const entries = readdirSync(storageDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const wsFile = path.join(storageDir, entry.name, 'workspace.json');
        if (!existsSync(wsFile)) continue;

        try {
            const data = JSON.parse(readFileSync(wsFile, 'utf-8'));
            const folderUri = data.folder as string;
            if (!folderUri) continue;

            const folderPath = folderUri.replace('file://', '');
            const folderName = path.basename(folderPath);
            const stat = statSync(wsFile);

            workspaces.push({
                name: folderName,
                path: folderPath,
                uri: folderUri,
                lastUsed: Math.floor(stat.mtimeMs),
            });
        } catch (_) {
            // Skip corrupted workspace.json
        }
    }

    workspaces.sort((a, b) => b.lastUsed - a.lastUsed);

    const filtered = workspaces
        .filter(ws => !ws.path.includes('.gemini/antigravity/playground'))
        .slice(0, 20);

    return { workspaces: filtered };
}
