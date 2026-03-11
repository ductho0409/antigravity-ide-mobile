/**
 * Supervisor Service - Ollama-powered autonomous agent overseer
 * 
 * Monitors all IDE chat activity via the chat stream, sends context to Ollama,
 * and executes actions: inject input, click buttons, send Telegram notifications,
 * change config. Has full knowledge and control of all app capabilities.
 * 
 * 1:1 migration from supervisor-service.mjs
 */

import * as Ollama from './ollama-client.js';
import * as Config from '../config.js';
import * as TelegramBot from './telegram-bot.js';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

type EmitEventFn = (type: string, message: string) => void;
type BroadcastFn = (event: string, data: unknown) => void;
type InjectAndSubmitFn = (text: string) => Promise<void>;
type ClickByXPathFn = (xpath: string) => Promise<{ success: boolean; error?: string }>;
type CaptureScreenshotFn = () => Promise<string | null>;

interface SupervisorAction {
    action: string;
    text?: string;
    button?: string;
    message?: string;
    reason?: string;
    path?: string;
    value?: unknown;
}

interface ActionLogEntry {
    timestamp: string | number;
    action: string;
    detail?: string;
    result: string;
    errorType?: string;
    explanation?: string;
    attempt?: number;
    instruction?: string;
}

interface TaskItem {
    instruction: string;
    status: 'pending' | 'running' | 'completed';
    addedAt: number;
    startedAt: number | null;
    completedAt: number | null;
}

interface SessionStats {
    messagesProcessed: number;
    actionsExecuted: number;
    errorsDetected: number;
    errorsFixed: number;
}

interface SessionDigest {
    startedAt: number;
    endedAt: number;
    durationMs: number;
    stats: SessionStats;
    actionsCount: number;
    topActions: Array<{ action: string; count: number }>;
    errorsEncountered: number;
    tasksCompleted: number;
    tasksQueued: number;
}

interface RecoveryAttempt {
    count: number;
    lastAttempt: number;
}

interface ErrorDetection {
    detected: boolean;
    type?: string;
    match?: string;
}

interface RecoveryResult {
    attempted: boolean;
    success?: boolean;
    reason?: string;
    error?: string;
    fix?: string;
    explanation?: string;
}

interface ChatMessage {
    role: string;
    content: string;
    timestamp?: number;
}

// ============================================================================
// External hooks (set by http-server)
// ============================================================================

let injectAndSubmitFn: InjectAndSubmitFn | null = null;
let clickByXPathFn: ClickByXPathFn | null = null;
let captureScreenshotFn: CaptureScreenshotFn | null = null;
let emitEventFn: EmitEventFn | null = null;
let broadcastFn: BroadcastFn | null = null;

// ============================================================================
// State
// ============================================================================

let enabled = false;
let processing = false;
let conversationHistory: Array<{ role: string; content: string }> = [];
let actionLog: ActionLogEntry[] = [];
let lastProcessedHash: string | null = null;
let actionCountWindow: number[] = [];
let supervisorStatus: 'idle' | 'thinking' | 'acting' | 'error' | 'disabled' = 'idle';
let userChatHistory: ChatMessage[] = [];

// Feature 2: Error Recovery
let recoveryAttempts: Record<string, RecoveryAttempt> = {};

// Feature 3: Task Queue
let taskQueue: TaskItem[] = [];

// Feature 5: Session Intelligence
let sessionStartTime = Date.now();
let sessionStats: SessionStats = { messagesProcessed: 0, actionsExecuted: 0, errorsDetected: 0, errorsFixed: 0 };

const MAX_HISTORY = 30;
const MAX_ACTION_LOG = 100;
const ACTION_WINDOW_MS = 60000;
const MIN_PROCESS_INTERVAL = 3000;

let lastProcessTime = 0;

// Track conversation summary for smart history management
let chatHistorySummary = '';
let lastSummarizedCount = 0;

// ============================================================================
// Registration
// ============================================================================

export function registerCallbacks(callbacks: {
    injectAndSubmit?: InjectAndSubmitFn;
    clickByXPath?: ClickByXPathFn;
    captureScreenshot?: CaptureScreenshotFn;
    emitEvent?: EmitEventFn;
    broadcast?: BroadcastFn;
}): void {
    injectAndSubmitFn = callbacks.injectAndSubmit || null;
    clickByXPathFn = callbacks.clickByXPath || null;
    captureScreenshotFn = callbacks.captureScreenshot || null;
    emitEventFn = callbacks.emitEvent || null;
    broadcastFn = callbacks.broadcast || null;
}

// ============================================================================
// App Knowledge Builder
// ============================================================================

function getAppKnowledge(): string {
    const config = Config.getConfig() as Record<string, unknown>;
    const ui = (config.mobileUI || {}) as Record<string, unknown>;
    const cmds = (config.quickCommands || []) as Array<Record<string, string>>;
    const tg = (config.telegram || {}) as Record<string, unknown>;
    const sv = (config.supervisor || {}) as Record<string, unknown>;
    const ss = (config.scheduledScreenshots || {}) as Record<string, unknown>;

    return `## Antigravity Mobile — App Knowledge
Mobile dashboard for monitoring/controlling an AI coding agent in the Antigravity IDE.

### Dashboard Tabs
- **Chat**: Live agent chat stream — responses, errors, progress
- **Files**: Browse, view, edit project files remotely
- **Settings**: CDP/WS status, screenshots, model selector, quick actions, quota
- **Assist**: Chat with you (the supervisor)

### Available Themes (mobileUI.theme)
- **dark** (default), **light**, **pastel**, **rainbow**, **slate**
- Current: **${ui.theme || 'dark'}**

### Navigation Modes (mobileUI.navigationMode)
- **sidebar** (vertical icons, left) or **topbar** (horizontal tabs, top)
- Current: **${ui.navigationMode || 'sidebar'}**

### Quick Commands
${cmds.map(c => '- ' + (c.icon || '▶') + ' ' + c.label + ': "' + c.prompt + '"').join('\n')}

### Current Settings
- Theme: ${ui.theme || 'dark'} | Nav: ${ui.navigationMode || 'sidebar'}
- Quick actions: ${ui.showQuickActions !== false ? 'shown' : 'hidden'} | Assist tab: ${sv.showAssistTab ? 'shown' : 'hidden'}
- Auto-accept: ${config.autoAcceptCommands ? 'ON' : 'OFF'} | Telegram: ${tg.enabled ? 'ON' : 'OFF'}
- Screenshots: ${ss.enabled !== false ? 'ON (' + (ss.intervalMs || 30000) + 'ms)' : 'OFF'}

### Key Capabilities
- CDP: Chrome DevTools Protocol for IDE automation
- Live chat stream: Real-time agent monitoring
- Auto-accept: Hands-free command approval
- Telegram bot: Push notifications for errors/completions
- Tunnel: Cloudflare tunnel for remote access
- File manager: Remote file browsing and editing
- Admin panel: /admin (localhost only) — Dashboard, Devices, Customize, Telegram, Remote Access, Analytics, Supervisor`;
}

// ============================================================================
// System Prompt
// ============================================================================

function buildSystemPrompt(): string {
    const config = Config.getConfig('supervisor') as Record<string, unknown> | undefined;
    const projectContext = (config?.projectContext as string) || '';

    return `You are the Supervisor AI for Antigravity Mobile — an intelligent overseer monitoring an AI coding agent (called "the agent") running inside the Antigravity IDE.

## Your Role
You watch everything the agent does in real-time. You receive the agent's chat messages (responses and user inputs) and decide whether to take action. You are autonomous — the human user trusts you to manage the agent on their behalf.

## Your Capabilities (Actions)
You can perform these actions by responding with a JSON block:

1. **Inject text into the IDE** — Type and submit an instruction to the AI agent:
   \`\`\`json
   {"action": "inject", "text": "Fix the type error in utils.ts line 42"}
   \`\`\`

2. **Click a button in the IDE** — Click action buttons like Run, Allow, Accept:
   \`\`\`json
   {"action": "click", "button": "Run"}
   \`\`\`

3. **Send a Telegram notification to the user**:
   \`\`\`json
   {"action": "notify", "message": "your notification message"}
   \`\`\`

4. **Change app configuration**:
   \`\`\`json
   {"action": "config", "path": "config.path", "value": "new_value"}
   \`\`\`

5. **Do nothing** — Just observe:
   \`\`\`json
   {"action": "none", "reason": "brief explanation"}
   \`\`\`

${getAppKnowledge()}

## Guidelines
- **Be conservative** — Only take action when you're confident it's the right thing to do.
- **Don't duplicate auto-accept** — If auto-accept is ON, don't click Run/Allow/Accept buttons yourself.
- **Notify for important things** — Send Telegram notifications when something truly needs the user's attention.
- **CRITICAL: Inject text is for the AI AGENT, not the human** — Write inject text as clear instructions directed at the agent.
- **Inject text sparingly** — Only inject messages to the agent when you can clearly help.
- **Always respond with exactly ONE JSON action block.**
- **Think before acting** — Explain your reasoning briefly inside a "reason" field.

${projectContext ? `## Project Context (from user)\n${projectContext}\n` : ''}## Important
- You MUST respond with exactly one JSON action object. No extra text outside the JSON.
- If unsure, use {"action": "none", "reason": "..."} — it's always safe to observe.`;
}

// ============================================================================
// HTML Parsing & Action Extraction
// ============================================================================

function extractFromHtml(html: string): { text: string; buttons: Array<{ label: string; xpath: string }> } {
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    const buttons: Array<{ label: string; xpath: string }> = [];
    const btnRegex = /data-xpath="([^"]+)"[^>]*>([\s\S]{1,200}?)<\/(?:button|div|span|a|summary)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = btnRegex.exec(html)) !== null) {
        const label = m[2].replace(/<[^>]*>/g, '').trim();
        const xpath = m[1];
        if (label && xpath && label.length <= 60 && !label.includes('\n')) {
            buttons.push({ label, xpath });
        }
    }

    return { text: text.slice(-3000), buttons };
}

function parseAction(response: string): SupervisorAction {
    try {
        const action = JSON.parse(response.trim()) as SupervisorAction;
        if (action && action.action) return action;
    } catch {
        const jsonMatch = response.match(/\{[\s\S]*?"action"\s*:\s*"[^"]+?"[\s\S]*?\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]) as SupervisorAction;
            } catch { /* fall through */ }
        }
    }
    return { action: 'none', reason: 'Failed to parse supervisor response' };
}

// ============================================================================
// Rate Limiting
// ============================================================================

function checkRateLimit(): boolean {
    const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
    const maxPerMinute = (config.maxActionsPerMinute as number) || 10;
    const now = Date.now();

    actionCountWindow = actionCountWindow.filter(t => now - t < ACTION_WINDOW_MS);
    return actionCountWindow.length < maxPerMinute;
}

function recordAction(): void {
    actionCountWindow.push(Date.now());
}

function logAction(action: SupervisorAction, result: string): ActionLogEntry {
    const entry: ActionLogEntry = {
        timestamp: new Date().toISOString(),
        action: action.action,
        detail: action.text || action.button || action.message || action.reason || '',
        result
    };

    actionLog.unshift(entry);
    if (actionLog.length > MAX_ACTION_LOG) actionLog.length = MAX_ACTION_LOG;

    if (broadcastFn) broadcastFn('supervisor_action', entry);
    return entry;
}

function areInjectsDisabled(): boolean {
    const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
    return !!config.disableInjects;
}

// ============================================================================
// Action Execution
// ============================================================================

async function executeAction(action: SupervisorAction, buttons: Array<{ label: string; xpath: string }>): Promise<void> {
    if (action.action === 'none') {
        logAction(action, 'observed');
        return;
    }

    if (!checkRateLimit()) {
        logAction({ action: 'rate_limited', reason: 'Too many actions per minute' }, 'blocked');
        if (emitEventFn) emitEventFn('warning', 'Supervisor rate limited — too many actions per minute');
        return;
    }

    const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
    if (config.disableInjects && (action.action === 'inject' || action.action === 'click')) {
        logAction(action, 'blocked: injects disabled');
        return;
    }

    recordAction();

    switch (action.action) {
        case 'inject': {
            if (!action.text || !injectAndSubmitFn) break;
            try {
                await injectAndSubmitFn(action.text);
                logAction(action, 'injected');
                if (emitEventFn) emitEventFn('supervisor', `Injected: "${action.text.slice(0, 80)}"`);
            } catch (e) {
                logAction(action, `error: ${(e as Error).message}`);
            }
            break;
        }

        case 'click': {
            if (!action.button || !clickByXPathFn) break;
            const btn = buttons.find(b =>
                b.label.toLowerCase().includes(action.button!.toLowerCase()) ||
                action.button!.toLowerCase().includes(b.label.toLowerCase())
            );
            if (btn) {
                try {
                    await clickByXPathFn(btn.xpath);
                    logAction(action, `clicked: ${btn.label}`);
                    if (emitEventFn) emitEventFn('supervisor', `Clicked: "${btn.label}"`);
                } catch (e) {
                    logAction(action, `error: ${(e as Error).message}`);
                }
            } else {
                logAction(action, `button not found: ${action.button}`);
            }
            break;
        }

        case 'notify': {
            if (!action.message) break;
            try {
                if (TelegramBot.isRunning()) {
                    await TelegramBot.sendNotification('warning', `🧠 Supervisor: ${action.message}`);
                }
                logAction(action, 'notified');
                if (emitEventFn) emitEventFn('supervisor', `Telegram: "${action.message.slice(0, 80)}"`);
            } catch (e) {
                logAction(action, `error: ${(e as Error).message}`);
            }
            break;
        }

        case 'config': {
            if (!action.path) break;
            try {
                Config.updateConfig(action.path, action.value);
                logAction(action, `config updated: ${action.path}`);
                if (emitEventFn) emitEventFn('supervisor', `Config: ${action.path} = ${JSON.stringify(action.value)}`);
            } catch (e) {
                logAction(action, `error: ${(e as Error).message}`);
            }
            break;
        }

        default:
            logAction(action, 'unknown action');
    }
}

// ============================================================================
// Main Processing Loop
// ============================================================================

export async function processChatUpdate(chatHtml: string): Promise<void> {
    if (!enabled || processing) return;

    const now = Date.now();
    if (now - lastProcessTime < MIN_PROCESS_INTERVAL) return;

    const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
    if (!config.enabled) return;

    const simpleHash = chatHtml.length + '_' + chatHtml.slice(-200);
    if (simpleHash === lastProcessedHash) return;
    lastProcessedHash = simpleHash;

    processing = true;
    supervisorStatus = 'thinking';
    if (broadcastFn) broadcastFn('supervisor_status', { status: 'thinking' });

    try {
        const { text, buttons } = extractFromHtml(chatHtml);
        if (!text || text.length < 20) {
            processing = false;
            supervisorStatus = 'idle';
            return;
        }

        const buttonInfo = buttons.length > 0
            ? `\n[Available buttons: ${buttons.map(b => b.label).join(', ')}]`
            : '';

        conversationHistory.push({
            role: 'user',
            content: `[Agent chat update]\n${text.slice(-2000)}${buttonInfo}`
        });

        while (conversationHistory.length > MAX_HISTORY) {
            conversationHistory.shift();
        }

        const messages = [
            { role: 'system', content: buildSystemPrompt() },
            ...conversationHistory
        ];

        Ollama.setEndpoint((config.endpoint as string) || 'http://localhost:11434');
        const result = await Ollama.chat(
            messages,
            (config.model as string) || 'llama3',
            { num_ctx: (config.contextWindow as number) || 8192 }
        );

        if (!result.success) {
            supervisorStatus = 'error';
            if (broadcastFn) broadcastFn('supervisor_status', { status: 'error', error: result.error });
            processing = false;
            lastProcessTime = Date.now();
            return;
        }

        conversationHistory.push({
            role: 'assistant',
            content: result.response || ''
        });

        const action = parseAction(result.response || '');
        supervisorStatus = 'acting';
        if (broadcastFn) broadcastFn('supervisor_status', { status: 'acting', action: action.action });

        await executeAction(action, buttons);

        sessionStats.messagesProcessed++;
        if (action.action !== 'none') sessionStats.actionsExecuted++;

        const errorCheck = detectError(text);
        if (errorCheck.detected) {
            const recovery = await attemptRecovery(text, text);
            if (recovery.attempted && recovery.success) {
                if (emitEventFn) emitEventFn('info', `Supervisor auto-fixed ${errorCheck.type} error`);
            }
        }

        if (taskQueue.length > 0) {
            await checkTaskCompletion(text);
        }

        supervisorStatus = 'idle';
        if (broadcastFn) broadcastFn('supervisor_status', { status: 'idle' });

    } catch (e) {
        supervisorStatus = 'error';
        if (emitEventFn) emitEventFn('error', `Supervisor error: ${(e as Error).message}`);
    } finally {
        processing = false;
        lastProcessTime = Date.now();
    }
}

// ============================================================================
// Start / Stop / Status
// ============================================================================

export function start(): boolean {
    const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
    if (!config.enabled) return false;

    enabled = true;
    supervisorStatus = 'idle';
    conversationHistory = [];
    actionCountWindow = [];

    Ollama.setEndpoint((config.endpoint as string) || 'http://localhost:11434');

    if (emitEventFn) emitEventFn('supervisor', 'Supervisor enabled');
    if (broadcastFn) broadcastFn('supervisor_status', { status: 'idle' });
    return true;
}

export function stop(): void {
    enabled = false;
    supervisorStatus = 'disabled';
    processing = false;

    if (emitEventFn) emitEventFn('supervisor', 'Supervisor disabled');
    if (broadcastFn) broadcastFn('supervisor_status', { status: 'disabled' });
}

export function getStatus(): Record<string, unknown> {
    const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
    return {
        enabled,
        status: supervisorStatus,
        model: (config.model as string) || 'llama3',
        endpoint: (config.endpoint as string) || 'http://localhost:11434',
        historyLength: conversationHistory.length,
        actionsThisMinute: actionCountWindow.filter(t => Date.now() - t < ACTION_WINDOW_MS).length,
        maxActionsPerMinute: (config.maxActionsPerMinute as number) || 10
    };
}

export function getActionLog(limit: number = 50): ActionLogEntry[] {
    return actionLog.slice(0, limit);
}

export function clearHistory(): void {
    conversationHistory = [];
    actionLog = [];
    lastProcessedHash = null;
    if (emitEventFn) emitEventFn('supervisor', 'Supervisor history cleared');
}

export function isEnabled(): boolean {
    return enabled;
}

// ============================================================================
// File Reads Post-processing
// ============================================================================

export async function processFileReads(text: string): Promise<string> {
    let modified = text;
    const readPattern = /\[READ:([^\]]+)\]/g;
    const listPattern = /\[LIST:([^\]]+)\]/g;
    let match: RegExpExecArray | null;

    while ((match = readPattern.exec(text)) !== null) {
        const filePath = match[1].trim();
        const result = readProjectFile(filePath);
        if (result.success) {
            const content = result.content!;
            const MAX_DISPLAY = 10000;
            const truncated = content.length > MAX_DISPLAY;
            const display = truncated ? content.slice(0, MAX_DISPLAY) : content;
            const notice = truncated ? '\n\n... truncated (' + Math.round(content.length / 1024) + 'KB total, showing first ' + MAX_DISPLAY + ' chars)' : '';
            modified = modified.replace(match[0], '\n```\n// ' + filePath + '\n' + display + notice + '\n```\n');
        } else {
            modified = modified.replace(match[0], '\n[File error: ' + result.error + ']\n');
        }
    }

    while ((match = listPattern.exec(text)) !== null) {
        const dirPath = match[1].trim();
        const result = listProjectDir(dirPath);
        if (result.success) {
            const listing = result.entries!.map(e => (e.type === 'dir' ? '📁 ' : '📄 ') + e.name).join('\n');
            modified = modified.replace(match[0], '\n```\n' + listing + '\n```\n');
        } else {
            modified = modified.replace(match[0], '\n[Dir error: ' + result.error + ']\n');
        }
    }

    return modified;
}

// ============================================================================
// User Chat (Assist Tab)
// ============================================================================

export async function chatWithUser(message: string): Promise<{ success: boolean; response?: string; error?: string }> {
    const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
    if (!config.enabled && !enabled) {
        return { success: false, error: 'Supervisor is not enabled' };
    }

    Ollama.setEndpoint((config.endpoint as string) || 'http://localhost:11434');

    userChatHistory.push({ role: 'user', content: message, timestamp: Date.now() });

    const projectContext = (config.projectContext as string) || '';
    const systemPrompt = `You are the Supervisor assistant for Antigravity Mobile. You help the user understand what's happening with their AI coding agent, answer questions about the app and project, and provide guidance.

${getAppKnowledge()}

## Live Status
- Supervisor status: ${supervisorStatus}
- Actions taken this session: ${actionLog.length}
- Recent agent activity: ${conversationHistory.slice(-5).map(m => m.content.slice(0, 200)).join('\n')}
${projectContext ? `\nProject context: ${projectContext}` : ''}

Respond naturally and helpfully. Be concise. Use markdown formatting when useful.`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...userChatHistory.slice(-20).map(m => ({ role: m.role, content: m.content }))
    ];

    try {
        const result = await Ollama.chat(messages, (config.model as string) || 'llama3');
        if (!result.success) {
            return { success: false, error: result.error };
        }

        let response = result.response || '';
        response = await processFileReads(response);

        if (response !== result.response) {
            userChatHistory.push({ role: 'assistant', content: response, timestamp: Date.now() });
            const followUp = await Ollama.chat([
                { role: 'system', content: systemPrompt },
                ...userChatHistory.slice(-20).map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: 'Here is the file content you requested. Now provide a helpful answer based on it.' }
            ], (config.model as string) || 'llama3');
            if (followUp.success) {
                response = followUp.response || '';
            }
        }

        userChatHistory.push({ role: 'assistant', content: response, timestamp: Date.now() });
        while (userChatHistory.length > 50) userChatHistory.shift();

        return { success: true, response };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function getUserChatHistory(): ChatMessage[] {
    return userChatHistory;
}

// ============================================================================
// Streaming Chat (Assist Tab)
// ============================================================================

export async function chatWithUserStream(
    message: string,
    onToken: (token: string) => void
): Promise<{ success: boolean; response?: string; error?: string }> {
    const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
    if (!config.enabled && !enabled) {
        return { success: false, error: 'Supervisor is not enabled' };
    }

    Ollama.setEndpoint((config.endpoint as string) || 'http://localhost:11434');

    userChatHistory.push({ role: 'user', content: message, timestamp: Date.now() });

    const preReadContent = preReadFilesFromMessage(message);

    const projectContext = (config.projectContext as string) || '';
    const systemPrompt = `You are the Supervisor assistant for Antigravity Mobile. You help the user understand what's happening with their AI coding agent, answer questions about the app and project, and provide guidance.

${getAppKnowledge()}

## Live Status
- Supervisor status: ${supervisorStatus}
- Actions taken this session: ${actionLog.length}
- Recent agent activity: ${conversationHistory.slice(-5).map(m => m.content.slice(0, 200)).join('\n')}
${projectContext ? `\nProject context: ${projectContext}` : ''}

Respond naturally and helpfully. Be concise. Use markdown formatting when useful.

## File Access
You can read project files! If the user asks about a file, include \`[READ:path/to/file]\` in your response.
**IMPORTANT:** Do NOT guess, fabricate, or hallucinate file contents.
${preReadContent ? `\n## Pre-loaded File Contents\n${preReadContent}` : ''}`;

    const contextMessages = await buildSmartHistory(userChatHistory, config);

    const messages = [
        { role: 'system', content: systemPrompt },
        ...contextMessages
    ];

    try {
        const result = await Ollama.chatStream(
            messages,
            (config.model as string) || 'llama3',
            onToken,
            { num_ctx: (config.contextWindow as number) || 8192 }
        );
        if (!result.success) {
            return { success: false, error: result.error };
        }

        userChatHistory.push({ role: 'assistant', content: result.response || '', timestamp: Date.now() });
        while (userChatHistory.length > 50) userChatHistory.shift();

        return { success: true, response: result.response };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

// ============================================================================
// Pre-read files from user message
// ============================================================================

function preReadFilesFromMessage(message: string): string {
    const lower = message.toLowerCase();
    const results: string[] = [];

    const filePatterns = [
        { pattern: /readme/i, path: 'README.md' },
        { pattern: /package\.json/i, path: 'package.json' },
        { pattern: /tsconfig/i, path: 'tsconfig.json' },
        { pattern: /\.env/i, path: '.env' },
        { pattern: /license/i, path: 'LICENSE' },
    ];

    for (const { pattern, path } of filePatterns) {
        if (pattern.test(lower)) {
            const result = readProjectFile(path);
            if (result.success) {
                results.push(`### ${path}\n\`\`\`\n${result.content!.slice(0, 2000)}\n\`\`\``);
            }
        }
    }

    const pathMatch = message.match(/(?:show|read|open|view|cat|what'?s in|content of|look at)\s+([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)/i);
    if (pathMatch) {
        const filePath = pathMatch[1];
        const result = readProjectFile(filePath);
        if (result.success && !results.some(r => r.includes(`### ${filePath}`))) {
            results.push(`### ${filePath}\n\`\`\`\n${result.content!.slice(0, 2000)}\n\`\`\``);
        }
    }

    if (/list\s*(files|dir|folder|project|root|\.\/)/i.test(lower) || /what('?s| is) in (the )?(project|folder|dir|root)/i.test(lower) || /project (structure|files|contents)/i.test(lower)) {
        const result = listProjectDir('./');
        if (result.success) {
            const listing = result.entries!.map(e => (e.type === 'dir' ? '📁 ' : '📄 ') + e.name).join('\n');
            results.push(`### Project Root (./)\n\`\`\`\n${listing}\n\`\`\``);
        }
    }

    return results.join('\n\n');
}

// ============================================================================
// Smart History Management
// ============================================================================

async function buildSmartHistory(
    history: ChatMessage[],
    config: Record<string, unknown>
): Promise<Array<{ role: string; content: string }>> {
    const SUMMARIZE_THRESHOLD = 15;
    const KEEP_RECENT = 8;

    if (history.length <= SUMMARIZE_THRESHOLD) {
        return history.map(m => ({ role: m.role, content: m.content }));
    }

    const olderMessages = history.slice(0, -KEEP_RECENT);
    const recentMessages = history.slice(-KEEP_RECENT);

    if (olderMessages.length > lastSummarizedCount) {
        try {
            const toSummarize = olderMessages.map(m =>
                (m.role === 'user' ? 'User' : 'Supervisor') + ': ' + m.content.slice(0, 300)
            ).join('\n');

            const summaryResult = await Ollama.chat([
                { role: 'system', content: `Summarize this conversation concisely. Preserve: key topics discussed, important decisions, file names mentioned, errors encountered, and any user preferences expressed. Keep it under 500 words.\n\nConversation:\n${toSummarize}` }
            ], (config.model as string) || 'llama3', { num_ctx: (config.contextWindow as number) || 8192 });

            if (summaryResult.success && summaryResult.response) {
                chatHistorySummary = summaryResult.response;
                lastSummarizedCount = olderMessages.length;
            }
        } catch (e) {
            console.log('[Supervisor] History summarization failed:', (e as Error).message);
        }
    }

    const contextMessages: Array<{ role: string; content: string }> = [];
    if (chatHistorySummary) {
        contextMessages.push({
            role: 'user',
            content: '[Previous conversation summary]\n' + chatHistorySummary
        });
        contextMessages.push({
            role: 'assistant',
            content: 'Understood, I have context from our previous conversation. How can I help?'
        });
    }
    contextMessages.push(...recentMessages.map(m => ({ role: m.role, content: m.content })));

    return contextMessages;
}

// ============================================================================
// Feature 2: Error Recovery
// ============================================================================

const ERROR_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
    { pattern: /error\s*(?:TS|ts)\d+/i, type: 'typescript' },
    { pattern: /SyntaxError|ReferenceError|TypeError|RangeError/i, type: 'runtime' },
    { pattern: /FAIL\s+(?:src|test|spec|\.)|Tests?:\s*\d+\s+failed|test\s+(?:failed|failure)|npm\s+ERR/i, type: 'test' },
    { pattern: /Build failed|compilation error|compile error/i, type: 'build' },
    { pattern: /Cannot find module|Module not found/i, type: 'module' },
    { pattern: /ENOENT|EACCES|EPERM/i, type: 'filesystem' },
    { pattern: /ERR_|FATAL|panic|segfault/i, type: 'critical' },
    { pattern: /command not found|is not recognized/i, type: 'command' },
    { pattern: /timed?\s*out|timeout/i, type: 'timeout' },
    { pattern: /stuck|infinite loop|not responding/i, type: 'stuck' }
];

function hashError(text: string): string {
    let hash = 0;
    const key = text.slice(0, 200);
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(36);
}

export function detectError(text: string): ErrorDetection {
    for (const { pattern, type } of ERROR_PATTERNS) {
        if (pattern.test(text)) {
            return { detected: true, type, match: text.match(pattern)?.[0] };
        }
    }
    return { detected: false };
}

export async function attemptRecovery(errorContext: string, chatText: string): Promise<RecoveryResult> {
    const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
    const recovery = (config.errorRecovery || {}) as Record<string, unknown>;
    if (!recovery.enabled) return { attempted: false, reason: 'Error recovery disabled' };

    const maxRetries = (recovery.maxRetries as number) || 3;
    const errHash = hashError(errorContext);

    if (!recoveryAttempts[errHash]) {
        recoveryAttempts[errHash] = { count: 0, lastAttempt: 0 };
    }

    if (recoveryAttempts[errHash].count >= maxRetries) {
        return { attempted: false, reason: 'Max retries reached (' + maxRetries + ')' };
    }

    if (Date.now() - recoveryAttempts[errHash].lastAttempt < 60000) {
        return { attempted: false, reason: 'Cooldown active' };
    }

    recoveryAttempts[errHash].count++;
    recoveryAttempts[errHash].lastAttempt = Date.now();
    sessionStats.errorsDetected++;

    Ollama.setEndpoint((config.endpoint as string) || 'http://localhost:11434');

    const recoveryPrompt = `You are an error recovery assistant. Analyze this error and provide a FIX.
Error context: ${errorContext.slice(0, 1000)}
Recent chat: ${chatText.slice(-1500)}

Respond ONLY with a JSON object:
{"fix": "exact text to inject into the IDE to fix this error", "explanation": "brief explanation of the fix"}
If you cannot fix it, respond: {"fix": null, "explanation": "why it cannot be auto-fixed"}`;

    const result = await Ollama.chat(
        [{ role: 'system', content: recoveryPrompt }],
        (config.model as string) || 'llama3',
        { num_ctx: (config.contextWindow as number) || 8192 }
    );

    if (!result.success) return { attempted: true, success: false, error: result.error };

    try {
        const parsed = JSON.parse(
            (result.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim()
        ) as { fix: string | null; explanation: string };
        if (parsed.fix && injectAndSubmitFn && !areInjectsDisabled()) {
            await injectAndSubmitFn(parsed.fix);
            sessionStats.errorsFixed++;
            actionLog.unshift({
                timestamp: Date.now(),
                action: 'error_recovery',
                detail: `Fixed ${detectError(errorContext).type} error: ${parsed.explanation}`,
                errorType: detectError(errorContext).type,
                explanation: parsed.explanation,
                attempt: recoveryAttempts[errHash].count,
                result: 'ok'
            });
            return { attempted: true, success: true, fix: parsed.fix, explanation: parsed.explanation };
        }
        return { attempted: true, success: false, explanation: parsed.explanation };
    } catch {
        return { attempted: true, success: false, error: 'Failed to parse recovery response' };
    }
}

// ============================================================================
// Feature 3: Task Queue
// ============================================================================

export function addTask(instruction: string): { success: boolean; queue: Array<TaskItem & { index: number }> } {
    taskQueue.push({
        instruction,
        status: 'pending',
        addedAt: Date.now(),
        startedAt: null,
        completedAt: null
    });
    return { success: true, queue: getTaskQueue() };
}

export function getTaskQueue(): Array<TaskItem & { index: number }> {
    return taskQueue.map((t, i) => ({ ...t, index: i }));
}

export function removeTask(index: number): { success: boolean; error?: string } {
    if (index >= 0 && index < taskQueue.length) {
        taskQueue.splice(index, 1);
        return { success: true };
    }
    return { success: false, error: 'Invalid index' };
}

export function clearTaskQueue(): { success: boolean } {
    taskQueue = [];
    return { success: true };
}

export async function checkTaskCompletion(chatText: string): Promise<void> {
    const currentTask = taskQueue.find(t => t.status === 'running');
    if (!currentTask) {
        const next = taskQueue.find(t => t.status === 'pending');
        if (next && injectAndSubmitFn && !areInjectsDisabled()) {
            next.status = 'running';
            next.startedAt = Date.now();
            await injectAndSubmitFn(next.instruction);
            actionLog.unshift({ timestamp: Date.now(), action: 'task_started', detail: next.instruction, instruction: next.instruction, result: 'ok' });
        }
        return;
    }

    const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
    Ollama.setEndpoint((config.endpoint as string) || 'http://localhost:11434');

    const checkPrompt = `Task: "${currentTask.instruction}"
Recent agent output: ${chatText.slice(-1000)}

Is this task COMPLETE based on the agent output? Respond with only: {"complete": true} or {"complete": false}`;

    const result = await Ollama.chat(
        [{ role: 'system', content: checkPrompt }],
        (config.model as string) || 'llama3',
        { num_ctx: (config.contextWindow as number) || 8192 }
    );

    if (result.success) {
        try {
            const parsed = JSON.parse(
                (result.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim()
            ) as { complete: boolean };
            if (parsed.complete) {
                currentTask.status = 'completed';
                currentTask.completedAt = Date.now();
                actionLog.unshift({ timestamp: Date.now(), action: 'task_completed', detail: currentTask.instruction, instruction: currentTask.instruction, result: 'ok' });

                const next = taskQueue.find(t => t.status === 'pending');
                if (next && injectAndSubmitFn && !areInjectsDisabled()) {
                    next.status = 'running';
                    next.startedAt = Date.now();
                    await injectAndSubmitFn(next.instruction);
                    actionLog.unshift({ timestamp: Date.now(), action: 'task_started', detail: next.instruction, instruction: next.instruction, result: 'ok' });
                }
            }
        } catch { /* skip */ }
    }
}

// ============================================================================
// Feature 4: File Awareness
// ============================================================================

let projectRoot = '';

export function setProjectRoot(root: string): void {
    projectRoot = root;
}

export function getProjectRoot(): string {
    if (projectRoot) return projectRoot;
    const config = (Config.getConfig('supervisor') || {}) as Record<string, unknown>;
    return (config.projectRoot as string) || process.cwd();
}

export function readProjectFile(filePath: string): { success: boolean; content?: string; error?: string; path?: string; size?: number } {
    try {
        const root = getProjectRoot();
        const fullPath = filePath.startsWith('/') || filePath.includes(':') ? filePath : join(root, filePath);
        if (!existsSync(fullPath)) return { success: false, error: 'File not found: ' + filePath };
        const stat = statSync(fullPath);
        if (stat.size > 100000) return { success: false, error: 'File too large (>100KB)' };
        const content = readFileSync(fullPath, 'utf-8');
        return { success: true, content, path: fullPath, size: stat.size };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

export function listProjectDir(dirPath: string): { success: boolean; entries?: Array<{ name: string; type: string; size: number }>; error?: string; path?: string } {
    try {
        const root = getProjectRoot();
        const fullPath = dirPath ? (dirPath.startsWith('/') || dirPath.includes(':') ? dirPath : join(root, dirPath)) : root;
        if (!existsSync(fullPath)) return { success: false, error: 'Directory not found' };
        const entries = readdirSync(fullPath).slice(0, 50).map(name => {
            try {
                const stat = statSync(join(fullPath, name));
                return { name, type: stat.isDirectory() ? 'dir' : 'file', size: stat.size };
            } catch {
                return { name, type: 'unknown', size: 0 };
            }
        });
        return { success: true, path: fullPath, entries };
    } catch (e) {
        return { success: false, error: (e as Error).message };
    }
}

// ============================================================================
// Feature 5: Session Intelligence
// ============================================================================

const SESSION_FILE = join(process.cwd(), 'data', 'supervisor-sessions.json');

function loadSessions(): SessionDigest[] {
    try {
        if (existsSync(SESSION_FILE)) {
            return JSON.parse(readFileSync(SESSION_FILE, 'utf-8')) as SessionDigest[];
        }
    } catch { /* skip */ }
    return [];
}

function saveSessions(sessions: SessionDigest[]): void {
    try {
        const dir = join(process.cwd(), 'data');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(SESSION_FILE, JSON.stringify(sessions.slice(-20), null, 2));
    } catch { /* skip */ }
}

export function saveSessionDigest(): SessionDigest {
    const duration = Date.now() - sessionStartTime;
    const digest: SessionDigest = {
        startedAt: sessionStartTime,
        endedAt: Date.now(),
        durationMs: duration,
        stats: { ...sessionStats },
        actionsCount: actionLog.length,
        topActions: getTopActions(),
        errorsEncountered: Object.keys(recoveryAttempts).length,
        tasksCompleted: taskQueue.filter(t => t.status === 'completed').length,
        tasksQueued: taskQueue.length
    };

    const sessions = loadSessions();
    sessions.push(digest);
    saveSessions(sessions);
    return digest;
}

function getTopActions(): Array<{ action: string; count: number }> {
    const counts: Record<string, number> = {};
    for (const entry of actionLog.slice(-50)) {
        counts[entry.action] = (counts[entry.action] || 0) + 1;
    }
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([action, count]) => ({ action, count }));
}

export function loadSessionHistory(): SessionDigest[] {
    const sessions = loadSessions();
    return sessions.slice(-5);
}

export function getSessionSummary(): string {
    const past = loadSessionHistory();
    if (past.length === 0) return '';

    return past.map((s, i) => {
        const dur = Math.round(s.durationMs / 60000);
        const d = new Date(s.startedAt).toLocaleDateString();
        return `Session ${i + 1} (${d}, ${dur}min): ${s.stats?.actionsExecuted || 0} actions, ${s.stats?.errorsDetected || 0} errors, ${s.tasksCompleted || 0} tasks`;
    }).join('\n');
}

export function getSessionStats(): { current: Record<string, unknown>; past: SessionDigest[] } {
    return {
        current: {
            startedAt: sessionStartTime,
            uptime: Date.now() - sessionStartTime,
            ...sessionStats,
            queueLength: taskQueue.length,
            recoveryAttempts: Object.keys(recoveryAttempts).length
        },
        past: loadSessionHistory()
    };
}
