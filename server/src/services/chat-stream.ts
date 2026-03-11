/**
 * Live Chat Stream - Captures the Antigravity chat via CDP
 * 
 * Based on Antigravity-Shit-Chat-master approach:
 * - Finds execution contexts in webviews
 * - Locates the #cascade element (chat container)
 * - Captures and streams HTML changes
 * 
 * 1:1 migration from chat-stream.mjs
 */

import WebSocket from 'ws';
import * as TelegramBot from './telegram-bot.js';
import * as Config from '../config.js';
import { clickElementByXPath } from '../cdp/index.js';
import { getChatSnapshotClean, clearLastSnapshot } from '../cdp/snapshot.js';
import { getActiveDevice, getActiveTarget, findEditorTarget } from '../cdp/core.js';

// ============================================================================
// Types
// ============================================================================

interface CDPConnection {
    ws: WebSocket;
    call: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    contexts: Array<{ id: number; origin?: string; name?: string }>;
    getCascadeContextId: () => number | null;
    setCascadeContextId: (id: number | null) => void;
}

interface CDPTarget {
    id: string;
    title: string;
    url: string;
    type: string;
    webSocketDebuggerUrl: string;
    port: number;
}

interface CapturedMessage {
    fingerprint: string;
    html: string;
}

interface CaptureResult {
    html: string;
    css: string;
    bodyBg: string;
    bodyColor: string;
    messages: CapturedMessage[];
}

interface ChatSnapshot {
    html: string;
    css: string;
    bodyBg: string;
    bodyColor: string;
}

interface ClickResult {
    success: boolean;
    tag?: string;
    text?: string;
    method?: string;
    error?: string;
    debug?: Record<string, unknown>;
}

type ChatUpdateCallback = (chat: CaptureResult) => void;
type AutoAcceptCallback = (label: string) => void;
type DebugCallback = (msg: string) => void;
type ErrorCallbackFn = (msg: string) => void;

interface NotifState {
    inputNeeded: boolean;
    error: boolean;
    dialogError: boolean;
}

// ============================================================================
// Notification state tracker (avoids duplicate alerts)
// ============================================================================

let lastNotifState: NotifState = { inputNeeded: false, error: false, dialogError: false };
let lastHtmlForNotif = '';
let unchangedCount = 0;
let agentWasActive = false;
let recentlyClickedXpaths = new Set<string>();
let autoAcceptCallback: AutoAcceptCallback | null = null;
let debugCallback: DebugCallback | null = null;
let errorCallback: ErrorCallbackFn | null = null;

export function setAutoAcceptCallback(cb: AutoAcceptCallback | null): void { autoAcceptCallback = cb; }
export function setDebugCallback(cb: DebugCallback | null): void { debugCallback = cb; }
export function setErrorCallback(cb: ErrorCallbackFn | null): void { errorCallback = cb; }

type BroadcastFn = (event: string, data: Record<string, unknown>) => void;
let broadcastCallback: BroadcastFn | null = null;
export function setBroadcastCallback(cb: BroadcastFn | null): void { broadcastCallback = cb; }

// Must stay in sync with windows.mjs CDP_SCAN_PORTS
const CDP_PORTS = [9222, 9223, 9224, 9225, 9226, 7800, 7801, 7802, 9000, 9001, 9002, 9003];

// ============================================================================
// State
// ============================================================================

let connection: CDPConnection | null = null;
let onChatUpdate: ChatUpdateCallback | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastHash: string | null = null;
let savedPollMs = 2000;

// Message Accumulation Cache
let messageCache: CapturedMessage[] = [];
let cachedCss = '';
let cachedBodyBg = '';
let cachedBodyColor = '';

// ============================================================================
// Helpers
// ============================================================================

function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return hash.toString(36);
}

// ============================================================================
// CDP Target Discovery
// ============================================================================

async function findTargets(): Promise<CDPTarget[]> {
    const targets: CDPTarget[] = [];
    const activePort = getActiveDevice();
    const activeTabId = getActiveTarget();

    const orderedPorts = [activePort, ...CDP_PORTS.filter(p => p !== activePort)];

    for (const port of orderedPorts) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
                signal: AbortSignal.timeout(2000)
            });
            const list = (await res.json()) as CDPTarget[];

            const workbenches = list.filter(t =>
                t.url?.includes('workbench.html') ||
                t.title?.includes('Antigravity') ||
                t.type === 'page'
            );

            workbenches.forEach(t => targets.push({ ...t, port }));
        } catch { /* port not available */ }
    }

    // If we have a specific active target, move it to the front
    if (activeTabId) {
        const idx = targets.findIndex(t => t.id === activeTabId);
        if (idx > 0) {
            const [active] = targets.splice(idx, 1);
            targets.unshift(active);
        }
    }

    return targets;
}

// ============================================================================
// CDP Connection
// ============================================================================

async function connectCDP(wsUrl: string, label = 'stream'): Promise<CDPConnection> {
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    ws.on('error', (err: Error) => {
        console.error('[chat-stream] WS error:', err.message);
    });
    ws.on('close', () => {
        if (label !== 'click') console.log(`[chat-stream] ${label} WS closed`);
    });

    let idCounter = 1;
    const contexts: Array<{ id: number; origin?: string; name?: string }> = [];
    let cascadeContextId: number | null = null;

    const call = (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
            const id = idCounter++;
            const handler = (msg: WebSocket.RawData): void => {
                const data = JSON.parse(msg.toString()) as { id?: number; error?: { message: string }; result?: Record<string, unknown> };
                if (data.id === id) {
                    ws.off('message', handler);
                    if (data.error) reject(new Error(data.error.message));
                    else resolve(data.result || {});
                }
            };
            ws.on('message', handler);
            ws.send(JSON.stringify({ id, method, params }));
        });

    // Track execution contexts
    ws.on('message', (msg: WebSocket.RawData) => {
        try {
            const data = JSON.parse(msg.toString()) as { method?: string; params?: Record<string, unknown> };
            if (data.method === 'Runtime.executionContextCreated') {
                const ctx = (data.params as { context: { id: number; origin?: string; name?: string } }).context;
                contexts.push(ctx);
            } else if (data.method === 'Runtime.executionContextDestroyed') {
                const ctxId = (data.params as { executionContextId: number }).executionContextId;
                const idx = contexts.findIndex(c => c.id === ctxId);
                if (idx !== -1) contexts.splice(idx, 1);
            }
        } catch { /* skip */ }
    });

    // Enable runtime to receive context events
    await call('Runtime.enable', {});
    await new Promise(r => setTimeout(r, 500));

    return {
        ws,
        call,
        contexts,
        getCascadeContextId: () => cascadeContextId,
        setCascadeContextId: (id: number | null) => { cascadeContextId = id; }
    };
}

// ============================================================================
// Cascade Context Discovery
// ============================================================================

async function findCascadeContext(cdp: CDPConnection): Promise<number | null> {
    const SCRIPT = `(() => {
        const cascade = document.getElementById('cascade') || document.getElementById('conversation');
        if (!cascade) return { found: false };
        return { 
            found: true,
            hasContent: cascade.children.length > 0
        };
    })()`;

    // Try cached context first
    if (cdp.getCascadeContextId()) {
        try {
            const res = await cdp.call('Runtime.evaluate', {
                expression: SCRIPT,
                returnByValue: true,
                contextId: cdp.getCascadeContextId()
            });
            const val = (res as { result?: { value?: { found: boolean } } }).result?.value;
            if (val?.found) {
                return cdp.getCascadeContextId();
            }
        } catch {
            cdp.setCascadeContextId(null);
        }
    }

    // Search all contexts
    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call('Runtime.evaluate', {
                expression: SCRIPT,
                returnByValue: true,
                contextId: ctx.id
            });
            const val = (result as { result?: { value?: { found: boolean } } }).result?.value;
            if (val?.found) {
                cdp.setCascadeContextId(ctx.id);
                return ctx.id;
            }
        } catch { /* skip */ }
    }

    return null;
}
// ============================================================================
// Notification & Auto-Accept
// ============================================================================

function checkAndNotify(html: string): void {
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    const hasButtons = html.includes('data-xpath');
    let buttons: Array<{ label: string; xpath: string }> = [];
    if (hasButtons) {
        const btnRegex = /data-xpath="([^"]+)"[^>]*>([\s\S]{1,200}?)<\/(?:button|div|span|a|summary)\b/gi;
        let m: RegExpExecArray | null;
        while ((m = btnRegex.exec(html)) !== null) {
            const label = m[2].replace(/<[^>]*>/g, '').trim();
            const xpath = m[1];
            if (label && xpath && label.length <= 60 && !label.includes('\n')) buttons.push({ label, xpath });
        }
    }

    // Auto-accept commands
    if (hasButtons && buttons.length > 0 && Config.getConfig('autoAcceptCommands')) {
        const rejectPatterns = /^(always run|always allow|ask every time)$/i;
        const acceptPatterns = /^(run|accept|allow once|allow this conversation|yes|continue|approve|confirm|ok|allow|proceed)$/i;

        const safeButtons = buttons.filter(b => !rejectPatterns.test(b.label));
        const btnLabels = safeButtons.map(b => b.label).join(', ');
        if (debugCallback) debugCallback(`Buttons found: [${btnLabels}]`);

        const acceptBtns = safeButtons.filter(b => acceptPatterns.test(b.label));

        for (const acceptBtn of acceptBtns) {
            if (recentlyClickedXpaths.has(acceptBtn.xpath)) {
                if (debugCallback) debugCallback(`Skip: already clicked "${acceptBtn.label}"`);
                continue;
            }
            recentlyClickedXpaths.add(acceptBtn.xpath);
            if (recentlyClickedXpaths.size > 100) {
                const first = recentlyClickedXpaths.values().next().value;
                if (first) recentlyClickedXpaths.delete(first);
            }
            if (debugCallback) debugCallback(`Auto-clicking: "${acceptBtn.label}"`);

            const delay = 500 + (acceptBtns.indexOf(acceptBtn) * 800);
            setTimeout(async () => {
                try {
                    const result = await clickElementByXPath(acceptBtn.xpath);
                    if (result?.success) {
                        if (autoAcceptCallback) autoAcceptCallback(acceptBtn.label);
                    } else {
                        if (debugCallback) debugCallback(`Click failed: ${result?.error || 'unknown'}`);
                    }
                } catch (e) {
                    if (debugCallback) debugCallback(`Click error: ${(e as Error).message}`);
                }
                setTimeout(() => recentlyClickedXpaths.delete(acceptBtn.xpath), 10000);
            }, delay);
        }

        if (acceptBtns.length === 0) {
            if (debugCallback) debugCallback(`No accept button matched in: [${btnLabels}]`);
        }
    }
    if (!hasButtons) recentlyClickedXpaths.clear();

    // Detect agent activity
    const textForCompare = text.slice(-500);
    const htmlChanged = textForCompare !== lastHtmlForNotif;
    lastHtmlForNotif = textForCompare;
    if (htmlChanged) {
        unchangedCount = 0;
        agentWasActive = true;
    } else {
        unchangedCount++;
    }
    const agentJustStopped = agentWasActive && unchangedCount === 3;
    if (unchangedCount >= 3) agentWasActive = false;

    const inputButtonPatterns = /^(run|reject|allow once|allow this conversation|always allow|deny|accept|yes|no|configure)\b/i;
    const actionButtons = buttons.filter(b => inputButtonPatterns.test(b.label));
    const hasCommandDialog = /Run command\?/i.test(html) && /Waiting/i.test(html);
    const hasPermissionDialog = /needs permission/i.test(html) && /Waiting/i.test(html);
    const hasActionableInput = actionButtons.length > 0 || hasCommandDialog || hasPermissionDialog;

    const prevState = { ...lastNotifState };
    lastNotifState = { inputNeeded: hasActionableInput, error: false, dialogError: lastNotifState.dialogError };

    // Broadcast to WS clients for browser push notifications (independent of Telegram)
    if (hasActionableInput && !prevState.inputNeeded) {
        let notifMsg = 'Your input is required in the chat.';
        if (hasCommandDialog) notifMsg = 'Your input is required — Run command?';
        else if (hasPermissionDialog) notifMsg = 'Your input is required — Permission needed.';
        else if (actionButtons.length > 0) notifMsg = `Your input is required — ${actionButtons.map(b => b.label).join(', ')}`;
        if (broadcastCallback) broadcastCallback('agent_notification', { type: 'input_needed', message: notifMsg });
    }
    if (agentJustStopped) {
        if (broadcastCallback) broadcastCallback('agent_notification', { type: 'complete', message: 'Agent has completed the process.' });
    }
    if (!TelegramBot.isRunning()) return;
    const tgConfig = Config.getConfig('telegram') as Record<string, unknown> | undefined;
    if (!tgConfig || !(tgConfig as { enabled?: boolean }).enabled) return;
    const notifications = (tgConfig as { notifications?: Record<string, boolean> }).notifications || {};

    if (hasActionableInput && !prevState.inputNeeded && notifications.onInputNeeded !== false) {
        if (debugCallback) debugCallback('Sending INPUT_NEEDED notification');
        let msg = 'Your input is required in the chat.';
        if (hasCommandDialog) msg = 'Your input is required — Run command?';
        else if (hasPermissionDialog) msg = 'Your input is required — Permission needed.';
        else if (actionButtons.length > 0) msg = `Your input is required — ${actionButtons.map(b => b.label).join(', ')}`;
        TelegramBot.sendNotification('input_needed', msg, undefined, actionButtons, 'input_needed')
            .catch(e => console.error('[TelegramBot] sendNotification error:', e));
    }

    if (agentJustStopped && notifications.onComplete !== false) {
        if (debugCallback) debugCallback('Sending COMPLETE notification');
        TelegramBot.sendNotification('complete', 'Agent has completed the process.');
    }
}

// ============================================================================
// Error Dialog Detection
// ============================================================================

async function checkErrorDialogs(cdp: CDPConnection, contextId: number): Promise<void> {
    if (!TelegramBot.isRunning()) return;
    const tgConfig = Config.getConfig('telegram') as Record<string, unknown> | undefined;
    if (!tgConfig || !(tgConfig as { enabled?: boolean }).enabled) return;
    const notifications = (tgConfig as { notifications?: { onError?: boolean } }).notifications;
    if (notifications?.onError === false) return;

    const DIALOG_SCRIPT = `(function() {
        const dialogs = document.querySelectorAll('[role="dialog"], .dialog-shadow, .monaco-dialog-box, [class*="dialog"], [class*="notification"]');
        for (const d of dialogs) {
            const text = (d.innerText || '').toLowerCase();
            if (text.includes('terminated due to error')) return { error: 'Agent terminated due to error', type: 'terminated' };
            if (text.includes('model quota reached') || text.includes('quota reached')) return { error: 'Model quota reached', type: 'quota' };
            if (text.includes('quota exhausted') || text.includes('quota exceeded')) return { error: 'Model quota exhausted', type: 'quota' };
            if (text.includes('rate limit') || text.includes('too many requests')) return { error: 'Rate limit reached', type: 'quota' };
            if (text.includes('high traffic')) return { error: 'Servers experiencing high traffic', type: 'error' };
            if (text.includes('internal server error')) return { error: 'Internal server error', type: 'error' };
        }
        return null;
    })()`;

    try {
        let dialogError: { error: string; type: string } | null = null;
        const contextsToCheck = [contextId, ...cdp.contexts.map(c => c.id)];
        const seen = new Set<number>();

        for (const ctxId of contextsToCheck) {
            if (!ctxId || seen.has(ctxId)) continue;
            seen.add(ctxId);
            try {
                const result = await cdp.call('Runtime.evaluate', {
                    expression: DIALOG_SCRIPT,
                    returnByValue: true,
                    contextId: ctxId
                });
                const val = (result as { result?: { value?: { error: string; type: string } | null } }).result?.value;
                if (val) {
                    dialogError = val;
                    break;
                }
            } catch { /* context may be invalid */ }
        }

        if (dialogError && !lastNotifState.dialogError) {
            lastNotifState.dialogError = true;
            if (debugCallback) debugCallback(`Error dialog detected: ${dialogError.error}`);
            if (errorCallback) errorCallback(dialogError.error);
            TelegramBot.sendNotification('error', dialogError.error);
            if (broadcastCallback) broadcastCallback('agent_notification', { type: 'error', message: dialogError.error });
        } else if (!dialogError && lastNotifState.dialogError) {
            lastNotifState.dialogError = false;
        }
    } catch {
        // dialog check is best-effort
    }
}

// ============================================================================
// Stream Control
// ============================================================================

export async function startChatStream(
    updateCallback: ChatUpdateCallback,
    pollMs: number = 100
): Promise<{ success: boolean; target?: string; error?: string }> {
    savedPollMs = pollMs;
    onChatUpdate = updateCallback;

    const targets = await findTargets();
    if (targets.length === 0) {
        return { success: false, error: 'No CDP targets found' };
    }

    for (const target of targets) {
        try {
            console.log(`🔍 Checking ${target.title}`);
            const cdp = await connectCDP(target.webSocketDebuggerUrl);
            const contextId = await findCascadeContext(cdp);

            if (contextId) {
                console.log(`✅ Found cascade in context ${contextId}`);
                connection = cdp;

                const poll = async (): Promise<void> => {
                    if (!connection) return;

                    // Auto-reconnect: WS closed externally (e.g. IDE click reset context)
                    if (connection.ws.readyState !== WebSocket.OPEN) {
                        console.log('[chat-stream] WS disconnected, reconnecting in 2s...');
                        clearInterval(pollInterval!);
                        pollInterval = null;
                        connection = null;
                        setTimeout(async () => {
                            if (!pollInterval && onChatUpdate) {
                                await startChatStream(onChatUpdate, savedPollMs).catch(() => {/* silent */ });
                            }
                        }, 2000);
                        return;
                    }

                    const ctxId = await findCascadeContext(connection);
                    if (!ctxId) return;

                    const snapshot = await getChatSnapshotClean();

                    if (snapshot && snapshot.html) {
                        const chat: CaptureResult = {
                            html: snapshot.html,
                            css: snapshot.css,
                            bodyBg: snapshot.backgroundColor || '',
                            bodyColor: snapshot.color || '',
                            messages: snapshot.messages ?? []
                        };
                        mergeMessages(chat);
                        const hash = hashString(snapshot.html);
                        if (hash !== lastHash) {
                            lastHash = hash;
                            if (onChatUpdate) onChatUpdate(chat);
                            // Push real-time update to all WS clients (eliminates client polling latency)
                            if (broadcastCallback) {
                                broadcastCallback('chat_update', {
                                    html: chat.html,
                                    css: chat.css,
                                    bodyBg: chat.bodyBg,
                                    bodyColor: chat.bodyColor,
                                });
                            }
                            checkAndNotify(snapshot.html);
                        }
                    }
                    await checkErrorDialogs(connection, ctxId);
                };

                await poll();
                pollInterval = setInterval(poll, pollMs);
                return { success: true, target: target.title };
            } else {
                cdp.ws.close();
            }
        } catch (e) {
            console.error(`Failed: ${(e as Error).message}`);
        }
    }

    return { success: false, error: 'No cascade element found in any target' };
}

export function stopChatStream(): void {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    if (connection) {
        try { connection.ws.close(); } catch { /* ignore */ }
        connection = null;
    }
    lastHash = null;
    onChatUpdate = null;
}

/**
 * Restart the chat stream — stops old WebSocket, clears cache, reconnects to
 * the currently active target. Called after switching windows so the stream
 * picks up the NEW window's chat instead of the old one.
 */
export async function restartChatStream(): Promise<{ success: boolean; error?: string }> {
    const savedCallback = onChatUpdate;
    // Stop the old persistent connection
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    if (connection) {
        try { connection.ws.close(); } catch { /* ignore */ }
        connection = null;
    }
    // Clear all cached data from old window
    clearMessageCache();

    // If we had a callback, reconnect with it
    if (savedCallback) {
        console.log('🔄 Restarting chat stream for new window...');
        const result = await startChatStream(savedCallback, savedPollMs);

        // Clear browser-side _cdpCache so the IDE doesn't return {not_changed:true}
        // with stale data from the OLD window
        // NOTE: `connection` is reassigned by `startChatStream` above, but TS
        // control-flow analysis still narrows it to `null` from line 585.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conn = connection as CDPConnection | null;
        if (conn) {
            try {
                const ctxId = conn.getCascadeContextId();
                if (ctxId) {
                    await conn.call('Runtime.evaluate', {
                        expression: `(() => { if (window._cdpCache) { window._cdpCache.lastChecksum = ''; window._cdpCache.css = null; } })()`,
                        returnByValue: true,
                        contextId: ctxId
                    });
                }
            } catch { /* best-effort */ }
        }

        return { success: (result as { success: boolean }).success, error: (result as { error?: string }).error };
    }
    return { success: true };
}

// ============================================================================
// Message Accumulation
// ============================================================================

function mergeMessages(captureResult: CaptureResult): void {
    if (!captureResult?.messages?.length) return;

    const newMsgs = captureResult.messages;
    cachedCss = captureResult.css || cachedCss;
    cachedBodyBg = captureResult.bodyBg || cachedBodyBg;
    cachedBodyColor = captureResult.bodyColor || cachedBodyColor;

    if (messageCache.length === 0) {
        messageCache = [...newMsgs];
        return;
    }

    const firstNewFp = newMsgs[0].fingerprint;
    let overlapIdx = -1;
    for (let i = messageCache.length - 1; i >= 0; i--) {
        if (messageCache[i].fingerprint === firstNewFp) {
            overlapIdx = i;
            break;
        }
    }

    if (overlapIdx >= 0) {
        messageCache = [...messageCache.slice(0, overlapIdx), ...newMsgs];
    } else {
        const hasAnyOverlap = newMsgs.some(nm =>
            messageCache.some(cm => cm.fingerprint === nm.fingerprint)
        );

        if (hasAnyOverlap) {
            const newFpSet = new Set(newMsgs.map(m => m.fingerprint));
            const kept = messageCache.filter(m => !newFpSet.has(m.fingerprint));
            messageCache = [...kept, ...newMsgs];
        } else {
            messageCache = [...messageCache, ...newMsgs];
        }
    }

    if (messageCache.length > 500) {
        messageCache = messageCache.slice(messageCache.length - 500);
    }
}

export function getAccumulatedSnapshot(): ChatSnapshot | null {
    if (messageCache.length === 0) return null;
    const innerHtml = messageCache.map(m => m.html).join('\n');
    return { html: innerHtml, css: cachedCss, bodyBg: cachedBodyBg, bodyColor: cachedBodyColor };
}

export function clearMessageCache(): void {
    messageCache = [];
    cachedCss = '';
    cachedBodyBg = '';
    cachedBodyColor = '';
    lastHash = null;
    // Clear snapshot.ts module-level cache so stale data isn't returned
    clearLastSnapshot();
    // Reset notification state to avoid false "complete" notification after window switch
    lastNotifState = { inputNeeded: false, error: false, dialogError: false };
    lastHtmlForNotif = '';
    unchangedCount = 0;
    agentWasActive = false;
    recentlyClickedXpaths.clear();
}

// ============================================================================
// Snapshot
// ============================================================================

export async function getChatSnapshot(): Promise<ChatSnapshot | null> {
    const snapshot = await getChatSnapshotClean();
    if (!snapshot) return null;
    const chat: CaptureResult = {
        html: snapshot.html,
        css: snapshot.css,
        bodyBg: snapshot.backgroundColor || '',
        bodyColor: snapshot.color || '',
        messages: snapshot.messages ?? []
    };
    mergeMessages(chat);
    return getAccumulatedSnapshot() || chat;
}

// ============================================================================
// Click in Cascade
// ============================================================================

export async function clickInCascade(
    xpath: string,
    text?: string,
    index: number = 0
): Promise<ClickResult> {
    let target: CDPTarget | Record<string, unknown> | undefined;
    try {
        target = await findEditorTarget() as CDPTarget | undefined;
    } catch (e) {
        return { success: false, error: `Cannot find editor target: ${(e as Error).message}` };
    }
    if (!target?.webSocketDebuggerUrl) {
        return { success: false, error: 'No active editor target found' };
    }

    let cdp: CDPConnection | undefined;
    try {
        cdp = await connectCDP(target.webSocketDebuggerUrl as string, 'click');
    } catch (e) {
        return { success: false, error: `Cannot connect to target: ${(e as Error).message}` };
    }

    try {
        const contextId = await findCascadeContext(cdp);
        if (!contextId) {
            return { success: false, error: `No cascade in target "${(target as CDPTarget).title}"` };
        }

        const SCRIPT = `(() => {
            const xpath = ${JSON.stringify(xpath || '')};
            const labelText = ${JSON.stringify(text || '')};
            const occurrenceIndex = ${typeof index === 'number' ? index : 0};
            const cascade = document.getElementById('cascade') || document.getElementById('conversation');
            if (!cascade) return { found: false, error: 'No cascade element' };

            function doClick(el, method) {
                el.scrollIntoView({ block: 'center', behavior: 'instant' });
                const evtInit = { bubbles: true, cancelable: true, view: window };
                el.dispatchEvent(new PointerEvent('pointerdown', evtInit));
                el.dispatchEvent(new MouseEvent('mousedown', evtInit));
                el.dispatchEvent(new PointerEvent('pointerup', evtInit));
                el.dispatchEvent(new MouseEvent('mouseup', evtInit));
                el.dispatchEvent(new MouseEvent('click', evtInit));
                return {
                    found: true, clicked: true, success: true, method,
                    tag: el.tagName,
                    text: (el.innerText || '').slice(0, 60)
                };
            }

            try {
                const el = document.evaluate(
                    xpath, document, null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE, null
                ).singleNodeValue;
                if (el && cascade.contains(el)) return doClick(el, 'xpath');
            } catch(e) {}

            if (labelText) {
                const searchText = labelText.trim();
                const isThoughtPattern = /^(Thought|Thinking)/i.test(searchText);

                let candidates = Array.from(cascade.querySelectorAll(
                    'button, [role="button"], [aria-expanded], summary, details, span, div'
                )).filter(el => el.offsetParent !== null);

                let matched = candidates.filter(el => {
                    const elText = (el.textContent || '').trim();
                    if (!elText) return false;
                    const firstLine = elText.split(String.fromCharCode(10))[0].trim();
                    if (firstLine === searchText) return true;
                    if (isThoughtPattern && /^(Thought|Thinking)/i.test(firstLine) && firstLine.length < 100) return true;
                    if (!isThoughtPattern) return elText.includes(searchText);
                    return false;
                });

                if (matched.length > 1) {
                    const leafOnly = matched.filter(el =>
                        !matched.some(other => other !== el && el.contains(other))
                    );
                    if (leafOnly.length > 0) matched = leafOnly;
                }

                if (matched.length > 0) {
                    const idx = Math.min(occurrenceIndex, matched.length - 1);
                    return doClick(matched[idx], 'text_match_idx_' + idx + '_of_' + matched.length);
                }

                const samples = candidates.slice(0, 5).map(el => ({
                    tag: el.tagName,
                    fl: (el.textContent || '').trim().split(String.fromCharCode(10))[0].trim().slice(0, 40)
                }));
                return {
                    found: true, clicked: false,
                    error: 'Text match failed',
                    debug: { searchText, isThoughtPattern, totalVisible: candidates.length, samples }
                };
            }

            return { found: true, clicked: false, error: 'No text provided for fallback' };
        })()`;

        const result = await cdp.call('Runtime.evaluate', {
            expression: SCRIPT,
            returnByValue: true,
            contextId
        });
        const val = (result as { result?: { value?: ClickResult } }).result?.value;
        if (val?.success) return { success: true, tag: val.tag, text: val.text, method: val.method };
        return { success: false, error: val?.error || 'Click failed', debug: val?.debug };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    } finally {
        try { cdp?.ws.close(); } catch { /* ignore */ }
    }
}

// ============================================================================
// Status
// ============================================================================

export function isStreaming(): boolean {
    return connection !== null && pollInterval !== null;
}
