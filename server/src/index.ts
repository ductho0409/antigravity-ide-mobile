#!/usr/bin/env node
/**
 * Antigravity Mobile Bridge — HTTP Server (TypeScript)
 * 1:1 migration from http-server.mjs
 *
 * Features:
 * - CDP screenshot streaming (zero-token capture)
 * - CDP command injection (control agent from mobile)
 * - WebSocket real-time updates
 * - Live chat view replication
 */

import express from 'express';
import compression from 'compression';
import { networkInterfaces } from 'os';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync, existsSync, mkdirSync, watch } from 'fs';
import { createInterface } from 'readline';
import { createHash, randomBytes } from 'crypto';
import multer from 'multer';

import * as Config from './config.js';
import { localhostOnly, createAdminGuard, checkLoginRateLimit, recordFailedLogin, clearLoginAttempts } from './middleware/auth.js';
import { createAuthRoutes, createApiAuthMiddleware } from './routes/auth.js';
import { createAdminRoutes } from './routes/admin.js';
import { createCdpRoutes } from './routes/cdp.js';
import { createFileRoutes } from './routes/files.js';
import { createMessageRoutes } from './routes/messages.js';
import { createGitRoutes } from './routes/git.js';

// CDP + Services
import * as CDP from './cdp/index.js';
import * as ChatStream from './services/chat-stream.js';
import * as Supervisor from './services/supervisor-service.js';
import * as TelegramBot from './services/telegram-bot.js';
import * as Tunnel from './services/tunnel.js';
import * as OllamaClient from './services/ollama-client.js';
import * as QuotaService from './services/quota-service.js';

import type { AuthState, ActivityEvent, BroadcastFn } from './types.js';
import type { IncomingMessage } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// ============================================================================
// Live Activity Feed — In-memory event ring buffer + disk session logs
// ============================================================================
const MAX_EVENTS = 100;
const activityEvents: ActivityEvent[] = [];
const LOGS_DIR = join(PROJECT_ROOT, 'data', 'logs');
if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
let loggingPaused = false;

function getLogFile(): string {
    const date = new Date().toISOString().slice(0, 10);
    return join(LOGS_DIR, `session-${date}.jsonl`);
}

const EVENT_ICONS: Record<string, string> = {
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    cdp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/></svg>',
    config: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg>',
    telegram: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/></svg>',
    screenshot: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    command: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    device: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
};

function emitEvent(type: string, message: string): void {
    if (loggingPaused) return;
    const event: ActivityEvent = {
        id: activityEvents.length,
        type,
        message,
        timestamp: new Date().toISOString(),
        ts: Date.now()
    };
    activityEvents.push(event);
    if (activityEvents.length > MAX_EVENTS) activityEvents.shift();
    try { writeFileSync(getLogFile(), JSON.stringify({ ...event, icon: EVENT_ICONS[type] || EVENT_ICONS.info }) + '\n', { flag: 'a' }); } catch { /* ignore */ }
}
emitEvent('info', 'Server starting...');

// ============================================================================
// Usage Analytics
// ============================================================================
const ANALYTICS_FILE = join(PROJECT_ROOT, 'data', 'analytics.json');
interface AnalyticsData {
    screenshots: number;
    errors: number;
    commands: number;
    uptimeStart: number;
    dailyStats: Record<string, Record<string, number>>;
    [key: string]: unknown;
}
let analytics: AnalyticsData = { screenshots: 0, errors: 0, commands: 0, uptimeStart: Date.now(), dailyStats: {} };
try {
    if (existsSync(ANALYTICS_FILE)) analytics = JSON.parse(readFileSync(ANALYTICS_FILE, 'utf-8'));
    if (!analytics.uptimeStart) {
        analytics.uptimeStart = Date.now();
        try { writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2), 'utf-8'); } catch { /* ignore */ }
    }
} catch { /* ignore */ }

function trackMetric(type: string): void {
    (analytics as Record<string, unknown>)[type] = ((analytics as Record<string, unknown>)[type] as number || 0) + 1;
    const today = new Date().toISOString().slice(0, 10);
    if (!analytics.dailyStats) analytics.dailyStats = {};
    if (!analytics.dailyStats[today]) analytics.dailyStats[today] = { screenshots: 0, errors: 0, commands: 0 };
    analytics.dailyStats[today][type] = (analytics.dailyStats[today][type] || 0) + 1;
    try { writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2), 'utf-8'); } catch { /* ignore */ }
}

// ============================================================================
// Configuration
// ============================================================================
const HTTP_PORT = parseInt(process.env['PORT'] || '3333', 10);
const DATA_DIR = join(PROJECT_ROOT, 'data');
const UPLOADS_DIR = join(PROJECT_ROOT, 'uploads');
const MESSAGES_FILE = join(DATA_DIR, 'messages.json');

// ============================================================================
// Authentication
// ============================================================================
const authState: AuthState = {
    authEnabled: false,
    authPinHash: null,
    validSessions: new Set()
};
const adminGuard = createAdminGuard(authState);

function hashPin(pin: string): string {
    return createHash('sha256').update(pin).digest('hex');
}

function generateSessionToken(): string {
    return randomBytes(32).toString('hex');
}

function validateSession(token: string | undefined): boolean {
    if (!authState.authEnabled) return true;
    if (!token) return false;
    return authState.validSessions.has(token);
}

async function promptForAuth(): Promise<void> {
    if (process.env['MOBILE_PIN']) {
        const pin = process.env['MOBILE_PIN'];
        if (pin.length >= 4 && pin.length <= 6 && /^\d+$/.test(pin)) {
            authState.authEnabled = true;
            authState.authPinHash = hashPin(pin);
            console.log('🔐 Authentication enabled via MOBILE_PIN environment variable');
            return;
        } else {
            console.log('⚠️ Invalid MOBILE_PIN (must be 4-6 digits). Continuing without auth.');
            return;
        }
    }

    if (!process.stdin.isTTY) {
        console.log('ℹ️ Non-interactive mode - auth disabled (set MOBILE_PIN env to enable)');
        return;
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const question = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve));

    console.log('\n' + '═'.repeat(50));
    console.log('🔐 Authentication Setup');
    console.log('═'.repeat(50));

    const enableAuth = await question('Enable PIN authentication? (y/N or enter 4-6 digit PIN): ');

    // Smart detect: if user typed a PIN directly (4-6 digits), use it
    const isDirectPin = /^\d{4,6}$/.test(enableAuth.trim());

    if (isDirectPin) {
        authState.authEnabled = true;
        authState.authPinHash = hashPin(enableAuth.trim());
        console.log('✅ Authentication enabled! PIN set successfully.');
    } else if (enableAuth.toLowerCase() === 'y') {
        const pin = await question('Enter a 4-6 digit PIN: ');
        if (pin.length >= 4 && pin.length <= 6 && /^\d+$/.test(pin)) {
            authState.authEnabled = true;
            authState.authPinHash = hashPin(pin);
            console.log('✅ Authentication enabled! PIN set successfully.');
        } else {
            console.log('⚠️ Invalid PIN (must be 4-6 digits). Continuing without auth.');
        }
    } else {
        console.log('ℹ️ Continuing without authentication.');
    }

    console.log('═'.repeat(50) + '\n');
    rl.close();
}

// Ensure directories exist
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer configuration for image uploads
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp|bmp/;
        const ext = allowed.test(extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        cb(null, ext && mime);
    }
});

// ============================================================================
// Workspace Detection
// ============================================================================
let workspacePath = join(PROJECT_ROOT, '..');
let lastValidWorkspacePath: string | null = null;
let workspacePollingActive = false;
let workspacePollingInterval: ReturnType<typeof setInterval> | null = null;
let consecutiveFailures = 0;

// Cross-platform path comparison
const isWindows = process.platform === 'win32';
function pathStartsWith(path: string, prefix: string): boolean {
    if (isWindows) return path.toLowerCase().startsWith(prefix.toLowerCase());
    return path.startsWith(prefix);
}
function pathEquals(path1: string, path2: string): boolean {
    if (isWindows) return path1.toLowerCase() === path2.toLowerCase();
    return path1 === path2;
}

async function refreshWorkspace(target?: { title?: string }): Promise<void> {
    const title = target?.title || '';
    const projectName = title.split(/\s+[—–]\s+|\s+-\s+/)[0]?.trim() || null;
    try {
        if (projectName) {
            const { workspaces } = await CDP.getRecentWorkspaces();
            const match = workspaces.find((ws: { name: string }) =>
                ws.name.toLowerCase() === projectName.toLowerCase()
            );
            if (match?.path) {
                const detectedPath = decodeURIComponent(match.path);
                if (!pathEquals(detectedPath, workspacePath)) {
                    const oldPath = workspacePath;
                    workspacePath = detectedPath;
                    lastValidWorkspacePath = detectedPath;
                    Supervisor.setProjectRoot(workspacePath);
                    console.log(`📂 Workspace changed: ${oldPath} → ${workspacePath}`);
                    broadcast('workspace_changed', { path: workspacePath, projectName: basename(workspacePath) });
                }
                return;
            }
        }
        const detectedPath = await CDP.getWorkspacePath();
        if (detectedPath && !pathEquals(detectedPath, workspacePath)) {
            const oldPath = workspacePath;
            workspacePath = detectedPath;
            lastValidWorkspacePath = detectedPath;
            Supervisor.setProjectRoot(workspacePath);
            console.log(`📂 Workspace changed: ${oldPath} → ${workspacePath}`);
            broadcast('workspace_changed', { path: workspacePath, projectName: basename(workspacePath) });
        }
    } catch (e) {
        console.log('[refreshWorkspace] Workspace re-detect failed:', (e as Error).message);
    }
}

function startWorkspacePolling(): void {
    if (workspacePollingActive) return;
    workspacePollingActive = true;
    console.log('📂 Workspace polling started (30s interval)');
    // Initial immediate check
    refreshWorkspace().catch(() => {});
    workspacePollingInterval = setInterval(async () => {
        await refreshWorkspace();
    }, 30000);
}
function stopWorkspacePolling(): void {
    if (workspacePollingInterval) {
        clearInterval(workspacePollingInterval);
        workspacePollingInterval = null;
    }
    workspacePollingActive = false;
}

// ============================================================================
// Scheduled Screenshots — delegated to watchers.ts
// ============================================================================
import { createScreenshotScheduler } from './services/watchers.js';
import type { ScreenshotScheduler } from './services/watchers.js';

const SCREENSHOTS_DIR = join(PROJECT_ROOT, 'data', 'screenshots');
if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const ssConfig = Config.getConfig('scheduledScreenshots') as {
    enabled?: boolean; intervalMs?: number; format?: 'webp' | 'jpeg'; quality?: number; maxFiles?: number;
} | undefined;

const screenshotScheduler: ScreenshotScheduler = createScreenshotScheduler(
    (opts) => CDP.captureScreenshot(opts),
    (base64, dir, format) => {
        const ext = format === 'webp' ? 'webp' : 'jpg';
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filePath = join(dir, `screenshot-${ts}.${ext}`);
        writeFileSync(filePath, Buffer.from(base64, 'base64'));
        return filePath;
    },
    SCREENSHOTS_DIR,
    {
        format: ssConfig?.format || 'webp',
        quality: ssConfig?.quality || 70,
        intervalMs: ssConfig?.intervalMs || 30000,
        maxFiles: ssConfig?.maxFiles || 200
    }
);

function startScreenshotScheduler(): void {
    // Re-read config each time in case settings changed
    const cfg = Config.getConfig('scheduledScreenshots') as {
        enabled?: boolean; intervalMs?: number; format?: 'webp' | 'jpeg'; quality?: number; maxFiles?: number;
    } | undefined;
    if (!cfg?.enabled) return;
    screenshotScheduler.updateConfig({
        format: cfg.format || 'webp',
        quality: cfg.quality || 70,
        intervalMs: cfg.intervalMs || 30000,
        maxFiles: cfg.maxFiles || 200
    });
    screenshotScheduler.start();
}
function stopScreenshotScheduler(): void {
    screenshotScheduler.stop();
}

// ============================================================================
// File Watcher
// ============================================================================
let activeWatcher: ReturnType<typeof watch> | null = null;
let watchedPath: string | null = null;
let watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function startWatching(folderPath: string): void {
    stopWatching();
    if (!existsSync(folderPath)) return;
    watchedPath = folderPath;
    try {
        activeWatcher = watch(folderPath, { persistent: false }, (eventType, filename) => {
            if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
            watchDebounceTimer = setTimeout(() => {
                broadcast('file_changed', {
                    type: eventType,
                    filename,
                    folder: folderPath,
                    timestamp: new Date().toISOString()
                });
            }, 300);
        });
        console.log(`📁 Watching: ${folderPath}`);
    } catch (e) {
        console.log(`⚠️ Watch error: ${(e as Error).message}`);
    }
}

function stopWatching(): void {
    if (activeWatcher) {
        activeWatcher.close();
        activeWatcher = null;
        watchedPath = null;
    }
    if (watchDebounceTimer) {
        clearTimeout(watchDebounceTimer);
        watchDebounceTimer = null;
    }
}



// ============================================================================
interface MessageEntry {
    id?: string;
    role?: string;
    content?: string;
    timestamp?: string;
    [key: string]: unknown;
}
interface InboxEntry {
    id: string;
    from: string;
    message: string;
    timestamp: string;
    read: boolean;
    [key: string]: unknown;
}

let messages: MessageEntry[] = [];
const inbox: InboxEntry[] = [];

function loadMessages(): void {
    try {
        if (existsSync(MESSAGES_FILE)) {
            messages = JSON.parse(readFileSync(MESSAGES_FILE, 'utf-8'));
        }
    } catch {
        messages = [];
    }
}

function saveMessages(): void {
    try {
        if (messages.length > 500) messages = messages.slice(-500);
        writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    } catch { /* ignore */ }
}

loadMessages();
Config.loadConfig();
const serverStartTime = Date.now();

// ============================================================================
// WebSocket Clients
// ============================================================================
const clients = new Set<WebSocket>();

const broadcast: BroadcastFn = (event, data) => {
    const message = JSON.stringify({ event, data, ts: new Date().toISOString() });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
};

// ============================================================================
// Telegram Callbacks — extracted so they can be re-registered after admin re-init
// ============================================================================
function registerTelegramCallbacks(): void {
    TelegramBot.registerCallbacks({
        getStatus: async () => {
            const cdpAvail = await CDP.isAvailable().catch(() => ({ available: false }));
            const uptimeMs = Date.now() - serverStartTime;
            const s = Math.floor(uptimeMs / 1000);
            return {
                cdpConnected: (cdpAvail as { available?: boolean }).available ?? false,
                uptime: `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`,
                activeClients: clients.size,
            };
        },
        getScreenshot: async () => {
            try { return await CDP.captureScreenshot({ format: 'png', quality: 100 }); }
            catch { return null; }
        },
        clickByXPath: CDP.clickElementByXPath,
        getQuota: async () => {
            try { return await QuotaService.getQuota() as unknown as Record<string, unknown>; }
            catch { return { available: false, error: 'Quota service unavailable' }; }
        },
    });
}

// ============================================================================
// HTTP Server
// ============================================================================
const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use(express.json({ limit: '50mb' }));
app.use(compression());
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// Serve Vite build output (Preact SPA)
// Health check endpoint (used by launcher)
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

const CLIENT_DIST = join(PROJECT_ROOT, 'client', 'dist');
app.use(express.static(CLIENT_DIST));

// Fallback: serve legacy public/ files (admin panel, etc.)
app.use(express.static(join(PROJECT_ROOT, 'public')));

// SPA catch-all — serve index.html for client-side routing
app.get('/', (_req, res) => {
    const distIndex = join(CLIENT_DIST, 'index.html');
    if (existsSync(distIndex)) {
        res.sendFile(distIndex);
    } else {
        res.sendFile(join(PROJECT_ROOT, 'public', 'index.html'));
    }
});

// Admin panel — Vite build
app.get('/admin', (_req, res) => {
    const distAdmin = join(CLIENT_DIST, 'admin.html');
    if (existsSync(distAdmin)) {
        res.sendFile(distAdmin);
    } else {
        res.status(404).send('Admin panel not built. Run: cd client && npm run build');
    }
});

// CORS
// CORS
app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (_req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Wrap inbox as object so routes can mutate by reference
const inboxRef = { items: inbox };

// ── Auth Routes (before auth middleware) ────────────────────────────────
app.use(createAuthRoutes({
    localhostOnly,
    authState,
    hashPin,
    generateSessionToken,
    validateSession,
    checkLoginRateLimit,
    recordFailedLogin,
    clearLoginAttempts,
    emitEvent
}));

// ── Admin Routes (before auth middleware — has localhostOnly guard) ──────
app.use(createAdminRoutes({
    localhostOnly: adminGuard, Config: Config as unknown as Parameters<typeof createAdminRoutes>[0]['Config'], CDP: CDP as unknown as Parameters<typeof createAdminRoutes>[0]['CDP'],
    TelegramBot: TelegramBot as unknown as Parameters<typeof createAdminRoutes>[0]['TelegramBot'],
    Tunnel: Tunnel as unknown as Parameters<typeof createAdminRoutes>[0]['Tunnel'],
    Supervisor: Supervisor as unknown as Parameters<typeof createAdminRoutes>[0]['Supervisor'],
    OllamaClient: OllamaClient as unknown as Parameters<typeof createAdminRoutes>[0]['OllamaClient'],
    emitEvent, authState, hashPin, serverStartTime, clients, analytics, trackMetric,
    activityEvents, PROJECT_ROOT, HTTP_PORT, LOGS_DIR, SCREENSHOTS_DIR,
    startScreenshotScheduler, stopScreenshotScheduler, screenshotScheduler,
    loggingState: { get paused() { return loggingPaused; }, set paused(v: boolean) { loggingPaused = v; } },
    // Re-register Telegram callbacks after admin re-inits the bot (e.g. Save Settings)
    onTelegramReinit: () => registerTelegramCallbacks(),
}));

// ── Auth Middleware (protects all API routes below) ─────────────────────
app.use('/api', createApiAuthMiddleware(authState, validateSession));

// ── CDP + Chat + Models + Quota Routes ──────────────────────────────────
app.use(createCdpRoutes({
    CDP: CDP as unknown as Parameters<typeof createCdpRoutes>[0]['CDP'],
    ChatStream: ChatStream as unknown as Parameters<typeof createCdpRoutes>[0]['ChatStream'],
    QuotaService: QuotaService as unknown as Parameters<typeof createCdpRoutes>[0]['QuotaService'],
    broadcast, messages, saveMessages, emitEvent, trackMetric,
    onWindowSwitch: refreshWorkspace
}));

// ── File Routes ─────────────────────────────────────────────────────────
app.use(createFileRoutes({
    pathStartsWith, pathEquals, isWindows,
    startWatching, stopWatching,
    getWorkspacePath: () => workspacePath,
    setWorkspacePath: (p: string) => { workspacePath = p; },
    upload, UPLOADS_DIR
}));

// Serve uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));

// Serve Antigravity resources (for icons in chat)
if (existsSync('/usr/share/antigravity')) {
    app.use('/usr/share/antigravity', express.static('/usr/share/antigravity'));
}

// ── Git Routes ──────────────────────────────────────────────────────────
app.use(createGitRoutes({
    getWorkspacePath: () => workspacePath,
}));
// ── Message + Supervisor Routes ─────────────────────────────────────────
app.use(createMessageRoutes({
    messages, inbox: inboxRef, saveMessages, broadcast, clients,
    Supervisor: Supervisor as unknown as Parameters<typeof createMessageRoutes>[0]['Supervisor']
}));

// Detailed status endpoint
app.get('/api/status', async (_req, res) => {
    let lanIP: string | null = null;
    try {
        const nets = networkInterfaces();
        for (const ifaces of Object.values(nets)) {
            if (!ifaces) continue;
            for (const iface of ifaces) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    lanIP = iface.address;
                    break;
                }
            }
            if (lanIP) break;
        }
    } catch { /* ignore */ }

    const uptimeMs = Date.now() - serverStartTime;
    const uptimeSec = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(uptimeSec / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const secs = uptimeSec % 60;

    res.json({
        ok: true,
        version: '2.0.0',
        uptime: `${hours}h ${mins}m ${secs}s`,
        uptimeMs,
        lanIP,
        port: HTTP_PORT,
        node: process.version,
        platform: process.platform,
        memory: {
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
            heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        },
        clients: clients.size,
        inbox_count: inboxRef.items.length,
        message_count: messages.length,
        cdp: await CDP.isAvailable().catch(() => ({ available: false })),
        auth: authState.authEnabled
    });
});

// ============================================================================
// WebSocket
// ============================================================================
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Auth check
    if (authState.authEnabled) {
        const url = new URL(req.url || '', 'http://localhost');
        const token = url.searchParams.get('token');
        if (!validateSession(token ?? undefined)) {
            ws.close(4401, 'Unauthorized');
            return;
        }
    }

    clients.add(ws);
    console.log(`🔌 Client connected. Total: ${clients.size}`);

    // Send history
    ws.send(JSON.stringify({
        event: 'history',
        data: { messages: messages.slice(-50) },
        ts: new Date().toISOString()
    }));

    // Send initial workspace
    ws.send(JSON.stringify({
        event: 'workspace_changed',
        data: { path: workspacePath, projectName: basename(workspacePath) },
        ts: new Date().toISOString()
    }));

    // Start discovery in background
    refreshWorkspace().catch(() => {});

    // Handle messages from mobile
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.action === 'inject') {
                try {
                    const result = await CDP.injectAndSubmit(msg.text || '');
                    ws.send(JSON.stringify({ event: 'inject_result', data: { success: true, ...(result as Record<string, unknown>) } }));
                } catch (e) {
                    ws.send(JSON.stringify({ event: 'inject_result', data: { success: false, error: (e as Error).message } }));
                }
            } else if (msg.action === 'screenshot') {
                try {
                    const base64 = await CDP.captureScreenshot({ format: 'png', quality: 80 });
                    ws.send(JSON.stringify({ event: 'screenshot', data: { success: true, data: base64, dataUrl: `data:image/png;base64,${base64}` } }));
                } catch (e) {
                    ws.send(JSON.stringify({ event: 'error', data: { message: (e as Error).message } }));
                }
            } else if (msg.action === 'start_stream') {
                // Check if already streaming — hot-swap quality without reconnecting CDP
                const existingCdp = (ws as unknown as Record<string, unknown>)._cdpClient;
                const existingCleanup = (ws as unknown as Record<string, unknown>)._streamActive as { stop: () => void } | undefined;

                if (existingCdp && existingCleanup) {
                    // Hot-swap: restart screencast on same CDP connection
                    try {
                        const streamQuality = typeof msg.quality === 'number' ? msg.quality : 75;
                        const everyNthFrame = typeof msg.everyNthFrame === 'number' ? msg.everyNthFrame : 1;
                        const maxWidth = msg.maxWidth as number | undefined;
                        const maxHeight = msg.maxHeight as number | undefined;
                        const cdp = existingCdp as { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> };
                        await cdp.send('Page.stopScreencast');
                        await cdp.send('Page.startScreencast', {
                            format: 'jpeg',
                            quality: streamQuality,
                            everyNthFrame,
                            ...(maxWidth ? { maxWidth } : {}),
                            ...(maxHeight ? { maxHeight } : {}),
                        });
                        // Re-read and send updated cssViewport after resolution change
                        let cssViewport = { width: 0, height: 0 };
                        try {
                            const metrics = await cdp.send('Page.getLayoutMetrics') as Record<string, unknown>;
                            const lv = metrics.cssLayoutViewport as Record<string, number> | undefined;
                            if (lv) cssViewport = { width: lv.clientWidth, height: lv.clientHeight };
                        } catch { /* fallback */ }
                        ws.send(JSON.stringify({ event: 'stream_started', data: { mode: 'screencast', cssViewport } }));
                    } catch { /* restart failed, will do full reconnect below */ }
                    return;
                }

                // No existing stream — do full connect
                if (existingCleanup) existingCleanup.stop();

                try {
                    const target = await CDP.findEditorTarget();
                    if (!target) throw new Error('No editor target found');

                    const cdpClient = await CDP.connectToTarget(target);
                    let stopped = false;

                    // Listen for screencast frames — push-based, zero latency
                    const cdpWs = cdpClient.ws;
                    const streamQuality = typeof msg.quality === 'number' ? msg.quality : 75;
                    const everyNthFrame = typeof msg.everyNthFrame === 'number' ? msg.everyNthFrame : 1;

                    const frameHandler = (raw: Buffer | string) => {
                        if (stopped || ws.readyState !== WebSocket.OPEN) return;
                        try {
                            const cdpMsg = JSON.parse(raw.toString());
                            if (cdpMsg.method === 'Page.screencastFrame') {
                                const { data: base64, sessionId } = cdpMsg.params;
                                // Acknowledge IMMEDIATELY to keep receiving (before any processing)
                                cdpClient.send('Page.screencastFrameAck', { sessionId }).catch(() => { });
                                // Send as binary (saves ~33% vs base64 JSON)
                                const buf = Buffer.from(base64, 'base64');
                                ws.send(buf, { binary: true });
                            }
                        } catch { /* skip */ }
                    };
                    cdpWs.on('message', frameHandler);

                    // Resolution limit based on quality (biggest bandwidth saver, zero latency cost)
                    const maxWidth = msg.maxWidth as number | undefined;
                    const maxHeight = msg.maxHeight as number | undefined;

                    await cdpClient.send('Page.startScreencast', {
                        format: 'jpeg',
                        quality: streamQuality,
                        everyNthFrame,
                        ...(maxWidth ? { maxWidth } : {}),
                        ...(maxHeight ? { maxHeight } : {}),
                    });

                    const cleanup = {
                        stop: () => {
                            if (stopped) return;
                            stopped = true;
                            cdpWs.off('message', frameHandler);
                            cdpClient.send('Page.stopScreencast').catch(() => { });
                            setTimeout(() => cdpClient.close(), 200);
                        }
                    };

                    (ws as unknown as Record<string, unknown>)._streamActive = cleanup;
                    (ws as unknown as Record<string, unknown>)._cdpClient = cdpClient;

                    // Get actual CSS viewport for accurate click coordinate mapping
                    let cssViewport = { width: 0, height: 0 };
                    try {
                        const metrics = await cdpClient.send('Page.getLayoutMetrics');
                        const lv = metrics.cssLayoutViewport as Record<string, number> | undefined;
                        if (lv) cssViewport = { width: lv.clientWidth, height: lv.clientHeight };
                    } catch { /* fallback to 0 = client uses image dimensions */ }

                    ws.send(JSON.stringify({ event: 'stream_started', data: { mode: 'screencast', cssViewport } }));
                } catch (e) {
                    ws.send(JSON.stringify({ event: 'error', data: { message: `Stream failed: ${(e as Error).message}` } }));
                }
            } else if (msg.action === 'stop_stream') {
                const active = (ws as unknown as Record<string, unknown>)._streamActive as { stop: () => void } | undefined;
                if (active) active.stop();
                (ws as unknown as Record<string, unknown>)._streamActive = null;
                (ws as unknown as Record<string, unknown>)._cdpClient = null;
                ws.send(JSON.stringify({ event: 'stream_stopped' }));
            } else if (msg.action === 'stream_click') {
                // Forward touch/click from mobile to IDE
                const cdpClient = (ws as unknown as Record<string, unknown>)._cdpClient as { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>> } | null;
                if (cdpClient && msg.x !== undefined && msg.y !== undefined) {
                    try {
                        const clickCount = (msg.clickCount as number) || 1;
                        const button = (msg.button as string) || 'left';
                        await cdpClient.send('Input.dispatchMouseEvent', {
                            type: 'mousePressed', x: msg.x, y: msg.y, button, clickCount
                        });
                        await cdpClient.send('Input.dispatchMouseEvent', {
                            type: 'mouseReleased', x: msg.x, y: msg.y, button, clickCount
                        });
                    } catch { /* ignore click errors */ }
                }
            } else if (msg.action === 'stream_mouse') {
                // Generic mouse event (for drag/select: mousePressed, mouseMoved, mouseReleased)
                const cdpClient = (ws as unknown as Record<string, unknown>)._cdpClient as { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>> } | null;
                if (cdpClient && msg.type && msg.x !== undefined && msg.y !== undefined) {
                    try {
                        const params: Record<string, unknown> = {
                            type: msg.type, x: msg.x, y: msg.y, button: 'left',
                        };
                        if (msg.type === 'mousePressed' || msg.type === 'mouseReleased') {
                            params.clickCount = 1;
                        }
                        // For mouseMoved during drag, set buttons=1 (left button held)
                        if (msg.type === 'mouseMoved' && msg.dragging) {
                            params.buttons = 1;
                        }
                        await cdpClient.send('Input.dispatchMouseEvent', params);
                    } catch { /* ignore */ }
                }
            } else if (msg.action === 'stream_key') {
                // Forward keyboard input to IDE
                const cdpClient = (ws as unknown as Record<string, unknown>)._cdpClient as { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>> } | null;
                if (cdpClient) {
                    try {
                        if (msg.text) {
                            // Simple text insertion (most reliable for typing)
                            await cdpClient.send('Input.insertText', { text: msg.text as string });
                        } else if (msg.key) {
                            // Special keys (Enter, Backspace, Tab, arrows, etc.)
                            const keyParams: Record<string, unknown> = {
                                key: msg.key as string,
                                code: msg.code as string || '',
                            };
                            if (msg.modifiers) keyParams.modifiers = msg.modifiers;
                            await cdpClient.send('Input.dispatchKeyEvent', { type: 'keyDown', ...keyParams });
                            await cdpClient.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keyParams });
                        }
                    } catch { /* ignore */ }
                }
            } else if (msg.action === 'stream_scroll') {
                // Scroll: forward mouse wheel event
                const cdpClient = (ws as unknown as Record<string, unknown>)._cdpClient as { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>> } | null;
                if (cdpClient && msg.x !== undefined && msg.y !== undefined) {
                    try {
                        await cdpClient.send('Input.dispatchMouseEvent', {
                            type: 'mouseWheel',
                            x: msg.x, y: msg.y,
                            deltaX: msg.deltaX || 0,
                            deltaY: msg.deltaY || 0,
                        });
                    } catch { /* ignore */ }
                }
            } else if (msg.action === 'stream_paste') {
                // Paste text from mobile clipboard into IDE
                const cdpClient = (ws as unknown as Record<string, unknown>)._cdpClient as { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>> } | null;
                const text = msg.text as string;
                if (cdpClient && text) {
                    try {
                        // Insert text directly using Input.insertText (most reliable for paste)
                        await cdpClient.send('Input.insertText', { text });
                        ws.send(JSON.stringify({ event: 'clipboard_result', data: { action: 'paste', success: true } }));
                    } catch (e) {
                        ws.send(JSON.stringify({ event: 'clipboard_result', data: { action: 'paste', success: false, error: (e as Error).message } }));
                    }
                }
            } else if (msg.action === 'stream_copy') {
                // Copy selected text from IDE to mobile clipboard
                const cdpClient = (ws as unknown as Record<string, unknown>)._cdpClient as { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>> } | null;
                if (cdpClient) {
                    try {
                        // Send Ctrl+C to IDE
                        await cdpClient.send('Input.dispatchKeyEvent', {
                            type: 'keyDown', key: 'c',
                            code: 'KeyC', windowsVirtualKeyCode: 67,
                            modifiers: 2, // Ctrl
                        });
                        await cdpClient.send('Input.dispatchKeyEvent', {
                            type: 'keyUp', key: 'c',
                            code: 'KeyC', windowsVirtualKeyCode: 67,
                            modifiers: 2,
                        });
                        // Wait briefly for clipboard to populate, then read
                        await new Promise(r => setTimeout(r, 100));
                        const result = await cdpClient.send('Runtime.evaluate', {
                            expression: 'navigator.clipboard.readText()',
                            awaitPromise: true,
                            returnByValue: true,
                        });
                        const value = (result.result as Record<string, unknown>)?.value as string | undefined;
                        ws.send(JSON.stringify({ event: 'clipboard_result', data: { action: 'copy', success: true, text: value || '' } }));
                    } catch (e) {
                        ws.send(JSON.stringify({ event: 'clipboard_result', data: { action: 'copy', success: false, error: (e as Error).message } }));
                    }
                }
            }
            else if (msg.action === 'terminal_list') {
                try {
                    const terminals = await CDP.listTerminals();
                    ws.send(JSON.stringify({ event: 'terminal_list_result', data: { terminals } }));
                } catch (e) {
                    ws.send(JSON.stringify({ event: 'terminal_list_result', data: { terminals: [], error: (e as Error).message } }));
                }
            } else if (msg.action === 'terminal_content') {
                try {
                    const content = await CDP.getTerminalContent(msg.index);
                    ws.send(JSON.stringify({ event: 'terminal_content_result', data: content }));
                } catch (e) {
                    ws.send(JSON.stringify({ event: 'terminal_content_result', data: { error: (e as Error).message } }));
                }
            } else if (msg.action === 'terminal_input') {
                try {
                    const result = await CDP.sendTerminalInput(msg.index, msg.text);
                    ws.send(JSON.stringify({ event: 'terminal_input_result', data: result }));
                } catch (e) {
                    ws.send(JSON.stringify({ event: 'terminal_input_result', data: { success: false, error: (e as Error).message } }));
                }
            } else if (msg.action === 'terminal_switch') {
                try {
                    const result = await CDP.switchTerminal(msg.index);
                    ws.send(JSON.stringify({ event: 'terminal_switch_result', data: result }));
                } catch (e) {
                    ws.send(JSON.stringify({ event: 'terminal_switch_result', data: { success: false, error: (e as Error).message } }));
                }
            } else if (msg.action === 'terminal_create') {
                try {
                    const result = await CDP.createTerminal();
                    ws.send(JSON.stringify({ event: 'terminal_create_result', data: result }));
                } catch (e) {
                    ws.send(JSON.stringify({ event: 'terminal_create_result', data: { success: false, error: (e as Error).message } }));
                }
            } else if (msg.action === 'terminal_close') {
                try {
                    const result = await CDP.closeTerminal(msg.index);
                    ws.send(JSON.stringify({ event: 'terminal_close_result', data: result }));
                } catch (e) {
                    ws.send(JSON.stringify({ event: 'terminal_close_result', data: { success: false, error: (e as Error).message } }));
                }
            } else if (msg.action === 'terminal_raw_key') {
                try {
                    const result = await CDP.sendTerminalRawKey(msg.index, msg.key, msg.code, msg.keyCode);
                    ws.send(JSON.stringify({ event: 'terminal_raw_key_result', data: result }));
                } catch (e) {
                    ws.send(JSON.stringify({ event: 'terminal_raw_key_result', data: { success: false, error: (e as Error).message } }));
                }
            } else if (msg.action === 'terminal_special_key') {
                try {
                    const result = await CDP.sendTerminalSpecialKey(msg.index, msg.char, msg.ctrl);
                    ws.send(JSON.stringify({ event: 'terminal_special_key_result', data: result }));
                } catch (e) {
                    ws.send(JSON.stringify({ event: 'terminal_special_key_result', data: { success: false, error: (e as Error).message } }));
                }
            }
        } catch (e) {
            ws.send(JSON.stringify({ event: 'error', data: { message: (e as Error).message } }));
        }
    });

    ws.on('close', () => {
        // Cleanup stream on disconnect
        const active = (ws as unknown as Record<string, unknown>)._streamActive as { stop: () => void } | undefined;
        if (active) active.stop();
        clients.delete(ws);
        console.log(`🔌 Client disconnected. Total: ${clients.size}`);
    });
});

// ============================================================================
// Terminal Monitor — Polls terminal state and broadcasts changes
// ============================================================================
let terminalMonitorInterval: ReturnType<typeof setInterval> | null = null;
let lastTerminalHash: string | null = null;

function startTerminalMonitor(): void {
    if (terminalMonitorInterval) return;

    terminalMonitorInterval = setInterval(async () => {
        try {
            const terminals = await CDP.listTerminals();
            if (!terminals || terminals.length === 0) return;

            const activeTerminal = terminals.find(t => t.isActive);
            let activeContent = null;

            if (activeTerminal) {
                activeContent = await CDP.getTerminalContent(activeTerminal.index);
            }

            const hashInput = JSON.stringify({ terminals, activeContent });
            const hash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

            if (hash !== lastTerminalHash) {
                lastTerminalHash = hash;
                broadcast('terminal_update', { terminals, activeContent } as Record<string, unknown>);
            }
        } catch {
            // Terminal polling is best-effort
        }
    }, 500);
}

// ============================================================================
// Start
// ============================================================================
async function startServer(): Promise<void> {
    await promptForAuth();

    // Set active CDP device from config
    const devices = (Config.getConfig('devices') || []) as Array<{ cdpPort: number; active?: boolean }>;
    const activeDevice = devices.find(d => d.active);
    if (activeDevice) {
        CDP.setActiveDevice(activeDevice.cdpPort);
    }

    // Register Supervisor callbacks
    Supervisor.registerCallbacks({
        injectAndSubmit: async (text: string) => { await CDP.injectAndSubmit(text); },
        clickByXPath: CDP.clickElementByXPath,
        captureScreenshot: async () => {
            try {
                return await CDP.captureScreenshot({ format: 'png', quality: 80 });
            } catch { return null; }
        },
        emitEvent,
        broadcast
    });

    // Start Telegram bot if configured
    const tgConfig = Config.getConfig('telegram') as {
        enabled?: boolean; botToken?: string; chatId?: string;
        topicId?: string | number; notifications?: { onComplete?: boolean; onError?: boolean; onInputNeeded?: boolean };
    } | undefined;
    if (tgConfig?.enabled && tgConfig?.botToken) {
        try {
            // topicId may be stored as string in config.json — parse to number
            const topicId = tgConfig.topicId
                ? parseInt(String(tgConfig.topicId), 10) || undefined
                : undefined;

            await TelegramBot.initBot({
                botToken: tgConfig.botToken,
                chatId: tgConfig.chatId,
                topicId,
                notifications: tgConfig.notifications,
            });

            registerTelegramCallbacks();
            console.log('🤖 Telegram bot callbacks registered');
        } catch (e) {
            console.log('⚠️ Telegram bot init failed:', (e as Error).message);
        }
    }

    // Register ChatStream + Telegram hooks via individual setters
    ChatStream.setAutoAcceptCallback(null); // auto-accept handled in admin routes
    ChatStream.setErrorCallback(TelegramBot.isRunning()
        ? async (msg: string) => { await TelegramBot.sendNotification('error' as 'error', msg); }
        : null
    );
    ChatStream.setDebugCallback(Supervisor.isEnabled()
        ? async (html: string) => { await Supervisor.processChatUpdate(html); }
        : null
    );
    // Push chat updates to all WS clients in real-time (no client polling latency)
    ChatStream.setBroadcastCallback(broadcast);

    // Start supervisor if configured
    const svConfig = Config.getConfig('supervisor') as { enabled?: boolean } | undefined;
    if (svConfig?.enabled) {
        Supervisor.start();
    }


    // Auto-start tunnel if configured
    const tunnelConfig = Config.getConfig('tunnel') as { autoStart?: boolean; mode?: string } | undefined;
    const shouldAutoStart = tunnelConfig?.autoStart && authState.authEnabled;
    const previousState = !shouldAutoStart ? Tunnel.loadPersistentState() : null;

    if (shouldAutoStart || previousState?.wasActive) {
        const mode = (shouldAutoStart
            ? (tunnelConfig?.mode || 'quick')
            : previousState!.mode) as 'quick' | 'named';

        const logPrefix = shouldAutoStart ? 'auto-started' : 'auto-restarted (tsx watch)';

        try {
            let tunnelName: string | undefined;
            let hostname: string | undefined;

            // For named tunnels, detect config from ~/.cloudflared/config.yml
            if (mode === 'named') {
                if (previousState?.wasActive && previousState.tunnelName) {
                    tunnelName = previousState.tunnelName;
                    hostname = previousState.hostname;
                } else {
                    const detected = Tunnel.detectNamedTunnel();
                    if (detected.available && detected.tunnelId) {
                        tunnelName = detected.tunnelId;
                        hostname = detected.hostname;
                    } else {
                        console.log('⚠️ Named tunnel config not found in ~/.cloudflared/config.yml');
                    }
                }
            }

            if (mode === 'quick' || tunnelName) {
                const result = await Tunnel.startTunnel(
                    mode, previousState?.port || HTTP_PORT,
                    tunnelName, hostname
                );
                if (result.success) {
                    emitEvent('success', `Tunnel ${logPrefix} (${mode}): ${result.url}`);
                } else {
                    console.log(`⚠️ Tunnel ${logPrefix} failed:`, result.error);
                }
            }
        } catch (e) {
            console.log('⚠️ Tunnel auto-start failed:', (e as Error).message);
        }
    }


    httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
        const tgEnabled = Config.getConfig('telegram.enabled');
        const tunnelStatus = Tunnel.getStatus();
        const tunnelLine = tunnelStatus.status === 'active' && tunnelStatus.url
            ? `🚇 ${tunnelStatus.url}`
            : tunnelStatus.status === 'starting'
                ? '🚇 Starting...'
                : '❌ Disabled';
        console.log(`
╔════════════════════════════════════════════════════════╗
║       📱 Antigravity Mobile Bridge (TypeScript)        ║
╠════════════════════════════════════════════════════════╣
║  Mobile UI:    http://localhost:${HTTP_PORT}                   ║
║  Auth:         ${authState.authEnabled ? '🔐 ENABLED' : '🔓 Disabled'}                            ║
║  Telegram:     ${tgEnabled ? '🤖 ENABLED' : '❌ Disabled'}                            ║
║  Tunnel:       ${tunnelLine.padEnd(39)}║
╚════════════════════════════════════════════════════════╝
    `);

        startWorkspacePolling();
        startScreenshotScheduler();
        startTerminalMonitor();

        // Auto-start chat stream with retry (CDP may not be ready immediately)
        const startChatStreamWithRetry = async (retries = 30, delayMs = 5000): Promise<void> => {
            for (let i = 0; i < retries; i++) {
                try {
                    const result = await ChatStream.startChatStream((chat) => {
                        broadcast('chat_update', {
                            messageCount: chat.messages?.length ?? 0,
                            messages: chat.messages,
                            timestamp: new Date().toISOString()
                        });
                        // Feed chat updates to supervisor
                        if (chat.html && Supervisor.isEnabled()) {
                            Supervisor.processChatUpdate(chat.html);
                        }
                    }, 500);
                    if ((result as { success?: boolean })?.success) {
                        emitEvent('success', 'Chat stream connected');
                        return;
                    }
                } catch { /* retry */ }
                await new Promise(r => setTimeout(r, delayMs));
            }
            emitEvent('info', 'Chat stream: CDP not available after retries');
        };
        setTimeout(() => startChatStreamWithRetry(), 3000);

        emitEvent('success', `HTTP server listening on port ${HTTP_PORT}`);
    });
}

// ============================================================================
// Graceful Shutdown — Clean up tunnel + child processes on tsx watch restart
// ============================================================================
function gracefulShutdown(signal: string): void {
    console.log(`
🛑 Received ${signal}, shutting down...`);

    // Stop ALL active tunnels (dashboard + all previews)
    const stopPromises: Promise<unknown>[] = [];
    if (Tunnel.isActive()) {
        console.log('🚇 Stopping dashboard tunnel...');
        stopPromises.push(Tunnel.stopTunnel().catch(() => { /* ignore */ }));
    }
    stopPromises.push(Tunnel.stopAllPreviewTunnels().catch(() => { /* ignore */ }));
    Promise.all(stopPromises).catch(() => { /* ignore */ });

    // Stop terminal monitor
    if (terminalMonitorInterval) {
        clearInterval(terminalMonitorInterval);
        terminalMonitorInterval = null;
    }

    // Close HTTP server
    httpServer.close();

    // Force exit after 2s if graceful shutdown hangs
    setTimeout(() => process.exit(0), 2000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();

// Export for testing
export { app, httpServer, broadcast, emitEvent, trackMetric, authState, clients };
