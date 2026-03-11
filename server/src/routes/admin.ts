/**
 * Admin Routes — Config, status, devices, commands, logs, analytics
 * 1:1 migration from routes/admin.mjs
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { join } from 'path';
import { readFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { networkInterfaces } from 'os';
import type { AuthState, ActivityEvent } from '../types.js';

// Service interfaces — will be properly typed after Phase 3&4 migration
interface ConfigService {
    getConfig: (path?: string) => unknown;
    mergeConfig: (updates: unknown) => unknown;
    updateConfig: (path: string, value: unknown) => void;
}

interface CDPService {
    isAvailable: () => Promise<{ available: boolean }>;
    getActiveDevice: () => unknown;
    setActiveDevice: (port: number) => void;
    injectAndSubmit: (text: string) => Promise<unknown>;
}

interface TelegramBotService {
    isRunning: () => boolean;
    initBot: (config: unknown) => Promise<void>;
    stopBot: () => Promise<void>;
    sendTestMessage: (chatId: string, topicId: string) => Promise<unknown>;
}

interface TunnelService {
    getStatus: (tunnelId?: string) => { mode: string | null; status: string; url: string | null; error: string | null; pid: number | null; startedAt: number | null };
    startTunnel: (mode: 'quick' | 'named', port: number, tunnelName?: string, hostname?: string, tunnelId?: string) => Promise<{ success: boolean; url?: string; error?: string }>;
    stopTunnel: (tunnelId?: string) => Promise<{ success: boolean }>;
    isActive: (tunnelId?: string) => boolean;
    detectNamedTunnel: () => { available: boolean; hostname?: string; tunnelId?: string };
    getActivePreviewTunnels: () => Array<{ tunnelId: string; url: string | null; status: string; port: number; startedAt: number | null }>;
    stopAllPreviewTunnels: () => Promise<void>;
}

interface SupervisorService {
    getStatus: () => unknown;
    start: () => void;
    stop: () => void;
    clearHistory: () => void;
    getActionLog: (limit: number) => unknown[];
}

interface OllamaService {
    isAvailable: () => Promise<{ available: boolean; models?: unknown[] }>;
    setEndpoint: (url: string) => void;
    getModelInfo: (model: string) => Promise<{ context_length?: number; parameter_size?: string; family?: string; quantization_level?: string } | null>;
}

interface AdminRouteDeps {
    localhostOnly: (req: Request, res: Response, next: NextFunction) => void;
    Config: ConfigService;
    CDP: CDPService;
    TelegramBot: TelegramBotService;
    Tunnel: TunnelService;
    Supervisor: SupervisorService;
    OllamaClient: OllamaService;
    emitEvent: (type: string, message: string) => void;
    authState: AuthState;
    hashPin: (pin: string) => string;
    serverStartTime: number;
    clients: Set<unknown>;
    analytics: { screenshots: number; errors: number; commands: number; uptimeStart: number; dailyStats: Record<string, Record<string, number>> };
    trackMetric: (type: string) => void;
    activityEvents: ActivityEvent[];
    PROJECT_ROOT: string;
    HTTP_PORT: number;
    LOGS_DIR: string;
    SCREENSHOTS_DIR: string;
    startScreenshotScheduler: () => void;
    stopScreenshotScheduler: () => void;
    screenshotScheduler: {
        isRunning: () => boolean;
        getConfig: () => { format: string; quality: number; intervalMs: number; maxFiles: number };
        getFileCount: () => number;
        updateConfig: (config: Record<string, unknown>) => void;
    };
    loggingState: { paused: boolean };
    onTelegramReinit?: () => void;
}

export function createAdminRoutes(deps: AdminRouteDeps): Router {
    const router = Router();
    const {
        localhostOnly, Config, CDP, TelegramBot, Tunnel, Supervisor, OllamaClient,
        emitEvent, authState, hashPin, serverStartTime, clients, analytics, trackMetric,
        activityEvents, PROJECT_ROOT, HTTP_PORT, LOGS_DIR, SCREENSHOTS_DIR,
        startScreenshotScheduler, stopScreenshotScheduler, screenshotScheduler, loggingState, onTelegramReinit
    } = deps;

    // Sanitize filename to prevent path traversal
    const safeName = (name: string): string => name.replace(/[/\\]/g, '').replace(/\.\./g, '');

    // Serve admin page (Vite build)
    router.get('/admin', localhostOnly, (_req: Request, res: Response) => {
        res.sendFile(join(PROJECT_ROOT, 'client', 'dist', 'admin.html'));
    });

    // ── Config ────────────────────────────────────────────────────────
    router.get('/api/admin/config', localhostOnly, (_req: Request, res: Response) => {
        const cfg = Config.getConfig();
        const masked = JSON.parse(JSON.stringify(cfg));
        if (masked.telegram?.botToken && masked.telegram.botToken.length > 6) {
            masked.telegram.botToken = '***' + masked.telegram.botToken.slice(-6);
        }
        res.json({ config: masked });
    });

    router.post('/api/admin/config', localhostOnly, async (req: Request, res: Response) => {
        try {
            const updates = req.body;
            if (updates.server && 'pin' in updates.server) {
                const pin = updates.server.pin;
                if (pin && pin.length >= 4 && pin.length <= 6 && /^\d+$/.test(pin)) {
                    authState.authEnabled = true;
                    authState.authPinHash = hashPin(pin);
                    updates.server.pin = hashPin(pin);
                } else if (!pin || pin.trim() === '') {
                    authState.authEnabled = false;
                    authState.authPinHash = null;
                    delete updates.server.pin;
                    console.log('🔓 PIN authentication disabled');
                } else {
                    delete updates.server.pin;
                }
            }
            if (updates.telegram?.botToken?.startsWith('***')) {
                updates.telegram.botToken = Config.getConfig('telegram.botToken');
            }
            Config.mergeConfig(updates);
            emitEvent('config', 'Settings saved');
            const tgConfig = Config.getConfig('telegram') as { enabled?: boolean; botToken?: string } | undefined;
            if (tgConfig?.enabled && tgConfig?.botToken) {
                await TelegramBot.initBot(tgConfig);
                // Re-register CDP callbacks so buttons continue to work after settings change
                if (onTelegramReinit) onTelegramReinit();
            } else {
                await TelegramBot.stopBot();
            }
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── Telegram ──────────────────────────────────────────────────────
    router.post('/api/admin/telegram/test', localhostOnly, async (req: Request, res: Response) => {
        try {
            const { chatId, topicId } = req.body;
            if (!TelegramBot.isRunning()) {
                const tgConfig = Config.getConfig('telegram') as { botToken?: string } | undefined;
                if (tgConfig?.botToken) await TelegramBot.initBot(tgConfig);
                if (!TelegramBot.isRunning()) {
                    return res.json({ success: false, error: 'Bot not running. Save a valid token first.' });
                }
            }
            const result = await TelegramBot.sendTestMessage(chatId, topicId);
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: (e as Error).message });
        }
    });

    // ── Status ────────────────────────────────────────────────────────
    router.get('/api/admin/status', localhostOnly, async (_req: Request, res: Response) => {
        let cdpConnected = false;
        try { cdpConnected = (await CDP.isAvailable()).available; } catch { /* ignore */ }
        const uptimeMs = Date.now() - serverStartTime;
        const hours = Math.floor(uptimeMs / 3600000);
        const mins = Math.floor((uptimeMs % 3600000) / 60000);
        const tunnelStatus = Tunnel.getStatus();

        const nets = networkInterfaces();
        const ipEntries: { address: string; name: string }[] = [];
        for (const name of Object.keys(nets)) {
            const ifaces = nets[name];
            if (!ifaces) continue;
            for (const net of ifaces) {
                if (net.family === 'IPv4' && !net.internal) {
                    ipEntries.push({ address: net.address, name: name.toLowerCase() });
                }
            }
        }
        const realPatterns = ['wi-fi', 'wifi', 'wlan', 'ethernet', 'eth', 'en0', 'en1'];
        const candidates = ipEntries.filter(e => e.address.startsWith('192.168.') && !e.address.endsWith('.1'));
        let lanIP: string | null = null;
        for (const p of realPatterns) {
            const m = candidates.find(e => e.name.includes(p));
            if (m) { lanIP = m.address; break; }
        }
        if (!lanIP) lanIP = candidates[0]?.address || ipEntries.find(e => e.address.startsWith('192.168.'))?.address || ipEntries[0]?.address || null;

        res.json({
            cdpConnected,
            telegramActive: TelegramBot.isRunning(),
            tunnelActive: tunnelStatus.status === 'active',
            tunnelUrl: tunnelStatus.url,
            uptime: `${hours}h ${mins}m`,
            port: Config.getConfig('server.port') || HTTP_PORT,
            activeClients: clients.size,
            authEnabled: authState.authEnabled,
            activeDevice: CDP.getActiveDevice(),
            lanIP,
            version: '2.0.0',
            node: process.version,
            platform: process.platform,
            memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB'
        });
    });

    // ── Devices ───────────────────────────────────────────────────────
    router.get('/api/admin/devices', localhostOnly, (_req: Request, res: Response) => {
        res.json({ devices: Config.getConfig('devices') || [] });
    });

    router.post('/api/admin/devices', localhostOnly, (req: Request, res: Response) => {
        const { name, cdpPort, active } = req.body;
        if (!name || !cdpPort) return res.status(400).json({ error: 'name and cdpPort required' });
        const devices = (Config.getConfig('devices') || []) as Array<{ name: string; cdpPort: number; active: boolean }>;
        const existing = devices.find(d => d.cdpPort === parseInt(cdpPort));
        if (existing) {
            existing.name = name;
            if (active) { devices.forEach(d => d.active = false); existing.active = true; CDP.setActiveDevice(existing.cdpPort); }
        } else {
            if (active) devices.forEach(d => d.active = false);
            devices.push({ name, cdpPort: parseInt(cdpPort), active: !!active });
            if (active) CDP.setActiveDevice(parseInt(cdpPort));
        }
        Config.updateConfig('devices', devices);
        res.json({ success: true, devices });
    });

    router.post('/api/admin/devices/switch', localhostOnly, (req: Request, res: Response) => {
        const { cdpPort } = req.body;
        const devices = (Config.getConfig('devices') || []) as Array<{ name: string; cdpPort: number; active: boolean }>;
        const target = devices.find(d => d.cdpPort === parseInt(cdpPort));
        if (!target) return res.status(404).json({ error: 'Device not found' });
        devices.forEach(d => d.active = false);
        target.active = true;
        CDP.setActiveDevice(target.cdpPort);
        Config.updateConfig('devices', devices);
        emitEvent('device', `Switched to ${target.name} (port ${target.cdpPort})`);
        res.json({ success: true, active: target });
    });

    router.delete('/api/admin/devices/:port', localhostOnly, (req: Request, res: Response) => {
        const port = parseInt(req.params.port);
        let devices = (Config.getConfig('devices') || []) as Array<{ name: string; cdpPort: number; active: boolean }>;
        const wasActive = devices.find(d => d.cdpPort === port)?.active;
        devices = devices.filter(d => d.cdpPort !== port);
        if (devices.length === 0) {
            devices = [{ name: 'Default', cdpPort: 9222, active: true }];
            CDP.setActiveDevice(9222);
        } else if (wasActive) {
            devices[0].active = true;
            CDP.setActiveDevice(devices[0].cdpPort);
        }
        Config.updateConfig('devices', devices);
        res.json({ success: true, devices });
    });

    // ── Commands ──────────────────────────────────────────────────────
    router.get('/api/admin/commands', (_req: Request, res: Response) => {
        res.json({ commands: Config.getConfig('quickCommands') || [] });
    });

    router.post('/api/admin/commands', localhostOnly, (req: Request, res: Response) => {
        const { commands } = req.body;
        if (!Array.isArray(commands)) return res.status(400).json({ error: 'commands array required' });
        Config.updateConfig('quickCommands', commands);
        res.json({ success: true, commands });
    });

    router.post('/api/commands/execute', async (req: Request, res: Response) => {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'prompt required' });
        try {
            const result = await CDP.injectAndSubmit(prompt);
            emitEvent('command', `Executed: ${prompt.slice(0, 50)}`);
            trackMetric('commands');
            res.json({ success: true, ...(result as Record<string, unknown>) });
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // ── Activity & Logs ───────────────────────────────────────────────
    router.get('/api/admin/events', localhostOnly, (_req: Request, res: Response) => {
        res.json({ events: activityEvents.slice().reverse() });
    });

    router.get('/api/admin/logs', localhostOnly, (_req: Request, res: Response) => {
        try {
            const files = readdirSync(LOGS_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
            const sessions = files.map(f => {
                const stats = statSync(join(LOGS_DIR, f));
                const content = readFileSync(join(LOGS_DIR, f), 'utf-8').trim();
                const lines = content ? content.split('\n').length : 0;
                return { filename: f, size: stats.size, events: lines, date: f.replace('session-', '').replace('.jsonl', '') };
            });
            res.json({ sessions });
        } catch { res.json({ sessions: [] }); }
    });

    router.get('/api/admin/logs/pause', localhostOnly, (_req: Request, res: Response) => {
        res.json({ paused: loggingState.paused });
    });

    router.post('/api/admin/logs/pause', localhostOnly, (_req: Request, res: Response) => {
        loggingState.paused = !loggingState.paused;
        res.json({ paused: loggingState.paused });
    });

    router.get('/api/admin/logs/:filename', localhostOnly, (req: Request, res: Response) => {
        const file = join(LOGS_DIR, safeName(req.params.filename));
        if (!existsSync(file)) return res.status(404).json({ error: 'Not found' });
        try {
            const content = readFileSync(file, 'utf-8').trim();
            const events = content ? content.split('\n').map(line => JSON.parse(line)) : [];
            res.json({ events: events.reverse() });
        } catch (e) { res.status(500).json({ error: (e as Error).message }); }
    });

    router.get('/api/admin/logs/:filename/download', localhostOnly, (req: Request, res: Response) => {
        const file = join(LOGS_DIR, safeName(req.params.filename));
        if (!existsSync(file)) return res.status(404).json({ error: 'Not found' });
        res.download(file);
    });

    router.delete('/api/admin/logs', localhostOnly, (_req: Request, res: Response) => {
        try {
            const files = readdirSync(LOGS_DIR).filter(f => f.endsWith('.jsonl'));
            files.forEach(f => unlinkSync(join(LOGS_DIR, f)));
            activityEvents.length = 0;
            emitEvent('info', 'Session logs cleared');
            res.json({ success: true, deleted: files.length });
        } catch (e) { res.status(500).json({ error: (e as Error).message }); }
    });

    // ── Analytics ─────────────────────────────────────────────────────
    router.get('/api/admin/analytics', localhostOnly, (_req: Request, res: Response) => {
        const uptimeMs = Date.now() - (analytics.uptimeStart || Date.now());
        const days = Math.floor(uptimeMs / 86400000);
        const hours = Math.floor((uptimeMs % 86400000) / 3600000);
        const mins = Math.floor((uptimeMs % 3600000) / 60000);
        let totalUptime = '';
        if (days > 0) totalUptime = `${days}d ${hours}h`;
        else if (hours > 0) totalUptime = `${hours}h ${mins}m`;
        else totalUptime = `${mins}m`;
        res.json({
            totals: { screenshots: analytics.screenshots || 0, errors: analytics.errors || 0, commands: analytics.commands || 0 },
            totalUptime,
            firstStarted: new Date(analytics.uptimeStart).toISOString(),
            dailyStats: analytics.dailyStats || {}
        });
    });

    // ── Screenshots ──────────────────────────────────────────────────

    /**
     * Parse timestamp from screenshot filename
     * e.g. "screenshot-2026-03-11T15-13-33.webp" → "2026-03-11T15:13:33"
     */
    function parseScreenshotTimestamp(filename: string): string {
        // Remove prefix and extension
        const raw = filename
            .replace(/^screenshot-/, '')
            .replace(/\.(webp|jpg|jpeg|png)$/, '');
        // Format: 2026-03-11T15-13-33 → 2026-03-11T15:13:33
        const parts = raw.split('T');
        if (parts.length === 2) {
            const timePart = parts[1].replace(/-/g, ':');
            return `${parts[0]}T${timePart}`;
        }
        return raw;
    }

    // List screenshots (supports both .webp and .jpg)
    router.get('/api/admin/screenshots', localhostOnly, (_req: Request, res: Response) => {
        try {
            const files = readdirSync(SCREENSHOTS_DIR)
                .filter(f => f.startsWith('screenshot-') && /\.(webp|jpg|jpeg)$/.test(f))
                .sort().reverse();
            const screenshots = files.slice(0, 100).map(f => {
                const stats = statSync(join(SCREENSHOTS_DIR, f));
                return { filename: f, size: stats.size, timestamp: parseScreenshotTimestamp(f) };
            });
            res.json({ screenshots });
        } catch { res.json({ screenshots: [] }); }
    });

    // Toggle scheduler on/off
    router.post('/api/admin/screenshots/toggle', localhostOnly, (_req: Request, res: Response) => {
        const current = Config.getConfig('scheduledScreenshots.enabled');
        const ssConfig = Config.getConfig('scheduledScreenshots') as Record<string, unknown> || {};
        Config.updateConfig('scheduledScreenshots', { ...ssConfig, enabled: !current });
        if (!current) { startScreenshotScheduler(); emitEvent('screenshot', 'Scheduled screenshots enabled'); }
        else { stopScreenshotScheduler(); emitEvent('screenshot', 'Scheduled screenshots disabled'); }
        res.json({ enabled: !current });
    });

    // Get scheduler status & config (MUST be before /:filename)
    router.get('/api/admin/screenshots/status', localhostOnly, (_req: Request, res: Response) => {
        const enabled = Config.getConfig('scheduledScreenshots.enabled') as boolean;
        const schedulerCfg = screenshotScheduler.getConfig();
        res.json({
            enabled,
            running: screenshotScheduler.isRunning(),
            format: schedulerCfg.format,
            quality: schedulerCfg.quality,
            intervalMs: schedulerCfg.intervalMs,
            maxFiles: schedulerCfg.maxFiles,
            fileCount: screenshotScheduler.getFileCount()
        });
    });

    // Update screenshot settings (MUST be before /:filename)
    router.post('/api/admin/screenshots/settings', localhostOnly, (req: Request, res: Response) => {
        const { intervalMs, quality, maxFiles, format } = req.body;
        const ssConfig = Config.getConfig('scheduledScreenshots') as Record<string, unknown> || {};
        const updates: Record<string, unknown> = { ...ssConfig };
        if (intervalMs !== undefined) updates.intervalMs = Math.max(5000, Number(intervalMs));
        if (quality !== undefined) updates.quality = Math.max(10, Math.min(100, Number(quality)));
        if (maxFiles !== undefined) updates.maxFiles = Math.max(10, Number(maxFiles));
        if (format !== undefined && (format === 'webp' || format === 'jpeg')) updates.format = format;
        Config.updateConfig('scheduledScreenshots', updates);
        // Sync to running scheduler
        screenshotScheduler.updateConfig(updates);
        emitEvent('config', 'Screenshot settings updated');
        res.json({ success: true, settings: updates });
    });

    // Delete all screenshots
    router.delete('/api/admin/screenshots', localhostOnly, (_req: Request, res: Response) => {
        try {
            const files = readdirSync(SCREENSHOTS_DIR).filter(f => f.startsWith('screenshot-') && /\.(webp|jpg|jpeg)$/.test(f));
            files.forEach(f => unlinkSync(join(SCREENSHOTS_DIR, f)));
            emitEvent('screenshot', `Deleted ${files.length} screenshots`);
            res.json({ success: true, deleted: files.length });
        } catch (e) { res.status(500).json({ error: (e as Error).message }); }
    });

    // Serve individual screenshot (MUST be AFTER /status and /settings)
    router.get('/api/admin/screenshots/:filename', localhostOnly, (req: Request, res: Response) => {
        const file = join(SCREENSHOTS_DIR, safeName(req.params.filename));
        if (!existsSync(file)) return res.status(404).json({ error: 'Not found' });
        const ext = req.params.filename.split('.').pop()?.toLowerCase();
        const contentType = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
        res.set('Content-Type', contentType);
        res.send(readFileSync(file));
    });

    // ── Auto-accept ──────────────────────────────────────────────────
    router.post('/api/admin/auto-accept/toggle', localhostOnly, (_req: Request, res: Response) => {
        const current = Config.getConfig('autoAcceptCommands');
        Config.updateConfig('autoAcceptCommands', !current);
        emitEvent('config', `Auto-accept commands ${!current ? 'enabled' : 'disabled'}`);
        res.json({ enabled: !current });
    });

    // ── PIN Management ──────────────────────────────────────────────
    router.delete('/api/admin/pin', localhostOnly, (_req: Request, res: Response) => {
        authState.authEnabled = false;
        authState.authPinHash = null;
        authState.validSessions.clear();
        Config.mergeConfig({ server: { pin: null } } as unknown as Partial<Record<string, unknown>>);
        emitEvent('config', 'PIN authentication disabled');
        console.log('🔓 PIN authentication disabled via admin');
        res.json({ success: true });
    });

    // ── Mobile UI Settings ───────────────────────────────────────────
    router.post('/api/admin/mobile-ui', localhostOnly, (req: Request, res: Response) => {
        const { showQuickActions, navigationMode, refreshInterval, theme, showAssistTab, showTerminalTab, showStreamTab, showGitTab, showChatTab, showFilesTab } = req.body;
        const settings: Record<string, unknown> = { showQuickActions, navigationMode, refreshInterval, theme };
        if (showAssistTab !== undefined) settings.showAssistTab = showAssistTab;
        if (showTerminalTab !== undefined) settings.showTerminalTab = showTerminalTab;
        if (showStreamTab !== undefined) settings.showStreamTab = showStreamTab;
        if (showGitTab !== undefined) settings.showGitTab = showGitTab;
        if (showChatTab !== undefined) settings.showChatTab = showChatTab;
        if (showFilesTab !== undefined) settings.showFilesTab = showFilesTab;
        
        Config.updateConfig('mobileUI', settings);
        
        if (showAssistTab !== undefined) Config.updateConfig('supervisor.showAssistTab', showAssistTab);
        if (theme) Config.updateConfig('dashboard.theme', theme);
        
        emitEvent('config', 'Mobile UI settings saved');
        res.json({ success: true });
    });

    router.get('/api/admin/mobile-ui', (_req: Request, res: Response) => {
        const mobileUI = (Config.getConfig('mobileUI') || {}) as Record<string, unknown>;
        if (!mobileUI.theme) {
            mobileUI.theme = Config.getConfig('dashboard.theme') || 'dark';
        }
        mobileUI.showAssistTab = Config.getConfig('supervisor.showAssistTab') || false;
        res.json(mobileUI);
    });

    // ── Supervisor Admin ─────────────────────────────────────────────
    router.get('/api/admin/supervisor', localhostOnly, async (_req: Request, res: Response) => {
        const status = Supervisor.getStatus();
        const ollamaStatus = await OllamaClient.isAvailable();
        const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
        const currentModel = (config.model as string) || 'llama3';

        // Fetch model info for context_length hint
        let modelInfo: { context_length?: number; parameter_size?: string } | null = null;
        if (ollamaStatus.available) {
            OllamaClient.setEndpoint((config.endpoint as string) || 'http://localhost:11434');
            modelInfo = await OllamaClient.getModelInfo(currentModel);
        }

        res.json({
            ...(status as Record<string, unknown>),
            ollamaAvailable: ollamaStatus.available,
            ollamaModels: ollamaStatus.models || [],
            modelInfo,
            config
        });
    });

    router.post('/api/admin/supervisor', localhostOnly, (req: Request, res: Response) => {
        const { endpoint, model, maxActionsPerMinute, projectContext, disableInjects, contextWindow } = req.body;
        const updates: Record<string, unknown> = {};
        if (endpoint !== undefined) updates.endpoint = endpoint;
        if (model !== undefined) updates.model = model;
        if (maxActionsPerMinute !== undefined) updates.maxActionsPerMinute = parseInt(maxActionsPerMinute) || 10;
        if (projectContext !== undefined) updates.projectContext = projectContext;
        if (disableInjects !== undefined) updates.disableInjects = !!disableInjects;
        if (contextWindow !== undefined) updates.contextWindow = parseInt(contextWindow) || 8192;
        const current = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
        Config.updateConfig('supervisor', { ...current, ...updates });
        emitEvent('config', 'Supervisor config saved');
        res.json({ success: true });
    });

    router.post('/api/admin/supervisor/toggle', localhostOnly, async (_req: Request, res: Response) => {
        const current = Config.getConfig('supervisor.enabled');
        Config.updateConfig('supervisor.enabled', !current);
        if (!current) { Supervisor.start(); } else { Supervisor.stop(); }
        emitEvent('config', `Supervisor ${!current ? 'enabled' : 'disabled'}`);
        res.json({ enabled: !current });
    });

    router.post('/api/admin/supervisor/context', localhostOnly, (req: Request, res: Response) => {
        const { context } = req.body;
        Config.updateConfig('supervisor.projectContext', context || '');
        emitEvent('config', 'Supervisor project context updated');
        res.json({ success: true });
    });

    router.get('/api/admin/supervisor/logs', localhostOnly, (req: Request, res: Response) => {
        const limit = parseInt(req.query.limit as string) || 50;
        res.json({ actions: Supervisor.getActionLog(limit) });
    });

    router.post('/api/admin/supervisor/test', localhostOnly, async (req: Request, res: Response) => {
        const { endpoint: testEndpoint, model: testModel } = req.body;
        if (testEndpoint) OllamaClient.setEndpoint(testEndpoint);
        const result = await OllamaClient.isAvailable();

        // If model specified, also fetch its info
        let modelInfo = null;
        if (result.available && testModel) {
            modelInfo = await OllamaClient.getModelInfo(testModel);
        }

        const configEndpoint = (Config.getConfig('supervisor.endpoint') || 'http://localhost:11434') as string;
        OllamaClient.setEndpoint(configEndpoint);
        res.json({ ...result, modelInfo });
    });

    router.post('/api/admin/supervisor/clear', localhostOnly, (_req: Request, res: Response) => {
        Supervisor.clearHistory();
        res.json({ success: true });
    });

    // ── Tunnel ────────────────────────────────────────────────────────
    router.get('/api/admin/tunnel', localhostOnly, (_req: Request, res: Response) => {
        const status = Tunnel.getStatus();
        const config = (Config.getConfig('tunnel') || {}) as { autoStart?: boolean; mode?: string };
        const namedTunnel = Tunnel.detectNamedTunnel();
        res.json({ ...status, running: status.status === 'active', starting: status.status === 'starting', autoStart: config.autoStart || false, configMode: config.mode || 'quick', namedTunnel });
    });

    router.post('/api/admin/tunnel/start', localhostOnly, async (_req: Request, res: Response) => {
        if (!authState.authEnabled) {
            return res.status(400).json({ success: false, error: 'PIN authentication must be enabled before starting a remote tunnel.' });
        }
        const tunnelConfig = (Config.getConfig('tunnel.mode') || 'quick') as string;
        const mode = _req.body?.mode || tunnelConfig;

        let tunnelName: string | undefined;
        let hostname: string | undefined;

        // For named mode, detect tunnel config from ~/.cloudflared/config.yml
        if (mode === 'named') {
            const detected = Tunnel.detectNamedTunnel();
            if (!detected.available || !detected.tunnelId) {
                return res.json({ success: false, error: 'Named tunnel chưa cấu hình. Cần file ~/.cloudflared/config.yml với tunnel ID.' });
            }
            tunnelName = detected.tunnelId;
            hostname = detected.hostname;
        }

        const result = await Tunnel.startTunnel(mode as 'quick' | 'named', HTTP_PORT, tunnelName, hostname);
        if (result.success) { emitEvent('success', `Tunnel active (${mode}): ${result.url}`); }
        else { emitEvent('error', `Tunnel failed: ${result.error}`); }
        res.json(result);
    });

    router.post('/api/admin/tunnel/stop', localhostOnly, async (_req: Request, res: Response) => {
        const result = await Tunnel.stopTunnel();
        emitEvent('info', 'Tunnel stopped');
        res.json(result);
    });

    router.post('/api/admin/tunnel/auto-start', localhostOnly, (_req: Request, res: Response) => {
        const current = Config.getConfig('tunnel.autoStart') || false;
        Config.updateConfig('tunnel.autoStart', !current);
        res.json({ autoStart: !current });
    });

    router.post('/api/admin/tunnel/mode', localhostOnly, (req: Request, res: Response) => {
        const { mode } = req.body;
        if (!mode || !['quick', 'named'].includes(mode)) {
            return res.status(400).json({ error: 'Invalid mode. Use "quick" or "named".' });
        }
        Config.updateConfig('tunnel.mode', mode);
        res.json({ success: true, mode });
    });

    router.get('/api/admin/tunnel/detect', localhostOnly, (_req: Request, res: Response) => {
        const namedTunnel = Tunnel.detectNamedTunnel();
        const status = Tunnel.getStatus();
        res.json({ ...namedTunnel, current: { status: status.status, mode: status.mode, url: status.url } });
    });

    // ─── Preview Tunnel Routes ────────────────────────────────────────
    router.get('/api/admin/preview', localhostOnly, (_req: Request, res: Response) => {
        const previews = Tunnel.getActivePreviewTunnels();
        const previewConfig = Config.getConfig('preview') as { lastPort?: number; autoStart?: boolean } | undefined;
        res.json({
            previews,
            lastPort: previewConfig?.lastPort ?? null,
            autoStart: previewConfig?.autoStart ?? false
        });
    });

    router.post('/api/admin/preview/start', localhostOnly, async (req: Request, res: Response) => {
        const { port } = req.body as { port?: number };
        if (!port || typeof port !== 'number' || port < 1 || port > 65535) {
            res.json({ success: false, error: 'Invalid port. Must be 1-65535.' });
            return;
        }
        if (port === HTTP_PORT) {
            res.json({ success: false, error: `Port ${port} is already used by this service. Use the dashboard tunnel instead.` });
            return;
        }
        const tunnelId = `preview:${port}`;
        if (Tunnel.isActive(tunnelId)) {
            const status = Tunnel.getStatus(tunnelId);
            res.json({ success: true, url: status.url, alreadyRunning: true });
            return;
        }
        // Save last used port
        Config.updateConfig('preview.lastPort', port);
        const result = await Tunnel.startTunnel('quick', port, undefined, undefined, tunnelId);
        if (result.success) {
            emitEvent('success', `Preview tunnel started on port ${port}: ${result.url}`);
        }
        res.json(result);
    });

    router.post('/api/admin/preview/stop', localhostOnly, async (req: Request, res: Response) => {
        const { port } = req.body as { port?: number };
        const tunnelId = port ? `preview:${port}` : 'preview';
        await Tunnel.stopTunnel(tunnelId);
        emitEvent('info', `Preview tunnel stopped${port ? ` (port ${port})` : ''}`);
        res.json({ success: true });
    });

    router.post('/api/admin/preview/stop-all', localhostOnly, async (_req: Request, res: Response) => {
        await Tunnel.stopAllPreviewTunnels();
        emitEvent('info', 'All preview tunnels stopped');
        res.json({ success: true });
    });

    return router;
}
