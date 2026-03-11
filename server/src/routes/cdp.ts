/**
 * CDP Routes — Screenshot, inject, click, panel, chat snapshot, models, windows
 * 1:1 migration from routes/cdp.mjs
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { openFileInIDE, openFileDiffInIDE } from '../cdp/file-ops.js';

// ============================================================================
// Service interfaces (dependency injection)
// ============================================================================

interface CDPService {
    isAvailable: () => Promise<{ available: boolean; error?: string }>;
    getTargets: () => Promise<unknown[]>;
    captureScreenshot: (opts: { format: string; quality: number }) => Promise<string>;
    injectAndSubmit: (text: string) => Promise<unknown>;
    injectCommand: (text: string) => Promise<unknown>;
    focusInput: () => Promise<unknown>;
    clickElementByXPath: (xpath: string) => Promise<{ success: boolean; error?: string }>;
    getAvailableModels: () => Promise<{ models: unknown[]; current?: string }>;
    getModelAndMode: () => Promise<{ model?: string; mode?: string }>;
    setModel: (model: string) => Promise<{ success: boolean; selected?: string }>;
    getAvailableModes: () => Promise<unknown>;
    setMode: (mode: string) => Promise<{ success: boolean; selected?: string }>;
    getPendingApprovals: () => Promise<unknown>;
    respondToApproval: (action: string) => Promise<{ success: boolean; action?: string }>;
    discoverAllTargets: () => Promise<Array<{ id: string; port: number; title: string }>>;
    getActiveDevice: () => number;
    getActiveTarget: () => string | null;
    switchToTarget: (targetId: string, targets: unknown[]) => { success: boolean; target: { title: string } };
    closeWindow: (targetId: string) => Promise<{ success: boolean; error?: string }>;
    launchNewWindow: (folder?: string) => Promise<{ success: boolean; port?: number }>;
    getRecentWorkspaces: () => Promise<{ workspaces: Array<{ name: string; path: string }> }>;
    startNewChat: () => Promise<{ success: boolean; method?: string }>;
    getChatHistoryList: () => Promise<unknown>;
    closeHistoryPanel: () => Promise<unknown>;
    selectChatByTitle: (title: string) => Promise<{ success: boolean }>;
    remoteScroll: (opts: { scrollTop?: number; scrollPercent?: number }) => Promise<unknown>;
    getChatSnapshotClean: () => Promise<unknown | null>;
    queueMessage: (text: string, callback: (combined: string) => Promise<void>) => unknown;
    flushMessageQueue: (callback: (combined: string) => Promise<void>) => unknown;
}

interface ChatStreamService {
    getAccumulatedSnapshot: () => unknown | null;
    getChatSnapshot: () => Promise<unknown | null>;
    clearMessageCache: () => void;
    restartChatStream: () => Promise<{ success: boolean; error?: string }>;
    startChatStream: (callback: (chat: { messageCount: number; messages: unknown[] }) => void, interval: number) => Promise<unknown>;
    stopChatStream: () => void;
    clickInCascade: (xpath: string, text?: string, index?: number) => Promise<{ success: boolean; error?: string }>;
}

interface QuotaServiceDep {
    getQuota: () => Promise<unknown>;
    isAvailable: () => Promise<{ available: boolean; error?: string }>;
}

interface CdpRouteDeps {
    CDP: CDPService;
    ChatStream: ChatStreamService;
    QuotaService: QuotaServiceDep;
    broadcast: (event: string, data: unknown) => void;
    messages: unknown[];
    saveMessages: () => void;
    emitEvent: (type: string, message: string) => void;
    trackMetric: (type: string) => void;
    onWindowSwitch?: (target: { title: string }) => Promise<void>;
}

// ============================================================================
// Route factory
// ============================================================================

export function createCdpRoutes(deps: CdpRouteDeps): Router {
    const router = Router();
    const { CDP, ChatStream, broadcast, messages, saveMessages, emitEvent, trackMetric, onWindowSwitch } = deps;

    // ── CDP Status ──────────────────────────────────────────────────────
    router.get('/api/cdp/status', async (_req: Request, res: Response) => {
        try {
            const status = await CDP.isAvailable();
            res.json(status);
        } catch (e) {
            res.json({ available: false, error: (e as Error).message });
        }
    });

    // ── Targets ─────────────────────────────────────────────────────────
    router.get('/api/cdp/targets', async (_req: Request, res: Response) => {
        try {
            const targets = await CDP.getTargets();
            res.json({ targets });
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── Click element ───────────────────────────────────────────────────
    router.post('/api/cdp/click', async (req: Request, res: Response) => {
        try {
            const { xpath, text, index } = req.body;
            console.log(`[Click] xpath="${xpath}", text="${text}", index=${index}`);
            if (!xpath && !text) return res.status(400).json({ success: false, error: 'Missing xpath or text' });

            // Fast path: reuse persistent streaming connection (~10ms)
            let result = await ChatStream.clickInCascade(xpath, text, index);
            console.log(`[Click] result:`, JSON.stringify(result));

            // Fallback: standalone CDP connection (~600ms)
            if (!result.success && result.error?.includes('No active stream')) {
                result = await CDP.clickElementByXPath(xpath);
            }

            if (result.success) {
                emitEvent('success', `Mobile click: "${text || 'button'}"`);
            }
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // ── Screenshot ──────────────────────────────────────────────────────
    router.get('/api/cdp/screenshot', async (req: Request, res: Response) => {
        try {
            const format = (req.query.format as string) || 'png';
            const quality = parseInt(req.query.quality as string) || 80;
            const base64 = await CDP.captureScreenshot({ format, quality });
            trackMetric('screenshots');

            if (req.query.raw === 'true') {
                const buffer = Buffer.from(base64, 'base64');
                res.set('Content-Type', `image/${format}`);
                res.set('Cache-Control', 'no-cache');
                res.send(buffer);
            } else {
                res.json({
                    success: true, format,
                    data: base64,
                    dataUrl: `data:image/${format};base64,${base64}`
                });
            }
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    router.get('/api/cdp/screen.png', async (_req: Request, res: Response) => {
        try {
            const base64 = await CDP.captureScreenshot({ format: 'png', quality: 90 });
            const buffer = Buffer.from(base64, 'base64');
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.send(buffer);
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── Stop Agent (send Escape to cancel) ─────────────────────────────
    router.post('/api/cdp/stop-agent', async (_req: Request, res: Response) => {
        try {
            // Send Escape key to the IDE to interrupt the running agent
            const targets = await CDP.getTargets();
            if (!targets || (targets as unknown[]).length === 0) {
                return res.status(503).json({ success: false, error: 'No IDE target found' });
            }
            // Use the existing focusInput then Escape approach
            // First try clicking the stop button in cascade
            const stopResult = await ChatStream.clickInCascade(
                '',
                'Stop',
                0
            );
            if (stopResult.success) {
                emitEvent('success', '🛑 Agent stopped via button');
                broadcast('agent_stopped', {});
                return res.json({ success: true, method: 'stop_button' });
            }
            // Fallback: send Escape key via CDP
            await CDP.focusInput();
            // dispatchKeyEvent via injectCommand with Escape
            const result = await CDP.clickElementByXPath('__ESCAPE_KEY__');
            // If xpath approach fails, try direct key injection
            if (!result.success) {
                // Use the closeHistoryPanel approach which sends Escape
                const escResult = await deps.ChatStream.clickInCascade('', 'Cancel', 0);
                if (!escResult.success) {
                    // Last resort: inject escape via the keyboard shortcut
                    emitEvent('info', '🛑 Sending stop signal...');
                }
            }
            emitEvent('success', '🛑 Agent stop signal sent');
            broadcast('agent_stopped', {});
            res.json({ success: true, method: 'escape_key' });
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // ── Inject ──────────────────────────────────────────────────────────
    router.post('/api/cdp/inject', async (req: Request, res: Response) => {
        try {
            const { text, submit } = req.body;
            if (!text) return res.status(400).json({ error: 'Text required' });

            const result = submit ? await CDP.injectAndSubmit(text) : await CDP.injectCommand(text);

            messages.push({
                type: 'mobile_command',
                content: text,
                timestamp: new Date().toISOString()
            });
            saveMessages();
            broadcast('mobile_command', { text, submitted: !!submit });

            res.json(result);
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── Live Chat Stream ────────────────────────────────────────────────
    router.get('/api/chat/snapshot', async (_req: Request, res: Response) => {
        try {
            const accumulated = ChatStream.getAccumulatedSnapshot();
            if (accumulated) {
                return res.json(accumulated);
            }
            const snapshot = await ChatStream.getChatSnapshot();
            if (snapshot) { res.json(snapshot); }
            else { res.status(503).json({ error: 'No chat found', messages: [] }); }
        } catch (e) {
            res.status(500).json({ error: (e as Error).message, messages: [] });
        }
    });

    router.post('/api/chat/clear-cache', (_req: Request, res: Response) => {
        ChatStream.clearMessageCache();
        res.json({ success: true });
    });

    // ── Quota ────────────────────────────────────────────────────────────
    router.get('/api/quota', async (_req: Request, res: Response) => {
        try {
            const quota = await deps.QuotaService.getQuota();
            res.json(quota);
        } catch (e) {
            res.status(500).json({ available: false, error: (e as Error).message, models: [] });
        }
    });

    router.get('/api/quota/status', async (_req: Request, res: Response) => {
        try {
            const status = await deps.QuotaService.isAvailable();
            res.json(status);
        } catch (e) {
            res.json({ available: false, error: (e as Error).message });
        }
    });

    // ── Models & Modes ──────────────────────────────────────────────────
    router.get('/api/models', async (_req: Request, res: Response) => {
        try {
            const result = await CDP.getAvailableModels();
            const modeResult = await CDP.getModelAndMode();
            res.json({
                models: result.models || [],
                currentModel: modeResult.model || result.current || 'Unknown',
                currentMode: modeResult.mode || 'Unknown'
            });
        } catch (e) {
            res.json({
                models: [],
                currentModel: 'Unknown',
                currentMode: 'Unknown',
                error: (e as Error).message
            });
        }
    });

    router.post('/api/models/set', async (req: Request, res: Response) => {
        try {
            const { model } = req.body;
            if (!model) return res.status(400).json({ error: 'Model name required' });
            const result = await CDP.setModel(model);
            if (result.success) { broadcast('model_changed', { model: result.selected }); }
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    router.get('/api/modes', async (_req: Request, res: Response) => {
        try {
            const result = await CDP.getAvailableModes();
            res.json(result);
        } catch (e) {
            res.json({
                modes: [
                    { name: 'Planning', description: 'Agent can plan before executing.' },
                    { name: 'Fast', description: 'Agent executes tasks directly.' }
                ],
                current: 'Planning',
                error: (e as Error).message
            });
        }
    });

    router.post('/api/modes/set', async (req: Request, res: Response) => {
        try {
            const { mode } = req.body;
            if (!mode) return res.status(400).json({ error: 'Mode name required' });
            const result = await CDP.setMode(mode);
            if (result.success) { broadcast('mode_changed', { mode: result.selected }); }
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // ── Approvals ───────────────────────────────────────────────────────
    router.get('/api/approvals', async (_req: Request, res: Response) => {
        try {
            const result = await CDP.getPendingApprovals();
            res.json(result);
        } catch (e) {
            res.json({ pending: false, count: 0, error: (e as Error).message });
        }
    });

    router.post('/api/approvals/respond', async (req: Request, res: Response) => {
        try {
            const { action } = req.body;
            if (!action || !['approve', 'reject'].includes(action)) {
                return res.status(400).json({ error: 'Action must be "approve" or "reject"' });
            }
            const result = await CDP.respondToApproval(action);
            if (result.success) { broadcast('approval_responded', { action: result.action }); }
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // ── Multi-Window Management ────────────────────────────────────────
    let cachedTargets: Array<{ id: string; port: number; title: string }> = [];

    router.get('/api/cdp/windows', async (_req: Request, res: Response) => {
        try {
            cachedTargets = await CDP.discoverAllTargets();
            const activePort = CDP.getActiveDevice();
            const activeTabId = CDP.getActiveTarget();
            let activeTarget: string | null = null;
            if (activeTabId) {
                activeTarget = cachedTargets.find(t => t.id === `${activePort}:${activeTabId}`)?.id || null;
            }
            if (!activeTarget) {
                activeTarget = cachedTargets.find(t => t.port === activePort)?.id || null;
            }
            res.json({
                targets: cachedTargets,
                activePort,
                activeTarget,
                count: cachedTargets.length
            });

            // If we have an active target, try to detect workspace immediately
            if (activeTarget && onWindowSwitch) {
                const activeWin = cachedTargets.find(t => t.id === activeTarget);
                if (activeWin) {
                    onWindowSwitch(activeWin).catch(e => 
                        console.log('[GET /api/cdp/windows] Workspace re-detect failed:', (e as Error).message)
                    );
                }
            }
        } catch (e) {
            res.status(500).json({ error: (e as Error).message, targets: [], count: 0 });
        }
    });

    router.post('/api/cdp/windows/switch', async (req: Request, res: Response) => {
        try {
            const { targetId } = req.body;
            if (!targetId) return res.status(400).json({ error: 'targetId required' });

            if (cachedTargets.length === 0) {
                cachedTargets = await CDP.discoverAllTargets();
            }

            const result = CDP.switchToTarget(targetId, cachedTargets);
            if (result.success) {
                emitEvent('success', `Switched to window: ${result.target.title}`);
                broadcast('window_switched', result.target);

                // Restart the persistent chat stream so it connects to the NEW window
                // MUST await — otherwise client polls snapshot before cache is cleared
                try {
                    await ChatStream.restartChatStream();
                } catch (e) {
                    console.log('[switchWindow] chat stream restart error:', (e as Error).message);
                }

                if (onWindowSwitch) {
                    onWindowSwitch(result.target).catch(e =>
                        console.log('[switchWindow] workspace re-detect error:', (e as Error).message)
                    );
                }
            }
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    router.post('/api/cdp/windows/launch', async (req: Request, res: Response) => {
        try {
            const { folder } = req.body || {};
            emitEvent('info', folder
                ? `🚀 Opening new window: ${folder}`
                : '🚀 Opening new Antigravity window...');
            const result = await CDP.launchNewWindow(folder);
            if (result.success) {
                emitEvent('success', `New window opened on port ${result.port}`);
                broadcast('window_launched', { port: result.port });
                cachedTargets = await CDP.discoverAllTargets();
            }
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    router.post('/api/cdp/windows/close', async (req: Request, res: Response) => {
        try {
            const { targetId } = req.body;
            if (!targetId) return res.status(400).json({ error: 'targetId required' });

            emitEvent('info', `🗑️ Closing window: ${targetId}`);
            const result = await CDP.closeWindow(targetId);
            if (result.success) {
                emitEvent('success', 'Window closed');
                broadcast('window_closed', { targetId });
                cachedTargets = await CDP.discoverAllTargets();
            }
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // ── Recent Workspaces ───────────────────────────────────────────────
    router.get('/api/cdp/workspaces', async (_req: Request, res: Response) => {
        try {
            const result = await CDP.getRecentWorkspaces();
            res.json(result);
        } catch (e) {
            res.json({ workspaces: [] });
        }
    });

    // ── New Chat ────────────────────────────────────────────────────────
    router.post('/api/cdp/new-chat', async (_req: Request, res: Response) => {
        try {
            const result = await CDP.startNewChat();
            if (result.success) {
                emitEvent('success', 'Started new chat from mobile');
                broadcast('new_chat', { method: result.method });
                // Invalidate chat history cache so next fetch gets the new list
                chatHistoryCache = null;
            }
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // ── Chat History (with stale-while-revalidate cache) ────────────────
    let chatHistoryCache: { data: unknown; ts: number } | null = null;
    const CHAT_HISTORY_TTL_MS = 30_000; // 30s
    let chatHistoryRefreshing = false;

    const refreshChatHistoryCache = async () => {
        if (chatHistoryRefreshing) return;
        chatHistoryRefreshing = true;
        try {
            const result = await CDP.getChatHistoryList();
            chatHistoryCache = { data: result, ts: Date.now() };
        } catch {
            // keep serving stale cache
        } finally {
            chatHistoryRefreshing = false;
            // Ensure panel is closed after background scrape
            CDP.closeHistoryPanel().catch(() => { });
        }
    };

    router.get('/api/cdp/chat-history', async (_req: Request, res: Response) => {
        try {
            // If we have a cache hit, return it immediately
            if (chatHistoryCache && (Date.now() - chatHistoryCache.ts < CHAT_HISTORY_TTL_MS)) {
                res.json(chatHistoryCache.data);
                return;
            }

            // If stale cache exists, return it and refresh in background
            if (chatHistoryCache) {
                res.json(chatHistoryCache.data);
                refreshChatHistoryCache();
                return;
            }

            // No cache at all — must wait for first fetch
            const result = await CDP.getChatHistoryList();
            chatHistoryCache = { data: result, ts: Date.now() };
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, chats: [], error: (e as Error).message });
        }
    });

    // Invalidate cache on new chat / chat switch so next open gets fresh data
    const invalidateChatHistoryCache = () => { chatHistoryCache = null; };

    router.post('/api/cdp/close-history-panel', async (_req: Request, res: Response) => {
        try {
            const result = await CDP.closeHistoryPanel();
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    router.post('/api/cdp/select-chat', async (req: Request, res: Response) => {
        try {
            const { title } = req.body;
            if (!title) return res.status(400).json({ error: 'Chat title required' });
            const result = await CDP.selectChatByTitle(title);
            if (result.success) {
                emitEvent('success', `Switched to chat: ${title.substring(0, 40)}`);
                broadcast('chat_selected', { title });
                invalidateChatHistoryCache();
            }
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // ── Scroll Sync ─────────────────────────────────────────────────────
    router.post('/api/cdp/scroll', async (req: Request, res: Response) => {
        try {
            const { scrollTop, scrollPercent } = req.body;
            const result = await CDP.remoteScroll({ scrollTop, scrollPercent });
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    // ── Clean Chat Snapshot ─────────────────────────────────────────────
    router.get('/api/chat/snapshot-clean', async (_req: Request, res: Response) => {
        try {
            const snapshot = await CDP.getChatSnapshotClean();
            if (snapshot) { res.json(snapshot); }
            else { res.status(503).json({ error: 'No chat found' }); }
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── Message Batching ────────────────────────────────────────────────
    router.post('/api/cdp/inject-batch', async (req: Request, res: Response) => {
        try {
            const { text, immediate } = req.body;
            if (!text) return res.status(400).json({ error: 'Text required' });

            if (immediate) {
                const result = await CDP.injectAndSubmit(`[Mobile] ${text}`);
                messages.push({ type: 'mobile_command', content: text, timestamp: new Date().toISOString() });
                saveMessages();
                broadcast('mobile_command', { text, submitted: true, batched: false });
                res.json(result);
            } else {
                const queueResult = CDP.queueMessage(text, async (combined: string) => {
                    try {
                        await CDP.injectAndSubmit(combined);
                        messages.push({ type: 'mobile_command', content: combined, timestamp: new Date().toISOString() });
                        saveMessages();
                        broadcast('mobile_command', { text: combined, submitted: true, batched: true });
                        emitEvent('info', `Batch sent: ${combined.substring(0, 80)}`);
                    } catch (e) {
                        emitEvent('error', `Batch inject failed: ${(e as Error).message}`);
                    }
                });
                res.json({ success: true, ...(queueResult as Record<string, unknown>) });
            }
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    router.post('/api/cdp/flush-batch', async (_req: Request, res: Response) => {
        try {
            const result = CDP.flushMessageQueue(async (combined: string) => {
                try {
                    await CDP.injectAndSubmit(combined);
                    messages.push({ type: 'mobile_command', content: combined, timestamp: new Date().toISOString() });
                    saveMessages();
                    broadcast('mobile_command', { text: combined, submitted: true, batched: true });
                } catch (e) {
                    emitEvent('error', `Flush inject failed: ${(e as Error).message}`);
                }
            });
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: (e as Error).message });
        }
    });

    // ── Open file in IDE ────────────────────────────────────────────────
    router.post('/api/cdp/open-file', async (req: Request, res: Response) => {
        try {
            const { path, diff, strategy } = req.body;
            console.log(`[CDP open-file] path="${path}" diff=${diff} strategy=${strategy}`);
            if (!path) return res.status(400).json({ success: false, error: 'path required' });

            const result = diff
                ? await openFileDiffInIDE(path, strategy)
                : await openFileInIDE(path, strategy);

            console.log(`[CDP open-file] result:`, JSON.stringify(result));
            if ((result as { success: boolean }).success) {
                emitEvent('success', `CDP open file: ${path} [${(result as { method: string }).method}]`);
            }
            res.json(result);
        } catch (e) {
            console.error(`[CDP open-file] Error:`, (e as Error).message);
            res.status(500).json({ success: false, error: (e as Error).message });
        }
    });

    return router;
}
