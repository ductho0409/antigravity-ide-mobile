/**
 * CDP Core — Port management, URL, device state, targets, connection
 *
 * Foundation module that all other CDP modules depend on.
 */
import WebSocket from 'ws';

interface CdpTarget {
    id: string;
    type: string;
    title: string;
    url: string;
    webSocketDebuggerUrl?: string;
    description?: string;
    devtoolsFrontendUrl?: string;
    faviconUrl?: string;
}

interface CdpClient {
    send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    close: () => void;
    ws: WebSocket;
}

interface RetryOptions {
    maxRetries?: number;
    delay?: number;
    label?: string;
}

let cdpPort = 9222;
let activeTargetTabId: string | null = null;
let _cdpConnected = false;

/**
 * Retry helper — retries fn up to maxRetries times with delay between attempts
 */
async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
    const { maxRetries = 3, delay = 2000, label = 'CDP' } = opts;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn();
            if (!_cdpConnected) {
                _cdpConnected = true;
                console.log(`[${label}] Connected`);
            }
            return result;
        } catch (err) {
            if (attempt === maxRetries) {
                if (_cdpConnected) {
                    _cdpConnected = false;
                    console.log(`[${label}] Disconnected — ${(err as Error).message}`);
                }
                throw err;
            }
            console.log(`[${label}] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw new Error('Unreachable');
}

/** Check current CDP connection state */
export function isCdpConnected(): boolean {
    return _cdpConnected;
}

export function getCdpUrl(): string {
    return `http://localhost:${cdpPort}`;
}

/** Set the active CDP device port */
export function setActiveDevice(port: number | string): void {
    cdpPort = parseInt(String(port)) || 9222;
}

/** Get the active CDP device port */
export function getActiveDevice(): number {
    return cdpPort;
}

/** Set the active target tab ID */
export function setActiveTarget(tabId: string | null): void {
    activeTargetTabId = tabId || null;
}

/** Get the active target tab ID */
export function getActiveTarget(): string | null {
    return activeTargetTabId;
}

/** Get list of available CDP targets (pages/tabs) */
export async function getTargets(): Promise<CdpTarget[]> {
    return withRetry(async () => {
        const response = await fetch(`${getCdpUrl()}/json/list`);
        return response.json() as Promise<CdpTarget[]>;
    }, { label: 'CDP:targets' });
}

/** Get CDP version info */
export async function getVersion(): Promise<Record<string, string>> {
    const response = await fetch(`${getCdpUrl()}/json/version`);
    return response.json() as Promise<Record<string, string>>;
}

/**
 * Find the main Antigravity editor page.
 * If an activeTargetTabId is set, prefer that specific target.
 * Otherwise fall back to URL/title heuristics.
 */
export async function findEditorTarget(): Promise<CdpTarget | undefined> {
    const targets = await getTargets();

    // If we have a specific target selected, use it
    if (activeTargetTabId) {
        const selected = targets.find(t => t.id === activeTargetTabId);
        if (selected) return selected;
    }

    // Fallback: Look for the main editor window by URL (vscode-file workbench)
    const editor = targets.find(t =>
        t.type === 'page' &&
        t.url.includes('workbench') &&
        !t.title.includes('Launchpad') &&
        !t.url.includes('devtools')
    );

    if (editor) return editor;

    // Fallback: any page that's NOT Launchpad
    const nonLaunchpad = targets.find(t =>
        t.type === 'page' && !t.title.includes('Launchpad')
    );

    return nonLaunchpad || targets.find(t => t.type === 'page');
}

/** Connect to a CDP target via WebSocket */
export async function connectToTarget(target: CdpTarget): Promise<CdpClient> {
    const wsUrl = target.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('No WebSocket URL for target');

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let messageId = 1;
        const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();

        ws.on('open', () => {
            const client: CdpClient = {
                send: (method: string, params: Record<string, unknown> = {}) => {
                    return new Promise((res, rej) => {
                        const id = messageId++;
                        pending.set(id, { resolve: res, reject: rej });
                        ws.send(JSON.stringify({ id, method, params }));
                    });
                },
                close: () => ws.close(),
                ws
            };
            resolve(client);
        });

        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.id && pending.has(msg.id)) {
                const handler = pending.get(msg.id)!;
                pending.delete(msg.id);
                if (msg.error) handler.reject(new Error(msg.error.message));
                else handler.resolve(msg.result);
            }
        });

        ws.on('error', reject);

        // Reject all pending promises on close — prevents hung requests
        ws.on('close', () => {
            for (const [, p] of pending) {
                p.reject(new Error('WebSocket closed'));
            }
            pending.clear();
        });
    });
}

/** Check if CDP is available */
export async function isAvailable(): Promise<{ available: boolean; browser?: string; error?: string }> {
    try {
        const version = await getVersion();
        return { available: true, browser: version.Browser };
    } catch (e) {
        return { available: false, error: (e as Error).message };
    }
}

/**
 * Wait for CDP to become available (IDE opened/reopened).
 * Polls every `interval` ms, up to `timeout` ms total.
 */
export async function waitForConnection(opts: { timeout?: number; interval?: number } = {}): Promise<{ available: boolean; browser?: string; error?: string }> {
    const { timeout = 30000, interval = 3000 } = opts;
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const status = await isAvailable();
        if (status.available) return status;
        await new Promise(r => setTimeout(r, interval));
    }
    return { available: false, error: 'Timeout waiting for CDP' };
}

/** Type for CDP call function — shared by withContexts/withCDP consumers */
export type CDPCallFn = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * Run a handler with Runtime execution contexts.
 * Connects to the active editor target, enables Runtime, collects contexts,
 * then passes (call, contexts) to the handler for multi-frame evaluation.
 *
 * @param timeout    - timeout per CDP call (ms)
 * @param handler    - receives (call, contexts) to evaluate scripts
 * @param fallback   - value returned on error
 * @param contextDelay - ms to wait for contexts after Runtime.enable (default: 200)
 */
export async function withContexts<T>(
    timeout: number,
    handler: (call: CDPCallFn, contexts: Array<{ id: number }>) => Promise<T>,
    fallback: T,
    contextDelay = 200
): Promise<T> {
    const target = await findEditorTarget();
    if (!target?.webSocketDebuggerUrl) return fallback;

    return new Promise(async (resolve) => {
        const ws = new WebSocket(target.webSocketDebuggerUrl!);
        const contexts: Array<{ id: number }> = [];
        let messageId = 1;
        const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();

        const call: CDPCallFn = (method, params = {}) => new Promise((res, rej) => {
            const id = messageId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('Timeout')); } }, timeout);
        });

        ws.on('message', (msg: Buffer) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.id && pending.has(data.id)) {
                    const h = pending.get(data.id)!;
                    pending.delete(data.id);
                    if (data.error) h.reject(new Error(data.error.message));
                    else h.resolve(data.result);
                } else if (data.method === 'Runtime.executionContextCreated') {
                    contexts.push(data.params.context);
                }
            } catch (_) { }
        });

        ws.on('open', async () => {
            try {
                await call('Runtime.enable', {});
                await new Promise(r => setTimeout(r, contextDelay));
                const result = await handler(call, contexts);
                ws.close();
                resolve(result);
            } catch (_) {
                ws.close();
                resolve(fallback);
            }
        });

        ws.on('error', () => resolve(fallback));
    });
}

/**
 * Run a simple CDP command (no Runtime contexts needed).
 * Connects to the active editor target, provides a call function.
 *
 * @param timeout  - timeout per CDP call (ms)
 * @param handler  - receives call function
 * @param fallback - value returned on error
 */
export async function withCDP<T>(
    timeout: number,
    handler: (call: CDPCallFn) => Promise<T>,
    fallback: T
): Promise<T> {
    const target = await findEditorTarget();
    if (!target?.webSocketDebuggerUrl) return fallback;

    return new Promise(async (resolve) => {
        const ws = new WebSocket(target.webSocketDebuggerUrl!);
        let messageId = 1;
        const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();

        const call: CDPCallFn = (method, params = {}) => new Promise((res, rej) => {
            const id = messageId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('Timeout')); } }, timeout);
        });

        ws.on('message', (msg: Buffer) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.id && pending.has(data.id)) {
                    const h = pending.get(data.id)!;
                    pending.delete(data.id);
                    if (data.error) h.reject(new Error(data.error.message));
                    else h.resolve(data.result);
                }
            } catch (_) { }
        });

        ws.on('open', async () => {
            try {
                const result = await handler(call);
                ws.close();
                resolve(result);
            } catch (_) {
                ws.close();
                resolve(fallback);
            }
        });

        ws.on('error', () => resolve(fallback));
    });
}

// Re-export types for other modules
export type { CdpTarget, CdpClient };
