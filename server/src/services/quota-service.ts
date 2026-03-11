/**
 * Quota Service - Fetches model quota data from Antigravity
 * 
 * Finds the Antigravity language server process, extracts port and CSRF token
 * from command line, then calls GetUserStatus API to get quota data.
 * 
 * 1:1 migration from quota-service.mjs
 */

import https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

interface LanguageServerConnection {
    port: number;
    token: string;
    pid: number;
}

interface ModelQuota {
    id: string;
    name: string;
    remaining: number;
    limit: number;
    remainingPercent: number;
    resetAt: number | null;
    resetIn: string | null;
    status: 'healthy' | 'warning' | 'danger' | 'exhausted';
}

interface QuotaResult {
    available: boolean;
    models: ModelQuota[];
    error?: string;
    fetchedAt?: string;
}

// ============================================================================
// Constants
// ============================================================================

const GET_USER_STATUS_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';

const THRESHOLDS = {
    WARNING: 30,
    CRITICAL: 10,
};

const MODEL_NAMES: Record<string, string> = {
    'MODEL_PLACEHOLDER_M12': 'Claude Opus 4.6',
    'MODEL_CLAUDE_4_5_SONNET': 'Claude Sonnet 4.6',
    'MODEL_CLAUDE_4_5_SONNET_THINKING': 'Claude Sonnet 4.6 Thinking',
    'MODEL_PLACEHOLDER_M18': 'Gemini 3 Flash',
    'MODEL_PLACEHOLDER_M7': 'Gemini 3.1 Pro High',
    'MODEL_PLACEHOLDER_M8': 'Gemini 3.1 Pro Low',
    'MODEL_PLACEHOLDER_M9': 'Gemini 3.1 Pro Image',
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 'GPT-OSS 120B',
};

// ============================================================================
// State
// ============================================================================

let cachedQuota: QuotaResult | null = null;
let lastFetch = 0;
const CACHE_TTL = 15000; // 15 seconds

let cachedConnection: LanguageServerConnection | null = null;
let lastConnectionCheck = 0;
const CONNECTION_CACHE_TTL = 60000; // 1 minute

// ============================================================================
// Process Discovery
// ============================================================================

/**
 * Scan running processes to find Antigravity language server
 * and extract port + CSRF token from command line
 */
async function findLanguageServer(): Promise<LanguageServerConnection | null> {
    // Check cache
    if (cachedConnection && Date.now() - lastConnectionCheck < CONNECTION_CACHE_TTL) {
        return cachedConnection;
    }

    try {
        const isWin = process.platform === 'win32';
        let stdout = '';

        if (isWin) {
            const command = `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'csrf_token' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json"`;
            const result = await execAsync(command, { timeout: 15000, maxBuffer: 1024 * 1024 });
            stdout = result.stdout;
        } else {
            const command = `ps -A -o pid,command | grep '[c]srf_token'`;
            try {
                const result = await execAsync(command, { timeout: 15000, maxBuffer: 1024 * 1024 });
                stdout = result.stdout;
            } catch {
                stdout = '';
            }
        }

        if (!stdout || stdout.trim().length === 0) {
            console.log('[QuotaService] No language_server process found');
            return null;
        }

        // Parse output
        interface ProcessInfo { ProcessId: number; CommandLine: string }
        let processes: ProcessInfo[] = [];

        if (isWin) {
            try {
                const trimmed = stdout.trim();
                const jsonStart = trimmed.indexOf('[') >= 0 ? trimmed.indexOf('[') : trimmed.indexOf('{');
                const jsonStr = trimmed.substring(jsonStart);
                const parsed = JSON.parse(jsonStr) as ProcessInfo | ProcessInfo[];
                processes = Array.isArray(parsed) ? parsed : [parsed];
            } catch (e) {
                console.log('[QuotaService] Failed to parse Windows process list:', (e as Error).message);
                return null;
            }
        } else {
            const lines = stdout.trim().split('\n');
            for (const line of lines) {
                const match = line.trim().match(/^(\d+)\s+(.+)$/);
                if (match) {
                    processes.push({
                        ProcessId: parseInt(match[1], 10),
                        CommandLine: match[2],
                    });
                }
            }
        }

        // Find Antigravity process (has --app_data_dir antigravity)
        for (const proc of processes) {
            const cmdLine = proc.CommandLine || '';

            if (!cmdLine.includes('--extension_server_port') || !cmdLine.includes('--csrf_token')) {
                continue;
            }
            if (!/--app_data_dir\s+antigravity\b/i.test(cmdLine)) {
                continue;
            }

            // Extract CSRF token
            const tokenMatch = cmdLine.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);
            if (!tokenMatch) {
                continue;
            }

            const token = tokenMatch[1];
            const pid = proc.ProcessId;

            // Find listening ports for this process
            const ports = await getProcessListeningPorts(pid);
            console.log(`[QuotaService] Found process ${pid} with ${ports.length} listening ports: ${ports.join(', ')}`);

            // Test each port to find the API port
            for (const port of ports) {
                const works = await testApiPort(port, token);
                if (works) {
                    const connection: LanguageServerConnection = { port, token, pid };
                    cachedConnection = connection;
                    lastConnectionCheck = Date.now();
                    console.log(`[QuotaService] Found working API on port ${port}`);
                    return connection;
                }
            }
        }

        console.log('[QuotaService] No valid Antigravity process found');
        return null;

    } catch (e) {
        console.error('[QuotaService] Error scanning processes:', (e as Error).message);
        return null;
    }
}

/**
 * Get listening ports for a process
 */
async function getProcessListeningPorts(pid: number): Promise<number[]> {
    try {
        const isWin = process.platform === 'win32';
        let stdout = '';

        if (isWin) {
            const command = `powershell -NoProfile -NonInteractive -Command "$ports = Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort; if ($ports) { $ports | Sort-Object -Unique }"`;
            const result = await execAsync(command, { timeout: 5000 });
            stdout = result.stdout;
        } else {
            const command = `lsof -a -p ${pid} -iTCP -sTCP:LISTEN -P -n`;
            try {
                const result = await execAsync(command, { timeout: 5000 });
                stdout = result.stdout;
            } catch {
                stdout = '';
            }
        }

        const ports: number[] = [];
        if (isWin) {
            const matches = stdout.match(/\b\d{1,5}\b/g) || [];
            for (const m of matches) {
                const p = parseInt(m, 10);
                if (p > 0 && p <= 65535) ports.push(p);
            }
        } else {
            const matches = [...stdout.matchAll(/:(\d+)\s+\(LISTEN\)/g)];
            for (const m of matches) {
                const p = parseInt(m[1], 10);
                if (p > 0 && p <= 65535) ports.push(p);
            }
        }

        // Remove duplicates and sort descending (try higher ports first)
        return [...new Set(ports)].sort((a, b) => b - a);
    } catch (e) {
        console.log('[QuotaService] Failed to get listening ports:', (e as Error).message);
        return [];
    }
}

/**
 * Test if a port responds to the API
 */
async function testApiPort(port: number, token: string): Promise<boolean> {
    return new Promise((resolve) => {
        const data = JSON.stringify({ metadata: { ideName: 'antigravity' } });

        const options = {
            hostname: '127.0.0.1',
            port,
            path: GET_USER_STATUS_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'Connect-Protocol-Version': '1',
                'X-Codeium-Csrf-Token': token,
            },
            rejectUnauthorized: false,
            timeout: 3000,
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => body += chunk);
            res.on('end', () => {
                resolve(res.statusCode === 200 || body.includes('"user_status"'));
            });
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.write(data);
        req.end();
    });
}

/**
 * Make API request to the language server
 */
function apiRequest(port: number, token: string, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);

        const options = {
            hostname: '127.0.0.1',
            port,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'Connect-Protocol-Version': '1',
                'X-Codeium-Csrf-Token': token,
            },
            rejectUnauthorized: false,
            timeout: 10000,
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk: Buffer) => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${responseData.substring(0, 200)}`));
                    return;
                }
                try {
                    resolve(JSON.parse(responseData) as Record<string, unknown>);
                } catch (e) {
                    reject(new Error(`Failed to parse response: ${(e as Error).message}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
        req.write(data);
        req.end();
    });
}

// ============================================================================
// Quota Parsing
// ============================================================================

function getStatus(remainingPercent: number): 'healthy' | 'warning' | 'danger' | 'exhausted' {
    if (remainingPercent <= 0) return 'exhausted';
    if (remainingPercent <= THRESHOLDS.CRITICAL) return 'danger';
    if (remainingPercent <= THRESHOLDS.WARNING) return 'warning';
    return 'healthy';
}

function formatResetTime(resetAtMs: string | number | null): string | null {
    if (!resetAtMs) return null;

    const now = Date.now();
    const resetAt = typeof resetAtMs === 'string' ? parseInt(resetAtMs, 10) : resetAtMs;
    const diffMs = resetAt - now;

    if (diffMs <= 0) return 'Now';

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function getDisplayName(modelId: string): string {
    return MODEL_NAMES[modelId] || modelId?.replace('MODEL_', '').replace(/_/g, ' ') || 'Unknown';
}

/**
 * Parse the API response to extract model quota
 */
function parseQuotaResponse(response: Record<string, unknown>): ModelQuota[] {
    const models: ModelQuota[] = [];

    // The quota data is in userStatus.cascadeModelConfigData.clientModelConfigs
    const userStatus = response?.userStatus as Record<string, unknown> | undefined;
    const cascadeData = userStatus?.cascadeModelConfigData as Record<string, unknown> | undefined;
    const clientConfigs = (cascadeData?.clientModelConfigs || []) as Record<string, unknown>[];

    for (const config of clientConfigs) {
        const quotaInfo = (config.quotaInfo || {}) as Record<string, unknown>;
        // remainingFraction is 0-1, convert to percentage
        const remainingFraction = (quotaInfo.remainingFraction as number) ?? 1;
        const remainingPercent = Math.round(remainingFraction * 100);

        // Get model identifier
        const modelOrAlias = config.modelOrAlias as Record<string, unknown> | string | undefined;
        const modelId = typeof modelOrAlias === 'object' && modelOrAlias !== null
            ? (modelOrAlias.model as string) || 'unknown'
            : (typeof modelOrAlias === 'string' ? modelOrAlias : 'unknown');
        const label = (config.label as string) || getDisplayName(modelId);

        // Parse reset time
        const rawResetAt = (quotaInfo.resetAt || quotaInfo.resetTime || quotaInfo.expiresAt || null) as string | number | null;
        const resetAt = rawResetAt
            ? (typeof rawResetAt === 'string' && rawResetAt.length > 13
                ? new Date(rawResetAt).getTime()
                : parseInt(String(rawResetAt), 10))
            : null;

        models.push({
            id: modelId,
            name: label,
            remaining: remainingPercent,
            limit: 100,
            remainingPercent,
            resetAt,
            resetIn: formatResetTime(resetAt),
            status: getStatus(remainingPercent),
        });
    }

    return models;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch quota data from Antigravity (with caching)
 */
export async function getQuota(): Promise<QuotaResult> {
    // Check cache
    if (cachedQuota && Date.now() - lastFetch < CACHE_TTL) {
        return cachedQuota;
    }

    try {
        const connection = await findLanguageServer();

        if (!connection) {
            return {
                available: false,
                error: 'Antigravity language server not found. Make sure Antigravity is running.',
                models: [],
            };
        }

        const response = await apiRequest(
            connection.port,
            connection.token,
            GET_USER_STATUS_PATH,
            {
                metadata: {
                    ideName: 'antigravity',
                    extensionName: 'antigravity',
                    locale: 'en',
                },
            },
        );

        console.log('[QuotaService] API Response received');
        console.log('[QuotaService] Response keys:', Object.keys(response));

        const models = parseQuotaResponse(response);

        const result: QuotaResult = {
            available: true,
            models,
            fetchedAt: new Date().toISOString(),
        };

        cachedQuota = result;
        lastFetch = Date.now();

        return result;

    } catch (e) {
        console.error('[QuotaService] Error:', (e as Error).message);
        return {
            available: false,
            error: (e as Error).message,
            models: [],
        };
    }
}

/**
 * Clear the cache
 */
export function clearCache(): void {
    cachedQuota = null;
    lastFetch = 0;
    cachedConnection = null;
    lastConnectionCheck = 0;
}

/**
 * Check if the language server is reachable
 */
export async function isAvailable(): Promise<{ available: boolean; port?: number; pid?: number }> {
    const connection = await findLanguageServer();
    return {
        available: !!connection,
        port: connection?.port,
        pid: connection?.pid,
    };
}
